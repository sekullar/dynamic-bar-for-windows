# Kontrol merkezi yardımcısı. stdin: "get" | "vol <0-100>" | "mute" | "bri <0-100>"; stdout: "vol 45 0", "bri 60" ya da "nobri". Hazır olunca "ready".
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int _0(); int _1(); int _2(); int _3();
  int SetMasterVolumeLevelScalar(float l, ref Guid c); int _5();
  int GetMasterVolumeLevelScalar(out float l);
  int _7(); int _8(); int _9(); int _10();
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool m, ref Guid c);
  int GetMute([MarshalAs(UnmanagedType.Bool)] out bool m);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref Guid id, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int _0(); int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice d); }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator {}
public static class Cc {
  static IAudioEndpointVolume Dev() {
    var e = (IMMDeviceEnumerator)new MMDeviceEnumerator(); IMMDevice d; e.GetDefaultAudioEndpoint(0, 1, out d);
    object o; Guid g = typeof(IAudioEndpointVolume).GUID; d.Activate(ref g, 23, IntPtr.Zero, out o); return (IAudioEndpointVolume)o;
  }
  public static string Get() { var v = Dev(); float l; bool m; v.GetMasterVolumeLevelScalar(out l); v.GetMute(out m); return Math.Round(l * 100) + " " + (m ? 1 : 0); }
  public static void Set(int p) { var v = Dev(); Guid z = Guid.Empty; v.SetMute(false, ref z); v.SetMasterVolumeLevelScalar(Math.Max(0, Math.Min(100, p)) / 100f, ref z); }
  public static void Mute() { var v = Dev(); bool m; v.GetMute(out m); Guid z = Guid.Empty; v.SetMute(!m, ref z); }
}
"@
function Out1($s) { [Console]::Out.WriteLine($s); [Console]::Out.Flush() }
function Bri { try { $b = (Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction Stop | Select-Object -First 1).CurrentBrightness; if ($null -ne $b) { Out1("bri $b") } else { Out1('nobri') } } catch { Out1('nobri') } }
Out1('ready')
while (($l = [Console]::In.ReadLine()) -ne $null) {
  $p = $l.Trim().Split(' ')
  try {
    switch ($p[0]) {
      'get' { Out1('vol ' + [Cc]::Get()); Bri }
      'vol' { [Cc]::Set([int]$p[1]); Out1('vol ' + [Cc]::Get()) }
      'mute' { [Cc]::Mute(); Out1('vol ' + [Cc]::Get()) }
      'bri' { $n = [Math]::Max(0, [Math]::Min(100, [int]$p[1])); Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction Stop | ForEach-Object { $_.WmiSetBrightness(1, $n) | Out-Null }; Out1("bri $n") }
    }
  } catch {}
}
