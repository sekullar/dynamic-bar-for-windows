# DaVinci Resolve render izleyici. Render sırasında Resolve ana pencerenin dışında bir ilerleme penceresi açar;
# içindeki ilerleme çubuğundan yüzde, metinlerden kalan süre ve hız okunur (UI Automation, ekran görüntüsü alınmaz).
# Çıktı (satır satır): R|<yüzde>|<HH:MM:SS kalan>|<fps>   render sürerken, N   render yokken (yalnızca değişimde).
# Dile bağlı metinlere bakılmaz: pencere "ilerleme çubuğu + HH:MM:SS" ile tanınır.
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$AE = [System.Windows.Automation.AutomationElement]
$CT = [System.Windows.Automation.ControlType]
$root = $AE::RootElement
$barCond = New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, $CT::ProgressBar)
$textCond = New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, $CT::Text)
$prev = 'N'
while ($true) {
  $out = 'N'
  $p = Get-Process -Name Resolve -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($p) {
    try {
      $pid_ = New-Object System.Windows.Automation.PropertyCondition($AE::ProcessIdProperty, $p.Id)
      foreach ($w in $root.FindAll([System.Windows.Automation.TreeScope]::Children, $pid_)) {
        if ($w.Current.Name -like 'DaVinci Resolve*') { continue }   # ana pencere: pahalı ve gereksiz
        $bar = $w.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $barCond)
        if (-not $bar) { continue }
        $names = @(); foreach ($t in $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, $textCond)) { $names += $t.Current.Name }
        $all = $names -join ' | '
        if ($all -notmatch '(\d{2}:\d{2}:\d{2})') { continue }
        $rem = $Matches[1]
        $fps = ''; if ($all -match '(\d+)\s*fps') { $fps = $Matches[1] }
        $pct = [math]::Round($bar.GetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern).Current.Value)
        $out = "R|$pct|$rem|$fps"
        break
      }
    } catch { $out = 'N' }
  }
  if ($out -ne 'N' -or $prev -ne 'N') { [Console]::Out.WriteLine($out); [Console]::Out.Flush() }
  $prev = $out
  if ($out -ne 'N') { Start-Sleep -Milliseconds 800 } elseif ($p) { Start-Sleep -Milliseconds 1500 } else { Start-Sleep -Seconds 5 }
}
