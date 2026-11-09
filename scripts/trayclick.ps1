# Sistem tepsisi simgesine sağ tık. Tepsi paneli açılınca önceden başlatılır (UI Automation yüklü bekler); stdin'e "ad1|ad2|ad3"
# satırı gelince Windows'un gizli simgeler panelini açar (açıksa yeniden kullanır), panelin penceresini adı eşleşen simgenin tam
# imlecin bulunduğu noktaya (sağ tıkın yapıldığı yer) denk gelecek şekilde kaydırıp görünmez yapar ve simgeye sağ tıklar:
# uygulamanın kendi bağlam menüsü imlecin olduğu yerde açılır. Tıklamadan sonra panel ekran dışına alınır ve tıklamaya şeffaf olur.
# stdin: "<adlar>" | "close" (paneli kapat). Çıktı: "ready", her komut için "ok" ya da "nomatch" (eşleşme yok; panel açık bırakılır).
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms
Add-Type -MemberDefinition @'
[DllImport("user32.dll")] public static extern void keybd_event(byte v, byte s, uint f, int e);
[DllImport("user32.dll")] public static extern void mouse_event(uint f, int x, int y, uint d, int e);
[DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int cx, int cy, uint f);
[DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
[DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr h, int i, int v);
[DllImport("user32.dll")] public static extern bool SetLayeredWindowAttributes(IntPtr h, uint k, byte a, uint f);
[DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
'@ -Name K -Namespace W
$AE = [Windows.Automation.AutomationElement]
$flyCond = New-Object Windows.Automation.PropertyCondition($AE::ClassNameProperty, 'TopLevelWindowForOverflowXamlIsland')
$btnCond = New-Object Windows.Automation.PropertyCondition($AE::ControlTypeProperty, [Windows.Automation.ControlType]::Button)
function Key($vk) { [W.K]::keybd_event($vk, 0, 0, 0); [W.K]::keybd_event($vk, 0, 2, 0) }
function Out1($s) { [Console]::Out.WriteLine($s); [Console]::Out.Flush() }
function Fly() { $AE::RootElement.FindFirst('Children', $flyCond) }
function Close-Fly() {
  $f = Fly
  if ($f) { [void][W.K]::PostMessage([IntPtr]$f.Current.NativeWindowHandle, 0x10, [IntPtr]::Zero, [IntPtr]::Zero); Start-Sleep -Milliseconds 150 }
  if (Fly) { Key 0x1B }
}
function Park($h) { # paneli ekran dışına al ve tıklamaya şeffaf yap (menü uygulamaya ait, panelden bağımsız açık kalır)
  [void][W.K]::SetWindowLong($h, -20, ([W.K]::GetWindowLong($h, -20) -bor 0x20))
  [void][W.K]::SetWindowPos($h, [IntPtr]::Zero, -32000, -32000, 0, 0, 0x15)
}
function Open-Fly() {
  $win = Fly
  if (-not $win) { [W.K]::keybd_event(0x5B, 0, 0, 0); Key 0x42; [W.K]::keybd_event(0x5B, 0, 2, 0); Start-Sleep -Milliseconds 120; Key 0x0D; for ($i = 0; $i -lt 40 -and -not $win; $i++) { $win = Fly; if (-not $win) { Start-Sleep -Milliseconds 50 } } }
  $win
}
function Names() { # gizli simgeler panelindeki gerçek simgelerin adları: "names|ad1|ad2|..."
  $win = Open-Fly; if (-not $win) { Out1 'names|'; return }
  $h = [IntPtr]$win.Current.NativeWindowHandle
  $ex = [W.K]::GetWindowLong($h, -20); [void][W.K]::SetWindowLong($h, -20, (($ex -bor 0x80000) -bor 0x20)); [void][W.K]::SetLayeredWindowAttributes($h, 0, 1, 2)
  [void][W.K]::SetWindowPos($h, [IntPtr]::Zero, -32000, -32000, 0, 0, 0x15)
  $n = @($win.FindAll('Descendants', $btnCond) | ForEach-Object { $_.Current.Name.Trim() } | Where-Object { $_.Length -ge 2 })
  Out1 ('names|' + ($n -join '|'))
}
$menuCond = New-Object Windows.Automation.PropertyCondition($AE::ClassNameProperty, '#32768')
function Run($names) {
  # önceki tıklamadan açık kalmış bir uygulama menüsü varsa kapat (yoksa eski menü yeni tıklamanın sonucu gibi görünür)
  try { if ($AE::RootElement.FindFirst('Children', $menuCond)) { Key 0x1B; Start-Sleep -Milliseconds 80 } } catch {}
  $orig = [Windows.Forms.Cursor]::Position
  $cands = @($names.Split('|') | ForEach-Object { $_.Trim().ToLower() } | Where-Object { $_.Length -ge 3 })
  $win = Fly
  if (-not $win) { # panel kapalı: aç (Win+B, Enter)
    [W.K]::keybd_event(0x5B, 0, 0, 0); Key 0x42; [W.K]::keybd_event(0x5B, 0, 2, 0)
    Start-Sleep -Milliseconds 120; Key 0x0D
    for ($i = 0; $i -lt 40 -and -not $win; $i++) { $win = Fly; if (-not $win) { Start-Sleep -Milliseconds 50 } }
  }
  if (-not $win) { Out1 'nomatch'; return }
  $hit = $null
  $generic = @('tray', 'client', 'windows', 'service', 'services', 'notification', 'notifications', 'helper', 'update', 'launcher')
  $toks = @($cands | ForEach-Object { $_ -split '[^\p{L}\p{N}]+' } | Where-Object { $_.Length -ge 5 -and $generic -notcontains $_ } | Select-Object -Unique)
  for ($t = 0; $t -lt 3 -and -not $hit; $t++) { # simgeler geç yüklenirse kısa süre tekrar dene
    $btns = @($win.FindAll('Descendants', $btnCond) | ForEach-Object { [pscustomobject]@{ B = $_; N = $_.Current.Name.Trim().ToLower() } } | Where-Object { $_.N.Length -ge 3 })
    # 1) tam eşleşme, 2) kapsama (en az 4 harf), 3) ayırt edici sözcük: "Vanguard Tray" ↔ "Riot Vanguard" gibi adlar için
    foreach ($e in $btns) { if ($cands -contains $e.N) { $hit = $e.B; break } }
    if (-not $hit) { foreach ($e in $btns) { foreach ($c in $cands) { if ($c.Length -ge 4 -and $e.N.Length -ge 4 -and ($e.N.Contains($c) -or $c.Contains($e.N))) { $hit = $e.B; break } }; if ($hit) { break } } }
    if (-not $hit) { foreach ($e in $btns) { foreach ($k in $toks) { if ($e.N.Contains($k)) { $hit = $e.B; break } }; if ($hit) { break } } }
    if (-not $hit) { Start-Sleep -Milliseconds 80 }
  }
  if (-not $hit) { Out1 'nomatch'; return }
  $h = [IntPtr]$win.Current.NativeWindowHandle
  $ex = [W.K]::GetWindowLong($h, -20)
  [void][W.K]::SetWindowLong($h, -20, (($ex -bor 0x80000) -band (-bnot 0x20))) # katmanlı, tıklanabilir
  [void][W.K]::SetLayeredWindowAttributes($h, 0, 1, 2) # alfa 0 tıklamayı geçirir; 1 görünmez ama tıklanabilir
  # paneli, simgenin merkezi tam imlecin altına gelecek biçimde kaydır; konum oturana kadar doğrula (eski konumla yanlış simgeye tıklanmasın)
  $ok = $false; $stable = 0
  for ($v = 0; $v -lt 8 -and -not $ok; $v++) {
    $wr = $win.Current.BoundingRectangle; $br = $hit.Current.BoundingRectangle
    $dx = [int]($orig.X - ($br.X + $br.Width / 2)); $dy = [int]($orig.Y - ($br.Y + $br.Height / 2))
    if ([Math]::Abs($dx) -le 2 -and [Math]::Abs($dy) -le 2) { $stable++; if ($stable -ge 2) { $ok = $true; break }; Start-Sleep -Milliseconds 50; continue } else { $stable = 0 }
    [void][W.K]::SetWindowPos($h, [IntPtr]::Zero, [int]($wr.X + $dx), [int]($wr.Y + $dy), 0, 0, 0x15)
    Start-Sleep -Milliseconds 60
  }
  if (-not $ok) { Park $h; Out1 ('nomatch dogrulama dx=' + $dx + ' dy=' + $dy + ' btn=' + $hit.Current.Name + ' at=yok'); return } # emin olamadıysak yanlış simgeye tıklamaktansa vazgeç
  [Windows.Forms.Cursor]::Position = $orig
  [W.K]::mouse_event(8, 0, 0, 0, 0); [W.K]::mouse_event(16, 0, 0, 0, 0)
  Start-Sleep -Milliseconds 120 # menü açılsın
  Park $h
  Out1 'ok'
}
# UI Automation'ı ısıt (ilk çağrı yavaştır)
try { [void](Fly) } catch {}
Out1 'ready'
while (($l = [Console]::In.ReadLine()) -ne $null) {
  $l = $l.Trim()
  try { if ($l -eq 'close') { Close-Fly } elseif ($l -eq 'names') { Names } else { Run $l } } catch { Out1 ('nomatch hata: ' + $_.Exception.Message) }
}
