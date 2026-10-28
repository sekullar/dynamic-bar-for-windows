# Dynamic Bar izleyicisi. İki şey yazar (satır satır):
#   "SinifAdi|0|0" ya da "SinifAdi|1|1"  ön plandaki pencerenin sınıfı, tam ekran olup olmadığı ve Windows'un oyun/tam ekran durumu (masaüstü algılama, tam ekranda gizleme, oyun modu)
#   "VDESK|<masaüstü-kimliği>"        bar penceresi geçerli sanal masaüstünde DEĞİLSE (masaüstü değiştirilmiş); kimlik geçerli masaüstünündür
# stdin'den "HWND|<sayı>" satırı alır: bar penceresinin tutamacı (main.js gönderir).
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false

$src = @'
using System;
using System.Runtime.InteropServices;
using System.Text;

[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("a5cd92ff-29be-454c-8d04-d82879fb3f1b")]
internal interface IVirtualDesktopManager {
  [PreserveSig] int IsWindowOnCurrentVirtualDesktop(IntPtr hWnd, out int onCurrent);
  [PreserveSig] int GetWindowDesktopId(IntPtr hWnd, out Guid desktopId);
  [PreserveSig] int MoveWindowToDesktop(IntPtr hWnd, [MarshalAs(UnmanagedType.LPStruct)] Guid desktopId);
}

[ComImport, Guid("aa509086-5ca9-4c25-8f95-589d3c07b48a")]
internal class VirtualDesktopManagerCom { }

public static class Dbw {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT mon; public RECT work; public int flags; }
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int idx);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, int flags);
  [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO mi);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("shell32.dll")] static extern int SHQueryUserNotificationState(out int state);

  // Windows'un kendi "rahatsız etme" durumu: 2 tam ekran uygulama, 3 tam ekran Direct3D (oyun), 4 sunum modu. Oyunlarda pencere boyutu sezgisi tutmasa bile doğru çıkar.
  public static bool Game() {
    try { int s; return SHQueryUserNotificationState(out s) == 0 && (s == 2 || s == 3 || s == 4); } catch { return false; }
  }

  static IVirtualDesktopManager vdm;

  static bool Init() {
    if (vdm != null) return true;
    try { vdm = (IVirtualDesktopManager)new VirtualDesktopManagerCom(); return true; } catch { return false; }
  }

  // Pencere geçerli masaüstünde mi? Emin olunamazsa (hata, Explorer yeniden başlıyor) true döner ki yanlış alarm olmasın.
  public static bool OnCurrent(long h) {
    if (!Init()) return true;
    try {
      int on;
      if (vdm.IsWindowOnCurrentVirtualDesktop(new IntPtr(h), out on) != 0) { vdm = null; return true; }
      return on != 0;
    } catch { vdm = null; return true; }
  }

  // Geçerli masaüstünün kimliği: bu masaüstünde görünen herhangi bir pencerenin masaüstü kimliği (yalnızca belgelenmiş API)
  public static string CurrentDesktop() {
    if (!Init()) return null;
    string found = null;
    try {
      EnumWindows(delegate(IntPtr h, IntPtr l) {
        if (!IsWindowVisible(h)) return true;
        int on;
        if (vdm.IsWindowOnCurrentVirtualDesktop(h, out on) != 0 || on == 0) return true;
        Guid g;
        if (vdm.GetWindowDesktopId(h, out g) == 0 && g != Guid.Empty) { found = g.ToString(); return false; }
        return true;
      }, IntPtr.Zero);
    } catch { vdm = null; }
    return found;
  }

  // "SinifAdi|1": ön plan penceresi tüm monitörü kaplıyor ve başlık çubuğu yoksa tam ekran sayılır
  public static string Fg() {
    IntPtr h = GetForegroundWindow();
    StringBuilder sb = new StringBuilder(256);
    GetClassName(h, sb, 256);
    string c = sb.ToString();
    bool fs = false;
    if (c.Length > 0 && c != "Progman" && c != "WorkerW" && c != "Shell_TrayWnd" && c != "Shell_SecondaryTrayWnd") {
      RECT r; MONITORINFO mi = new MONITORINFO();
      mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
      IntPtr m = MonitorFromWindow(h, 2);
      if (m != IntPtr.Zero && GetWindowRect(h, out r) && GetMonitorInfo(m, ref mi)) {
        // tam ekran: pencere monitörle (en çok 2 piksel farkla) aynı; büyütülmüş pencere (VS Code, Chrome) kenar payı yüzünden daha büyük olur
        bool covers = Math.Abs(r.L - mi.mon.L) <= 2 && Math.Abs(r.T - mi.mon.T) <= 2 && Math.Abs(r.R - mi.mon.R) <= 2 && Math.Abs(r.B - mi.mon.B) <= 2;
        bool caption = (GetWindowLong(h, -16) & 0x00C00000) == 0x00C00000; // WS_CAPTION
        fs = covers && !caption;
      }
    }
    return c + "|" + (fs ? "1" : "0") + "|" + (Game() ? "1" : "0");
  }
}
'@
Add-Type -TypeDefinition $src -Language CSharp

