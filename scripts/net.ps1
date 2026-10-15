# Ağ hızını bayt/sn olarak yazar: "net <indirme> <yükleme>"
$prev = $null; $t0 = Get-Date
while ($true) {
  try {
    $rx = 0; $tx = 0
    foreach ($n in [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
      if ($n.OperationalStatus -eq 'Up' -and $n.NetworkInterfaceType -ne 'Loopback' -and $n.NetworkInterfaceType -ne 'Tunnel') { $s = $n.GetIPv4Statistics(); $rx += $s.BytesReceived; $tx += $s.BytesSent }
    }
    $now = Get-Date; $dt = ($now - $t0).TotalSeconds
    if ($prev -and $dt -gt 0) {
      [Console]::Out.WriteLine('net ' + [math]::Max(0, [math]::Round(($rx - $prev[0]) / $dt)) + ' ' + [math]::Max(0, [math]::Round(($tx - $prev[1]) / $dt))); [Console]::Out.Flush()
    }
    $prev = @($rx, $tx); $t0 = $now
  } catch [System.IO.IOException] { break } catch {}
  Start-Sleep -Seconds 2
}
