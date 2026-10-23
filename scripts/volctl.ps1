# Ses tuşlarını (volkeys.js yakalar) uygular: stdin'den "up" / "down" / "mute" satırı okur. Hazır olunca "ready" yazar.
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
public static class Vol {
  public static void Step(int d) { // d: +1/-1 (2%), 0: sessiz aç/kapat
    var v = Dev(); float l; bool m; v.GetMasterVolumeLevelScalar(out l); v.GetMute(out m); Guid z = Guid.Empty;
    if (d == 0) { v.SetMute(!m, ref z); return; }
    if (m) v.SetMute(false, ref z);
    v.SetMasterVolumeLevelScalar(Math.Max(0f, Math.Min(1f, (float)(Math.Round(l * 50) + d) / 50f)), ref z);
  }
  static IAudioEndpointVolume Dev() {
    var e = (IMMDeviceEnumerator)new MMDeviceEnumerator(); IMMDevice d; e.GetDefaultAudioEndpoint(0, 1, out d);
    object o; Guid g = typeof(IAudioEndpointVolume).GUID; d.Activate(ref g, 23, IntPtr.Zero, out o); return (IAudioEndpointVolume)o;
  }
  public static string Get() {
    var e = (IMMDeviceEnumerator)new MMDeviceEnumerator(); IMMDevice d; e.GetDefaultAudioEndpoint(0, 1, out d);
    object o; Guid g = typeof(IAudioEndpointVolume).GUID; d.Activate(ref g, 23, IntPtr.Zero, out o);
    var v = (IAudioEndpointVolume)o; float l; bool m; v.GetMasterVolumeLevelScalar(out l); v.GetMute(out m);
    return Math.Round(l * 100) + " " + (m ? 1 : 0);
  }
}
"@
[Console]::Out.WriteLine("ready"); [Console]::Out.Flush()
while (($l = [Console]::In.ReadLine()) -ne $null) {
  try { switch ($l.Trim()) { "up" { [Vol]::Step(1) } "down" { [Vol]::Step(-1) } "mute" { [Vol]::Step(0) } } } catch {}
}