$sid = (Get-Process -Id $PID).SessionId
function Get-RegDesktop { # yedek: kayıt defterindeki geçerli masaüstü kimliği (yalnızca penceresiz boş masaüstünde gerekir)
  foreach ($p in @("HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\SessionInfo\$sid\VirtualDesktops", 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\VirtualDesktops')) {
    try {
      $b = (Get-ItemProperty -Path $p -Name CurrentVirtualDesktop -ErrorAction Stop).CurrentVirtualDesktop
      if ($b -and $b.Length -eq 16) { return (New-Object Guid (, [byte[]]$b)).ToString() }
    } catch {}
  }
  return $null
}

# stdin: Console.In.ReadLineAsync() Windows PowerShell 5.1'de (.NET Framework) senkron çalışıp döngüyü kilitler; akış tabanlı okuma kullan
$stdin = [Console]::OpenStandardInput()
$rbuf = New-Object byte[] 256
$rd = $stdin.ReadAsync($rbuf, 0, $rbuf.Length)
$pend = ''; $hwnd = [long]0; $last = ''; $off = 0

while ($true) {
  try {
    if ($rd.IsCompleted) {
      if ($rd.IsFaulted -or $rd.Result -le 0) { break } # ana uygulama kapandı
      $n = $rd.Result
      $pend += [System.Text.Encoding]::UTF8.GetString($rbuf, 0, $n)
      $rd = $stdin.ReadAsync($rbuf, 0, $rbuf.Length)
      while (($i = $pend.IndexOf("`n")) -ge 0) {
        $ln = $pend.Substring(0, $i).Trim(); $pend = $pend.Substring($i + 1)
        if ($ln.StartsWith('HWND|')) { $v = [long]0; if ([long]::TryParse($ln.Substring(5), [ref]$v)) { $hwnd = $v; $off = 0 } }
      }
    }

    $s = [Dbw]::Fg()
    if ($s -ne $last) { $last = $s; [Console]::Out.WriteLine($s); [Console]::Out.Flush() }

    if ($hwnd -ne 0) {
      if ([Dbw]::OnCurrent($hwnd)) { $off = 0 }
      else {
        if ($off % 3 -eq 0) { # her ~600 ms bir tekrar: taşıma başarısız olursa main.js yeniden dener
          $g = [Dbw]::CurrentDesktop(); if (-not $g) { $g = Get-RegDesktop }
          [Console]::Out.WriteLine('VDESK|' + $g); [Console]::Out.Flush()
        }
        $off++
      }
    }
  } catch {
    if ($_.Exception -is [System.IO.IOException]) { break }
  }
  Start-Sleep -Milliseconds 200
}
