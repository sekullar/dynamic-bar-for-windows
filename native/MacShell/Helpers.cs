using System.Diagnostics;
using System.Net.NetworkInformation;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using Microsoft.Win32;

namespace MacShell;

/// <summary>`MacShell.exe --helper <mod>`: eski PowerShell yardımcılarının (~90 MB'lık süreçler) hafif C# karşılıkları.
/// Çıktı biçimleri scripts/*.ps1 ile birebir aynıdır; ana uygulama yalnızca süreci değiştirir.</summary>
static class Helpers
{
    static TextWriter Out; static TextReader inR;
    static TextReader In() => inR ??= new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
    static void W(string s) { Out.WriteLine(s); Out.Flush(); } // yazılamazsa (ana uygulama kapandı) IOException → mod biter

    public static int Run(string mode)
    {
        Out = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true };
        try
        {
            switch (mode)
            {
                case "net": Net(); break;
                case "vol": Vol(); break;
                case "volctl": VolCtl(); break;
                case "cc": Cc(); break;
                case "notif": Notif(); break;
                case "pwr": Pwr(); break;
                case "tray": Tray(); break;
                case "privacy": Privacy(); break;
                case "watcher": Watcher(); break;
                case "media": Media().GetAwaiter().GetResult(); break;
                default: return 2;
            }
        }
        catch (IOException) { }
        return 0;
    }

    // ---------- ağ hızı ----------
    static void Net()
    {
        long[] prev = null; var t0 = DateTime.UtcNow;
        while (true)
        {
            try
            {
                long rx = 0, tx = 0;
                foreach (var n in NetworkInterface.GetAllNetworkInterfaces())
                    if (n.OperationalStatus == OperationalStatus.Up && n.NetworkInterfaceType != NetworkInterfaceType.Loopback && n.NetworkInterfaceType != NetworkInterfaceType.Tunnel)
                    { var s = n.GetIPv4Statistics(); rx += s.BytesReceived; tx += s.BytesSent; }
                var now = DateTime.UtcNow; double dt = (now - t0).TotalSeconds;
                if (prev != null && dt > 0) W("net " + Math.Max(0, Math.Round((rx - prev[0]) / dt)) + " " + Math.Max(0, Math.Round((tx - prev[1]) / dt)));
                prev = new[] { rx, tx }; t0 = now;
            }
            catch (IOException) { return; }
            catch { }
            Thread.Sleep(2000);
        }
    }

    // ---------- ses (ve parlaklık) ----------
    [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioEndpointVolume
    {
        int _0(); int _1(); int _2(); int _3();
        int SetMasterVolumeLevelScalar(float l, ref Guid c); int _5();
        int GetMasterVolumeLevelScalar(out float l);
        int _7(); int _8(); int _9(); int _10();
        int SetMute([MarshalAs(UnmanagedType.Bool)] bool m, ref Guid c);
        int GetMute([MarshalAs(UnmanagedType.Bool)] out bool m);
    }
    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDevice { int Activate(ref Guid id, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o); }
    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator { int _0(); int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice d); }
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator { }

    static IAudioEndpointVolume Endpoint()
    {
        var e = (IMMDeviceEnumerator)new MMDeviceEnumerator(); e.GetDefaultAudioEndpoint(0, 1, out var d);
        Guid g = typeof(IAudioEndpointVolume).GUID; d.Activate(ref g, 23, IntPtr.Zero, out var o); return (IAudioEndpointVolume)o;
    }
    static string VolGet()
    {
        var v = Endpoint(); v.GetMasterVolumeLevelScalar(out float l); v.GetMute(out bool m);
        return Math.Round(l * 100) + " " + (m ? 1 : 0);
    }

    static void Vol()
    {
        string last = ""; int? lb = null; int n = 0; bool noBri = false;
        while (true)
        {
            try
            {
                string v = VolGet();
                if (v != last) { last = v; W("vol " + v); }
            }
            catch (IOException) { return; }
            catch { }
            if (!noBri && n % 7 == 0)
            {
                try
                {
                    int? b = Brightness();
                    if (b == null) noBri = true;
                    else if (b != lb) { lb = b; W("bri " + b); }
                }
                catch (IOException) { return; }
                catch { noBri = true; }
            }
            n++; Thread.Sleep(300);
        }
    }

    // parlaklık: WMI betik COM arayüzü (ek paket yok)
    static int? Brightness()
    {
        try
        {
            var t = Type.GetTypeFromProgID("WbemScripting.SWbemLocator"); if (t == null) return null;
            dynamic loc = Activator.CreateInstance(t); dynamic svc = loc.ConnectServer(".", "root\\WMI");
            foreach (dynamic o in svc.ExecQuery("SELECT CurrentBrightness FROM WmiMonitorBrightness")) return (int)Convert.ToInt32(o.CurrentBrightness);
        }
        catch { }
        return null;
    }

    // ---------- Windows bildirimleri (wpndatabase.db, salt okunur) ----------
    // Çıktı: {"app":"WhatsApp","title":"...","text":"..."} (yeni gelen her toast için). Başlangıçtaki mevcut bildirimler atlanır.
    static void Notif()
    {
        string db = Path.Combine(Environment.GetEnvironmentVariable("LOCALAPPDATA") ?? "", "Microsoft", "Windows", "Notifications", "wpndatabase.db");
        long last = -1;
        while (true)
        {
            try
            {
                using var cn = new Microsoft.Data.Sqlite.SqliteConnection("Data Source=" + db + ";Mode=ReadOnly"); cn.Open();
                if (last < 0) { using var c0 = cn.CreateCommand(); c0.CommandText = "SELECT IFNULL(MAX(Id),0) FROM Notification"; last = Convert.ToInt64(c0.ExecuteScalar()); }
                using var c = cn.CreateCommand();
                c.CommandText = "SELECT n.Id, h.PrimaryId, (SELECT AssetValue FROM HandlerAssets a WHERE a.HandlerId=h.RecordId AND a.AssetKey='DisplayName' LIMIT 1), n.Payload FROM Notification n JOIN NotificationHandler h ON h.RecordId=n.HandlerId WHERE n.Id>$id AND n.Type='toast' ORDER BY n.Id";
                c.Parameters.AddWithValue("$id", last);
                var rows = new List<(long, string, string, byte[])>();
                using (var r = c.ExecuteReader()) while (r.Read()) rows.Add((r.GetInt64(0), r.GetString(1), r.IsDBNull(2) ? null : r.GetString(2), r.IsDBNull(3) ? null : (byte[])r.GetValue(3)));
                foreach (var (id, pid, name, pay) in rows)
                {
                    last = id;
                    try
                    {
                        if (pay == null) continue;
                        var x = System.Xml.Linq.XDocument.Parse(Encoding.UTF8.GetString(pay).TrimStart((char)0xFEFF));
                        var texts = x.Descendants("text").Select(t => t.Value.Trim()).Where(t => t.Length > 0).ToList();
                        if (texts.Count == 0) continue;
                        string app = !string.IsNullOrWhiteSpace(name) ? name : pid;
                        W(JsonSerializer.Serialize(new { app, pid, title = texts[0], text = string.Join(" ", texts.Skip(1)) }));
                    }
                    catch (IOException) { return; }
                    catch { }
                }
            }
            catch (IOException) { return; }
            catch { }
            Thread.Sleep(1000);
        }
    }

    // ---------- Pil / güç modu ----------
    [DllImport("powrprof.dll")] static extern uint PowerGetActualOverlayScheme(out Guid g);
    [DllImport("powrprof.dll")] static extern uint PowerSetActiveOverlayScheme(Guid g);
    [StructLayout(LayoutKind.Sequential)] struct SPS { public byte Ac, Flag, Pct, Sys; public uint Life, Full; }
    [DllImport("kernel32.dll")] static extern bool GetSystemPowerStatus(out SPS s);
    static readonly Guid[] Modes = { new("961cc777-2547-4f9d-8174-7d86181b8a7a"), Guid.Empty, new("ded574b5-45a0-4f42-8737-46345c09c238") }; // verimlilik, dengeli, performans
    static string SaverFile => Path.Combine(Environment.GetEnvironmentVariable("APPDATA") ?? "", "dynamic-bar", "saver-state.txt");
    static string PowerCfg(string args)
    {
        var psi = new ProcessStartInfo("powercfg", args) { RedirectStandardOutput = true, UseShellExecute = false, CreateNoWindow = true };
        using var p = Process.Start(psi); string o = p.StandardOutput.ReadToEnd(); p.WaitForExit(4000); return o;
    }
    static int SaverThreshold() // DC (pil) için pil tasarrufu eşiği: çıktıdaki son 0x... değeri
    {
        var m = System.Text.RegularExpressions.Regex.Matches(PowerCfg("/qh SCHEME_CURRENT SUB_ENERGYSAVER ESBATTTHRESHOLD"), "0x[0-9a-fA-F]{8}");
        return m.Count == 0 ? -1 : Convert.ToInt32(m[m.Count - 1].Value, 16);
    }
    static void Pwr()
    {
        W("ready"); string l;
        while ((l = In().ReadLine()) != null)
        {
            var p = l.Trim().Split(' ');
            try
            {
                if (p[0] == "mode" && int.TryParse(p[1], out int mi) && mi >= 0 && mi < 3) PowerSetActiveOverlayScheme(Modes[mi]);
                else if (p[0] == "saver")
                {
                    if (p[1] == "1")
                    {
                        int cur = SaverThreshold();
                        if (cur != 100) { if (cur >= 0) { Directory.CreateDirectory(Path.GetDirectoryName(SaverFile)); File.WriteAllText(SaverFile, cur.ToString()); } PowerCfg("/setdcvalueindex SCHEME_CURRENT SUB_ENERGYSAVER ESBATTTHRESHOLD 100"); PowerCfg("/setactive SCHEME_CURRENT"); }
                    }
                    else
                    {
                        int orig = 20; try { orig = int.Parse(File.ReadAllText(SaverFile).Trim()); } catch { }
                        PowerCfg("/setdcvalueindex SCHEME_CURRENT SUB_ENERGYSAVER ESBATTTHRESHOLD " + orig); PowerCfg("/setactive SCHEME_CURRENT");
                        try { File.Delete(SaverFile); } catch { }
                    }
                }
                // her komuttan sonra ve "get" ile durum: pwr <yüzde> <şarjda 0/1> <kalan sn ya da -1> <mod 0-2 ya da -1> <tasarruf 0/1>
                GetSystemPowerStatus(out var s);
                int mode = -1; if (PowerGetActualOverlayScheme(out var g) == 0) { for (int i = 0; i < 3; i++) if (Modes[i] == g) mode = i; }
                bool saver = (s.Sys & 1) != 0 || SaverThreshold() == 100;
                W($"pwr {((s.Flag & 128) != 0 ? -1 : s.Pct)} {(s.Ac == 1 ? 1 : 0)} {(s.Life == 0xFFFFFFFF ? -1 : (long)s.Life)} {mode} {(saver ? 1 : 0)}");
            }
            catch (IOException) { return; }
            catch { }
        }
    }

    // ---------- Sistem tepsisi uygulamaları ----------
    // Windows 11 her bildirim alanı simgesinin uygulamasını HKCU\Control Panel\NotifyIconSettings altında tutar (geçmiş dahil).
    // Şu an çalışan uygulamalar süzülür. stdin "list" -> "tray|<exe yolu>|<ad>" satırları + "trayend"
    [DllImport("shell32.dll")] static extern int SHGetKnownFolderPath([MarshalAs(UnmanagedType.LPStruct)] Guid id, uint flags, IntPtr token, [MarshalAs(UnmanagedType.LPWStr)] out string path);
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr h, uint flags, StringBuilder s, ref uint n);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
    static string ResolveExe(string p)
    {
        if (string.IsNullOrEmpty(p)) return null;
        if (p.StartsWith("{") && p.IndexOf('}') > 0)
        {
            int e = p.IndexOf('}');
            if (Guid.TryParse(p.Substring(0, e + 1), out var g) && SHGetKnownFolderPath(g, 0, IntPtr.Zero, out var dir) == 0) return Path.Combine(dir, p.Substring(e + 1).TrimStart('\\'));
            return null;
        }
        return p;
    }
    static void Tray()
    {
        W("ready"); string l;
        while ((l = In().ReadLine()) != null)
        {
            if (l.Trim() != "list") continue;
            try
            {
                var running = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (var pr in Process.GetProcesses())
                {
                    try
                    {
                        var h = OpenProcess(0x1000, false, (uint)pr.Id); if (h == IntPtr.Zero) continue;
                        var sb = new StringBuilder(1024); uint n = 1024; if (QueryFullProcessImageName(h, 0, sb, ref n)) running.Add(sb.ToString()); CloseHandle(h);
                    }
                    catch { }
                    pr.Dispose();
                }
                var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase); var rows = new List<(string, string, int)>();
                using var root = Registry.CurrentUser.OpenSubKey(@"Control Panel\NotifyIconSettings");
                if (root != null)
                    foreach (var name in root.GetSubKeyNames())
                    {
                        using var k = root.OpenSubKey(name); if (k == null) continue;
                        string exe = ResolveExe(k.GetValue("ExecutablePath") as string);
                        if (exe == null || !running.Contains(exe) || !seen.Add(exe)) continue;
                        string fn = Path.GetFileName(exe).ToLowerInvariant(); if (fn == "explorer.exe") continue;
                        string tip = ((k.GetValue("InitialTooltip") as string) ?? "").Split('\n')[0].Trim(' ', '\u202A', '\u202C', '\r');
                        string desc = null; try { desc = FileVersionInfo.GetVersionInfo(exe).FileDescription; } catch { }
                        string nm = new[] { tip, desc?.Trim(), Path.GetFileNameWithoutExtension(exe) }.FirstOrDefault(s => !string.IsNullOrWhiteSpace(s) && s.Length <= 28 && s != "Electron") ?? Path.GetFileNameWithoutExtension(exe);
                        rows.Add((exe, nm.Replace("|", " "), Convert.ToInt32(k.GetValue("IsPromoted") ?? 0) == 1 ? 1 : 0));
                    }
                foreach (var (exe, nm, pr) in rows.OrderBy(r => r.Item2, StringComparer.CurrentCultureIgnoreCase)) W("tray|" + exe + "|" + pr + "|" + nm);
                W("trayend");
            }
            catch (IOException) { return; }
            catch { W("trayend"); }
        }
    }

    // kontrol merkezi: stdin "get" | "vol <0-100>" | "mute" | "bri <0-100>"
    static void Cc()
    {
        W("ready");
        string l;
        while ((l = In().ReadLine()) != null)
        {
            var p = l.Trim().Split(' ');
            try
            {
                Guid z = Guid.Empty;
                switch (p[0])
                {
                    case "get": W("vol " + VolGet()); { var b = Brightness(); W(b == null ? "nobri" : "bri " + b); } break;
                    case "vol": { var v = Endpoint(); v.SetMute(false, ref z); v.SetMasterVolumeLevelScalar(Math.Max(0, Math.Min(100, int.Parse(p[1]))) / 100f, ref z); W("vol " + VolGet()); } break;
                    case "mute": { var v = Endpoint(); v.GetMute(out bool m); v.SetMute(!m, ref z); W("vol " + VolGet()); } break;
                    case "bri": { int n = Math.Max(0, Math.Min(100, int.Parse(p[1]))); SetBrightness(n); W("bri " + n); } break;
                }
            }
            catch (IOException) { return; }
            catch (Exception e) { W("err " + e.Message.Replace('\n', ' ')); }
        }
    }
    static void SetBrightness(int n)
    {
        var t = Type.GetTypeFromProgID("WbemScripting.SWbemLocator"); dynamic loc = Activator.CreateInstance(t); dynamic svc = loc.ConnectServer(".", @"root\WMI");
        foreach (dynamic o in svc.ExecQuery("SELECT * FROM WmiMonitorBrightnessMethods")) o.WmiSetBrightness(1, n);
    }

    static void VolCtl()
    {
        Endpoint(); // COM'u ısıt
        W("ready");
        string l;
        while ((l = In().ReadLine()) != null)
        {
            try
            {
                switch (l.Trim())
                {
                    case "up": Step(1); break;
                    case "down": Step(-1); break;
                    case "mute": Step(0); break;
                }
            }
            catch { }
        }
    }
    static void Step(int d)
    {
        var v = Endpoint(); v.GetMasterVolumeLevelScalar(out float l); v.GetMute(out bool m); Guid z = Guid.Empty;
        if (d == 0) { v.SetMute(!m, ref z); return; }
        if (m) v.SetMute(false, ref z);
        v.SetMasterVolumeLevelScalar(Math.Max(0f, Math.Min(1f, (float)(Math.Round(l * 50) + d) / 50f)), ref z);
    }

    // ---------- mikrofon / kamera kullanımı ----------
    const string ConsentBase = @"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\";
    static void Privacy()
    {
        string prev = "N";
        while (true)
        {
            try
            {
                HashSet<string> running = null;
                HashSet<string> Running() => running ??= new HashSet<string>(Process.GetProcesses().Select(p => p.ProcessName.ToLowerInvariant()));
                string m = string.Join(";", InUse("microphone", Running)), c = string.Join(";", InUse("webcam", Running));
                string o = (m != "" || c != "") ? "P|" + m + "|" + c : "N";
                if (o != prev) { W(o); prev = o; }
            }
            catch (IOException) { return; }
            catch { }
            Thread.Sleep(1500);
        }
    }
    static List<string> InUse(string kind, Func<HashSet<string>> running)
    {
        var res = new List<string>();
        using var root = Registry.CurrentUser.OpenSubKey(ConsentBase + kind);
        if (root == null) return res;
        foreach (var name in root.GetSubKeyNames())
        {
            if (name == "NonPackaged")
            {
                using var np = root.OpenSubKey("NonPackaged"); if (np == null) continue;
                foreach (var n in np.GetSubKeyNames())
                {
                    using var k = np.OpenSubKey(n); if (k == null) continue;
                    if (Active(k))
                    {
                        string exe = Path.GetFileNameWithoutExtension(n.Split('#').Last());
                        if (running().Contains(exe.ToLowerInvariant())) res.Add(exe);
                    }
                }
            }
            else
            {
                using var k = root.OpenSubKey(name); if (k == null) continue;
                if (Active(k)) res.Add(name.Split('_')[0]);
            }
        }
        return res;
    }
    static bool Active(RegistryKey k)
    {
        long start = Convert.ToInt64(k.GetValue("LastUsedTimeStart", 0) ?? 0), stop = Convert.ToInt64(k.GetValue("LastUsedTimeStop", 0) ?? 0);
        return start > 0 && stop == 0;
    }

    // ---------- ön plan / tam ekran / sanal masaüstü izleyici ----------
    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("a5cd92ff-29be-454c-8d04-d82879fb3f1b")]
    interface IVirtualDesktopManager
    {
        [PreserveSig] int IsWindowOnCurrentVirtualDesktop(IntPtr hWnd, out int onCurrent);
        [PreserveSig] int GetWindowDesktopId(IntPtr hWnd, out Guid desktopId);
        [PreserveSig] int MoveWindowToDesktop(IntPtr hWnd, [MarshalAs(UnmanagedType.LPStruct)] Guid desktopId);
    }
    [ComImport, Guid("aa509086-5ca9-4c25-8f95-589d3c07b48a")] class VirtualDesktopManagerCom { }
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int L, T, R, B; }
    [StructLayout(LayoutKind.Sequential)] struct MONITORINFO { public int cbSize; public RECT mon; public RECT work; public int flags; }
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

    static bool Game() { try { return SHQueryUserNotificationState(out int s) == 0 && (s == 2 || s == 3 || s == 4); } catch { return false; } }
    static IVirtualDesktopManager vdm;
    static bool InitVdm() { if (vdm != null) return true; try { vdm = (IVirtualDesktopManager)new VirtualDesktopManagerCom(); return true; } catch { return false; } }
    static bool OnCurrent(long h)
    {
        if (!InitVdm()) return true;
        try { if (vdm.IsWindowOnCurrentVirtualDesktop(new IntPtr(h), out int on) != 0) { vdm = null; return true; } return on != 0; }
        catch { vdm = null; return true; }
    }
    static string CurrentDesktop()
    {
        if (!InitVdm()) return null;
        string found = null;
        try
        {
            EnumWindows((h, l) =>
            {
                if (!IsWindowVisible(h)) return true;
                if (vdm.IsWindowOnCurrentVirtualDesktop(h, out int on) != 0 || on == 0) return true;
                if (vdm.GetWindowDesktopId(h, out Guid g) == 0 && g != Guid.Empty) { found = g.ToString(); return false; }
                return true;
            }, IntPtr.Zero);
        }
        catch { vdm = null; }
        return found;
    }
    static string Fg()
    {
        IntPtr h = GetForegroundWindow(); var sb = new StringBuilder(256); GetClassName(h, sb, 256); string c = sb.ToString(); bool fs = false;
        if (c.Length > 0 && c != "Progman" && c != "WorkerW" && c != "Shell_TrayWnd" && c != "Shell_SecondaryTrayWnd")
        {
            var mi = new MONITORINFO { cbSize = Marshal.SizeOf<MONITORINFO>() }; IntPtr m = MonitorFromWindow(h, 2);
            if (m != IntPtr.Zero && GetWindowRect(h, out RECT r) && GetMonitorInfo(m, ref mi))
            {
                bool covers = Math.Abs(r.L - mi.mon.L) <= 2 && Math.Abs(r.T - mi.mon.T) <= 2 && Math.Abs(r.R - mi.mon.R) <= 2 && Math.Abs(r.B - mi.mon.B) <= 2;
                bool caption = (GetWindowLong(h, -16) & 0x00C00000) == 0x00C00000;
                fs = covers && !caption;
            }
        }
        return c + "|" + (fs ? "1" : "0") + "|" + (Game() ? "1" : "0");
    }
    static string RegDesktop()
    {
        int sid = Process.GetCurrentProcess().SessionId;
        foreach (var p in new[] { $@"SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\SessionInfo\{sid}\VirtualDesktops", @"SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\VirtualDesktops" })
        {
            try { using var k = Registry.CurrentUser.OpenSubKey(p); if (k?.GetValue("CurrentVirtualDesktop") is byte[] b && b.Length == 16) return new Guid(b).ToString(); } catch { }
        }
        return null;
    }
    static void Watcher()
    {
        long hwnd = 0; int off = 0; string last = "";
        var th = new Thread(() =>
        {
            try
            {
                string ln;
                while ((ln = In().ReadLine()) != null)
                    if (ln.StartsWith("HWND|") && long.TryParse(ln.AsSpan(5).Trim(), out long v)) { hwnd = v; off = 0; }
            }
            catch { }
            Environment.Exit(0); // ana uygulama kapandı
        }) { IsBackground = true };
        th.Start();
        while (true)
        {
            try
            {
                string s = Fg(); if (s != last) { last = s; W(s); }
                long h = Interlocked.Read(ref hwnd);
                if (h != 0)
                {
                    if (OnCurrent(h)) off = 0;
                    else { if (off % 3 == 0) { W("VDESK|" + (CurrentDesktop() ?? RegDesktop())); } off++; }
                }
            }
            catch (IOException) { return; }
            catch { }
            Thread.Sleep(200);
        }
    }

    // ---------- medya oturumu (GSMTC) ----------
    static async Task Media()
    {
        var mgr = await Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
        var cmds = new System.Collections.Concurrent.ConcurrentQueue<string>();
        new Thread(() => { try { string l; while ((l = In().ReadLine()) != null) cmds.Enqueue(l.Trim()); } catch { } Environment.Exit(0); }) { IsBackground = true }.Start();
        string last = "", lastKey = "", lastErr = "";
        while (true)
        {
            try
            {
                var s = mgr.GetSessions().FirstOrDefault(x => x.GetPlaybackInfo().PlaybackStatus == Windows.Media.Control.GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing) ?? mgr.GetCurrentSession();
                bool acted = false;
                while (cmds.TryDequeue(out var c))
                {
                    if (s == null) continue; acted = true;
                    switch (c) { case "playpause": await s.TryTogglePlayPauseAsync(); break; case "next": await s.TrySkipNextAsync(); break; case "prev": await s.TrySkipPreviousAsync(); break; }
                }
                if (acted) { await Task.Delay(200); last = ""; }
                string json;
                if (s == null) json = "{\"none\":true}";
                else
                {
                    var p = await s.TryGetMediaPropertiesAsync(); var info = s.GetPlaybackInfo(); var tl = s.GetTimelineProperties();
                    double pos = tl.Position.TotalSeconds; string status = info.PlaybackStatus.ToString();
                    if (status == "Playing") pos += (DateTimeOffset.Now - tl.LastUpdatedTime).TotalSeconds;
                    double dur = tl.EndTime.TotalSeconds - tl.StartTime.TotalSeconds;
                    if (dur > 0 && pos > dur) pos = dur; if (pos < 0) pos = 0;
                    string key = p.Title + "|" + p.Artist;
                    var o = new Dictionary<string, object> { ["key"] = key, ["title"] = p.Title, ["artist"] = p.Artist, ["status"] = status, ["pos"] = Math.Floor(pos), ["dur"] = Math.Floor(dur) };
                    if (key != lastKey) { lastKey = key; o["art"] = await Art(p); }
                    json = JsonSerializer.Serialize(o);
                }
                if (json != last) { last = json; W(json); }
            }
            catch (IOException) { return; }
            catch (Exception e)
            {
                if (e.Message != lastErr) { lastErr = e.Message; try { W(JsonSerializer.Serialize(new { error = e.Message })); } catch { return; } }
            }
            await Task.Delay(700);
        }
    }
    static async Task<string> Art(Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties p)
    {
        try
        {
            if (p.Thumbnail == null) return null;
            using var st = await p.Thumbnail.OpenReadAsync(); using var ms = new MemoryStream();
            await st.AsStreamForRead().CopyToAsync(ms); return Convert.ToBase64String(ms.ToArray());
        }
        catch { return null; }
    }
}
