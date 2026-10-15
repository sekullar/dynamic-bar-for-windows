# Windows medya oturumunu (GSMTC) izler; stdin'den playpause/next/prev komutu alır; hataları {"error":..} olarak bildirir
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
function Emit($o) { [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress)); [Console]::Out.Flush() }
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
  function Await($op, $type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); [void]$t.Wait(-1); $t.Result }
  $tMgr = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime]
  $tProps = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties,Windows.Media.Control,ContentType=WindowsRuntime]
  $tStream = [Windows.Storage.Streams.IRandomAccessStreamWithContentType,Windows.Storage.Streams,ContentType=WindowsRuntime]
  $mgr = Await ($tMgr::RequestAsync()) $tMgr
  # Console.In.ReadLineAsync() .NET Framework'te senkron çalışıp betiği kilitler; kendi StreamReader'ımızı kullanıyoruz
  $reader = New-Object System.IO.StreamReader([Console]::OpenStandardInput())
} catch { Emit @{ error = "init: $($_.Exception.Message)" }; exit 1 }

function Get-Art($p) {
  try {
    if (-not $p.Thumbnail) { return $null }
    $st = Await ($p.Thumbnail.OpenReadAsync()) $tStream
    $ms = New-Object System.IO.MemoryStream
    [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($st).CopyTo($ms)
    [Convert]::ToBase64String($ms.ToArray())
  } catch { $null }
}

$cmd = $reader.ReadLineAsync(); $last = ''; $lastKey = ''; $lastErr = ''
while ($true) {
  try {
    # çalan oturum varsa onu, yoksa sistemin "güncel" oturumunu seç
    $s = $mgr.GetSessions() | Where-Object { "$($_.GetPlaybackInfo().PlaybackStatus)" -eq 'Playing' } | Select-Object -First 1
    if (-not $s) { $s = $mgr.GetCurrentSession() }
    if ($cmd.IsCompleted) {
      $c = $cmd.Result
      if ($null -eq $c) { break }   # ana uygulama kapandı
      $cmd = $reader.ReadLineAsync()
      if ($s) {
        switch ($c) {
          'playpause' { [void](Await ($s.TryTogglePlayPauseAsync()) ([bool])) }
          'next'      { [void](Await ($s.TrySkipNextAsync()) ([bool])) }
          'prev'      { [void](Await ($s.TrySkipPreviousAsync()) ([bool])) }
        }
      }
      Start-Sleep -Milliseconds 200; $last = ''
    }
    if (-not $s) { $o = [ordered]@{ none = $true } }
    else {
      $p = Await ($s.TryGetMediaPropertiesAsync()) $tProps
      $info = $s.GetPlaybackInfo(); $tl = $s.GetTimelineProperties()
      $pos = $tl.Position.TotalSeconds
      if ("$($info.PlaybackStatus)" -eq 'Playing') { $pos += ([DateTimeOffset]::Now - $tl.LastUpdatedTime).TotalSeconds }
      $dur = $tl.EndTime.TotalSeconds - $tl.StartTime.TotalSeconds
      if ($dur -gt 0 -and $pos -gt $dur) { $pos = $dur }
      if ($pos -lt 0) { $pos = 0 }
      $key = "$($p.Title)|$($p.Artist)"
      $o = [ordered]@{ key = $key; title = $p.Title; artist = $p.Artist; status = "$($info.PlaybackStatus)"; pos = [math]::Floor($pos); dur = [math]::Floor($dur) }
      if ($key -ne $lastKey) { $lastKey = $key; $o.art = Get-Art $p }
    }
    $json = $o | ConvertTo-Json -Compress
    if ($json -ne $last) { $last = $json; [Console]::Out.WriteLine($json); [Console]::Out.Flush() }
  } catch {
    if ($_.Exception -is [System.IO.IOException]) { break }
    $m = $_.Exception.Message
    if ($m -ne $lastErr) { $lastErr = $m; try { Emit @{ error = $m } } catch { break } }
  }
  Start-Sleep -Milliseconds 700
}
