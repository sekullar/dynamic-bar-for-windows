[Console]::OutputEncoding = [Text.Encoding]::UTF8
# Bluetooth cihazları ve Mobil Erişim Noktası (hotspot) yardımcısı.
# stdin: "bt" | "btc <adres> <0|1>" (bağlan/ayır) | "hs" | "hs on" | "hs off"
# stdout: "ready", "bt|<adres>|<bağlı 0/1>|<sınıf>|<ad>" satırları + "btend" (ya da "btnone"), "hs on|off|none", "btc ok|fail"
Add-Type -TypeDefinition @"
using System; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class Bt {
  [StructLayout(LayoutKind.Sequential)] struct FindRadio { public uint size; }
  [StructLayout(LayoutKind.Sequential)] struct ST { public ushort a, b, c, d, e, f, g, h; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct Dev { public uint size; public ulong addr; public uint cls; public int connected, remembered, authenticated; public ST seen, used; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 248)] public string name; }
  [StructLayout(LayoutKind.Sequential)] struct Search { public uint size; public int auth, rem, unk, conn, inq; public byte mult; public IntPtr radio; }
  [DllImport("bthprops.cpl", SetLastError = true)] static extern IntPtr BluetoothFindFirstRadio(ref FindRadio p, out IntPtr h);
  [DllImport("bthprops.cpl")] static extern bool BluetoothFindRadioClose(IntPtr h);
  [DllImport("bthprops.cpl", SetLastError = true)] static extern IntPtr BluetoothFindFirstDevice(ref Search p, ref Dev d);
  [DllImport("bthprops.cpl")] static extern bool BluetoothFindNextDevice(IntPtr h, ref Dev d);
  [DllImport("bthprops.cpl")] static extern bool BluetoothFindDeviceClose(IntPtr h);
  [DllImport("bthprops.cpl")] static extern uint BluetoothSetServiceState(IntPtr radio, ref Dev d, ref Guid g, uint flags);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  static IntPtr Radio() { var p = new FindRadio { size = 4 }; IntPtr r; var f = BluetoothFindFirstRadio(ref p, out r); if (f == IntPtr.Zero) return IntPtr.Zero; BluetoothFindRadioClose(f); return r; }
  static Search Sp(IntPtr r) { return new Search { size = (uint)Marshal.SizeOf(typeof(Search)), auth = 1, rem = 1, unk = 0, conn = 1, inq = 0, mult = 0, radio = r }; }
  public static List<string> List() {
    var o = new List<string>(); var r = Radio(); if (r == IntPtr.Zero) return o;
    var sp = Sp(r); var d = new Dev { size = (uint)Marshal.SizeOf(typeof(Dev)) };
    var h = BluetoothFindFirstDevice(ref sp, ref d);
    if (h != IntPtr.Zero) { do { if (!string.IsNullOrEmpty(d.name)) o.Add(d.addr.ToString("X12") + "|" + (d.connected != 0 ? 1 : 0) + "|" + ((d.cls >> 8) & 0x1F) + "|" + d.name.Replace("|", " ")); d.size = (uint)Marshal.SizeOf(typeof(Dev)); } while (BluetoothFindNextDevice(h, ref d)); BluetoothFindDeviceClose(h); }
    CloseHandle(r); return o;
  }
  static readonly string[] Svc = { "0000110b-0000-1000-8000-00805f9b34fb", "0000110a-0000-1000-8000-00805f9b34fb", "0000111e-0000-1000-8000-00805f9b34fb", "00001108-0000-1000-8000-00805f9b34fb", "0000110e-0000-1000-8000-00805f9b34fb", "00001124-0000-1000-8000-00805f9b34fb" };
  // connect: hizmetleri kapat-aç (Windows cihaza yeniden bağlanır); değilse kapat (bağlantı kopar)
  public static bool Connect(string addr, bool connect) {
    var r = Radio(); if (r == IntPtr.Zero) return false;
    var sp = Sp(r); var d = new Dev { size = (uint)Marshal.SizeOf(typeof(Dev)) }; bool found = false; Dev hit = d;
    var h = BluetoothFindFirstDevice(ref sp, ref d);
    if (h != IntPtr.Zero) { do { if (d.addr.ToString("X12") == addr) { hit = d; found = true; break; } d.size = (uint)Marshal.SizeOf(typeof(Dev)); } while (BluetoothFindNextDevice(h, ref d)); BluetoothFindDeviceClose(h); }
    bool ok = false;
    if (found) foreach (var s in Svc) {
      var g = new Guid(s);
      if (connect) { BluetoothSetServiceState(r, ref hit, ref g, 0); if (BluetoothSetServiceState(r, ref hit, ref g, 1) == 0) ok = true; }
      else { if (BluetoothSetServiceState(r, ref hit, ref g, 0) == 0) ok = true; }
    }
    CloseHandle(r); return ok;
  }
}
"@
Add-Type -AssemblyName System.Runtime.WindowsRuntime
[void][Windows.Networking.Connectivity.NetworkInformation, Windows.Networking.Connectivity, ContentType = WindowsRuntime]
[void][Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager, Windows.Networking.NetworkOperators, ContentType = WindowsRuntime]
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($op, $type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); [void]$t.Wait(30000); $t.Result }
function Out1($s) { [Console]::Out.WriteLine($s); [Console]::Out.Flush() }
function Hs($cmd) {
  try {
    $prof = [Windows.Networking.Connectivity.NetworkInformation]::GetInternetConnectionProfile()
    if (-not $prof) { Out1('hs none'); return }
    $m = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager]::CreateFromConnectionProfile($prof)
    if ($cmd -eq 'on' -and $m.TetheringOperationalState -ne 'On') { [void](Await ($m.StartTetheringAsync()) ([Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult, Windows.Networking.NetworkOperators, ContentType = WindowsRuntime])) }
    elseif ($cmd -eq 'off' -and $m.TetheringOperationalState -ne 'Off') { [void](Await ($m.StopTetheringAsync()) ([Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult, Windows.Networking.NetworkOperators, ContentType = WindowsRuntime])) }
    Out1('hs ' + $(if ($m.TetheringOperationalState -eq 'On') { 'on' } else { 'off' }))
  } catch { Out1('hs none') }
}
Out1('ready')
while (($l = [Console]::In.ReadLine()) -ne $null) {
  $p = $l.Trim().Split(' ')
  try {
    switch ($p[0]) {
      'bt' { $r = [Bt]::List(); if ($r.Count -eq 0) { Out1('btnone') } else { $r | ForEach-Object { Out1('bt|' + $_) }; Out1('btend') } }
      'btc' { $ok = [Bt]::Connect($p[1], $p[2] -eq '1'); Out1('btc ' + $(if ($ok) { 'ok' } else { 'fail' })) }
      'hs' { Hs $p[1] }
    }
  } catch { Out1('err ' + $_.Exception.Message) }
}
