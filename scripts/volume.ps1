# Ses ve (varsa) parlaklık değişimlerini "vol 45 0" / "bri 60" olarak yazar
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
  public static string Get() {
    var e = (IMMDeviceEnumerator)new MMDeviceEnumerator(); IMMDevice d; e.GetDefaultAudioEndpoint(0, 1, out d);
    object o; Guid g = typeof(IAudioEndpointVolume).GUID; d.Activate(ref g, 23, IntPtr.Zero, out o);
    var v = (IAudioEndpointVolume)o; float l; bool m; v.GetMasterVolumeLevelScalar(out l); v.GetMute(out m);
    return Math.Round(l * 100) + " " + (m ? 1 : 0);
  }
}
"@
$last = ''; $lb = $null; $n = 0; $noBri = $false
while ($true) {
  try {
    $v = [Vol]::Get()
    if ($v -ne $last) { $last = $v; [Console]::Out.WriteLine('vol ' + $v); [Console]::Out.Flush() }
    if (-not $noBri -and $n % 7 -eq 0) {
      try {
        $b = (Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction Stop | Select-Object -First 1).CurrentBrightness
        if ($b -ne $lb) { $lb = $b; [Console]::Out.WriteLine('bri ' + $b); [Console]::Out.Flush() }
      } catch { $noBri = $true }
    }
  } catch [System.IO.IOException] { break } catch {}
  $n++; Start-Sleep -Milliseconds 300
}
