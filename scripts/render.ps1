# Video render izleyici (DaVinci Resolve, Premiere Pro, Media Encoder, CapCut). Render sırasında uygulamanın ilerleme penceresindeki
# ilerleme çubuğundan yüzde, (varsa) metinlerden kalan süre ve hız okunur (UI Automation, ekran görüntüsü alınmaz).
# Çıktı (satır satır): R|<yüzde>|<HH:MM:SS kalan>|<fps>|<uygulama>  render sürerken, N  render yokken (yalnızca değişimde).
# Resolve doğrulanmış yol: dile bağlı metne bakılmaz, pencere "ilerleme çubuğu + HH:MM:SS" ile tanınır.
# Diğerleri en iyi çaba: bu uygulamaların arayüzü UI Automation'a sınırlı açılır, ilerleme çubuğu görünürse okunur.
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$AE = [System.Windows.Automation.AutomationElement]
$CT = [System.Windows.Automation.ControlType]
$TS = [System.Windows.Automation.TreeScope]
$root = $AE::RootElement
$barCond = New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, $CT::ProgressBar)
$textCond = New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, $CT::Text)
# UI Automation'ın kök listesi uygulama arka plandayken Qt pencerelerini döndürmeyebiliyor (başka pencerede çalışırken render algılanmıyordu).
# Pencereler Win32 ile (odaktan bağımsız) bulunur, içerikleri tutamaçtan UI Automation ile okunur.
Add-Type -Namespace W -Name E -MemberDefinition @'
public delegate bool EnumProc(IntPtr h, IntPtr l);
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
'@
function Get-Wins($procId) {
  $list = New-Object System.Collections.ArrayList
  $cb = [W.E+EnumProc]{ param($h, $l)
    $x = [uint32]0; [void][W.E]::GetWindowThreadProcessId($h, [ref]$x)
    if ($x -eq $procId -and [W.E]::IsWindowVisible($h)) { [void]$list.Add($h) }
    return $true }
  [void][W.E]::EnumWindows($cb, [IntPtr]::Zero)
  foreach ($h in $list) { try { $AE::FromHandle($h) } catch { } }
}
$apps = @(
  @{ proc = 'Resolve';             label = 'DaVinci Resolve'; main = 'DaVinci Resolve*';       strict = $true;  skipMain = $true },
  @{ proc = 'Adobe Premiere Pro';  label = 'Premiere Pro';    main = 'Adobe Premiere Pro*';    strict = $false; skipMain = $true },
  @{ proc = 'Adobe Media Encoder'; label = 'Media Encoder';   main = 'Adobe Media Encoder*';   strict = $false; skipMain = $false },
  @{ proc = 'CapCut';              label = 'CapCut';          main = 'CapCut*';                strict = $false; skipMain = $false }
)

function Get-Pct($bar) {
  $r = $bar.GetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern).Current
  $span = $r.Maximum - $r.Minimum
  if ($span -le 0) { return -1 }
  return [math]::Round(($r.Value - $r.Minimum) * 100 / $span)
}

function Scan($app, $p) {
  foreach ($w in (Get-Wins $p.Id)) {
    if ($app.skipMain -and $w.Current.Name -like $app.main) { continue }   # ana pencere: pahalı ve gereksiz
    if ($app.strict) {
      $bar = $w.FindFirst($TS::Descendants, $barCond)
      if (-not $bar) { continue }
      $names = @(); foreach ($t in $w.FindAll($TS::Descendants, $textCond)) { $names += $t.Current.Name }
      $all = $names -join ' | '
      if ($all -notmatch '(\d{2}:\d{2}:\d{2})') { continue }
      $rem = $Matches[1]
      $fps = ''; if ($all -match '(\d+)\s*fps') { $fps = $Matches[1] }
      $pct = Get-Pct $bar
      if ($pct -lt 0) { continue }
      return "R|$pct|$rem|$fps|$($app.label)"
    }
    # en iyi çaba: devam eden (0-100 arası) ilerleme çubuğu + pencerede dışa aktarma/kodlama sözcüğü
    $pct = -1
    foreach ($bar in $w.FindAll($TS::Descendants, $barCond)) {
      try { $v = Get-Pct $bar } catch { continue }
      if ($v -gt 0 -and $v -lt 100) { $pct = $v; break }
    }
    if ($pct -lt 0) { continue }
    $names = @($w.Current.Name); foreach ($t in $w.FindAll($TS::Descendants, $textCond)) { $names += $t.Current.Name }
    $all = $names -join ' | '
    if ($all -notmatch '(?i)(export|encod|render|dışa aktar|kodla|aktarım)') { continue }
    $rem = ''; if ($all -match '(\d{1,2}:\d{2}:\d{2})') { $rem = $Matches[1] }
    return "R|$pct|$rem||$($app.label)"
  }
  return $null
}

$prev = 'N'
while ($true) {
  $out = 'N'; $any = $false; $slow = $false
  foreach ($app in $apps) {
    $p = Get-Process -Name $app.proc -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $p) { continue }
    $any = $true; if (-not $app.strict) { $slow = $true }
    try { $r = Scan $app $p; if ($r) { $out = $r; break } } catch { }
  }
  if ($out -ne 'N' -or $prev -ne 'N') { [Console]::Out.WriteLine($out); [Console]::Out.Flush() }
  $prev = $out
  if ($out -ne 'N') { Start-Sleep -Milliseconds 800 } elseif ($slow) { Start-Sleep -Seconds 3 } elseif ($any) { Start-Sleep -Milliseconds 1500 } else { Start-Sleep -Seconds 5 }
}
