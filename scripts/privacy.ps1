# Mikrofon ve kamera kullanımı. Windows hangi uygulamanın mikrofona/kameraya eriştiğini kayıt defterinde tutar
# (CapabilityAccessManager\ConsentStore): LastUsedTimeStart > 0 ve LastUsedTimeStop = 0 ise uygulama şu an kullanıyor.
# Çıktı (yalnızca değişimde): P|<mikrofon kullanan uygulamalar, ; ile>|<kamera kullanan uygulamalar>   ya da   N   (kimse kullanmıyor)
# Çalışmayan uygulamalardan kalan eski kayıtlar (çökme sonrası Stop hiç yazılmaz) sayılmaz.
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$base = 'Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\'

function Get-InUse($kind, $running) {
  $out = @()
  $root = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($base + $kind)
  if (-not $root) { return $out }
  foreach ($name in $root.GetSubKeyNames()) {
    if ($name -eq 'NonPackaged') {
      $np = $root.OpenSubKey('NonPackaged')
      foreach ($n in $np.GetSubKeyNames()) {
        $k = $np.OpenSubKey($n); if (-not $k) { continue }
        $start = [int64]($k.GetValue('LastUsedTimeStart', 0)); $stop = [int64]($k.GetValue('LastUsedTimeStop', 0))
        if ($start -gt 0 -and $stop -eq 0) {
          $exe = [System.IO.Path]::GetFileNameWithoutExtension(($n -split '#')[-1])
          if ($running.Contains($exe.ToLower())) { $out += $exe }
        }
        $k.Close()
      }
    } else {
      $k = $root.OpenSubKey($name); if (-not $k) { continue }
      $start = [int64]($k.GetValue('LastUsedTimeStart', 0)); $stop = [int64]($k.GetValue('LastUsedTimeStop', 0))
      if ($start -gt 0 -and $stop -eq 0) { $out += ($name -split '_')[0] }
      $k.Close()
    }
  }
  return $out
}

$prev = 'N'
while ($true) {
  try {
    $running = New-Object 'System.Collections.Generic.HashSet[string]'
    foreach ($p in [System.Diagnostics.Process]::GetProcesses()) { [void]$running.Add($p.ProcessName.ToLower()) }
    $m = (Get-InUse 'microphone' $running) -join ';'
    $c = (Get-InUse 'webcam' $running) -join ';'
    $out = if ($m -or $c) { "P|$m|$c" } else { 'N' }
    if ($out -ne $prev) { [Console]::Out.WriteLine($out); [Console]::Out.Flush(); $prev = $out }
  } catch { }
  Start-Sleep -Milliseconds 1500
}
