# Dynamic Bar macOS görünümü bekçisi: ana süreç (çökse bile) kapanınca Windows görev çubuğunu eski haline getirir.
# Kullanım: taskbar-guard.ps1 <ana-süreç-pid> <asıl-otomatik-gizle 0|1> <geri yükleme dosyası>
param([int]$ParentPid, [int]$Autohide, [string]$StateFile)
$src = @'
using System;
using System.Runtime.InteropServices;
public static class Tb {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct ABD { public int cb; public IntPtr h; public uint msg; public uint edge; public RECT rc; public IntPtr lp; }
  [DllImport("shell32.dll")] static extern UIntPtr SHAppBarMessage(uint m, ref ABD d);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindow(string c, string n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr p, IntPtr a, string c, string n);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int c);
  public static void Restore(bool autohide) {
    var d = new ABD(); d.cb = Marshal.SizeOf(typeof(ABD));
    uint cur = (uint)SHAppBarMessage(4, ref d) & ~1u;
    d.lp = (IntPtr)(cur | (autohide ? 1u : 0u)); SHAppBarMessage(10, ref d);
    IntPtr t = FindWindow("Shell_TrayWnd", null); if (t != IntPtr.Zero) ShowWindow(t, 5);
    IntPtr s = IntPtr.Zero;
    for (int i = 0; i < 8; i++) { s = FindWindowEx(IntPtr.Zero, s, "Shell_SecondaryTrayWnd", null); if (s == IntPtr.Zero) break; ShowWindow(s, 5); }
  }
}
'@
Add-Type -TypeDefinition $src
try { Wait-Process -Id $ParentPid -ErrorAction Stop } catch {}
# Dosya yoksa ana süreç görev çubuğunu zaten kendisi geri verdi (normal çıkış): dokunma
if ($StateFile -and -not (Test-Path -LiteralPath $StateFile)) { exit }
$ah = ($Autohide -eq 1)
try { $ah = [bool](Get-Content -Raw -LiteralPath $StateFile | ConvertFrom-Json).autohide } catch {}
[Tb]::Restore($ah)
if ($StateFile) { Remove-Item -LiteralPath $StateFile -ErrorAction SilentlyContinue }
