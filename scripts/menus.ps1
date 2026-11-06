# Uygulamanın kendi menü çubuğunu (UI Automation) okur ve açar. stdin: "scan <hwnd>" | "open <hwnd> <sıra>".
# stdout: "menus <hwnd> Dosya|Düzen|..." (menü yoksa "menus <hwnd> -"). Hazır olunca "ready".
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$AE = [Windows.Automation.AutomationElement]
function Bar($h) {
  $root = $AE::FromHandle([IntPtr][long]$h)
  $cond = New-Object Windows.Automation.PropertyCondition($AE::ControlTypeProperty, [Windows.Automation.ControlType]::MenuBar)
  return $root.FindFirst([Windows.Automation.TreeScope]::Descendants, $cond)
}
function Items($bar) { return $bar.FindAll([Windows.Automation.TreeScope]::Children, [Windows.Automation.Condition]::TrueCondition) }
[Console]::Out.WriteLine('ready'); [Console]::Out.Flush()
while (($l = [Console]::In.ReadLine()) -ne $null) {
  $p = $l.Trim().Split(' ')
  try {
    if ($p[0] -eq 'scan') {
      $bar = Bar $p[1]; $names = @()
      if ($bar) { foreach ($i in (Items $bar)) { $n = $i.Current.Name; if ($n) { $names += $n } } }
      [Console]::Out.WriteLine('menus ' + $p[1] + ' ' + $(if ($names.Count) { $names -join '|' } else { '-' })); [Console]::Out.Flush()
    } elseif ($p[0] -eq 'open') {
      $bar = Bar $p[1]; if (-not $bar) { continue }
      $it = (Items $bar)[[int]$p[2]]
      try { $it.GetCurrentPattern([Windows.Automation.ExpandCollapsePattern]::Pattern).Expand() }
      catch { $it.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke() }
    }
  } catch { [Console]::Out.WriteLine('menus ' + $p[1] + ' -'); [Console]::Out.Flush() }
}
