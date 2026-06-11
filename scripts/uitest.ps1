# Saha UI smoke-test helper — adb ile metin-bazlı tap + screenshot.
# Kullanım: . .\scripts\uitest.ps1 ; sonra Tap-Text / Shot / Get-Bounds çağır.
$global:ADB = "C:\Users\PC\AppData\Local\Android\Sdk\platform-tools\adb.exe"
$global:PKG = "com.parla.saha"
$global:SHOTDIR = "C:\Users\PC\Desktop\navigasyon\.test-shots"
New-Item -ItemType Directory -Force -Path $global:SHOTDIR | Out-Null

function Dump-Ui {
  & $global:ADB shell uiautomator dump /sdcard/ui.xml *> $null
  & $global:ADB pull /sdcard/ui.xml "$global:SHOTDIR\ui.xml" *> $null
  & $global:ADB shell rm /sdcard/ui.xml *> $null
  return Get-Content "$global:SHOTDIR\ui.xml" -Raw
}

# Bir node'un text/content-desc'inde $needle geçen ilk clickable bounds merkezini bulur.
function Get-Center([string]$needle) {
  $xml = Dump-Ui
  # tüm node'ları regex ile çek
  $rx = [regex]'<node[^>]*?(?:text|content-desc)="([^"]*?)"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"'
  foreach ($m in $rx.Matches($xml)) {
    if ($m.Groups[1].Value -like "*$needle*") {
      $cx = [int](($m.Groups[2].Value -as [int]) + ($m.Groups[4].Value -as [int])) / 2
      $cy = [int](($m.Groups[3].Value -as [int]) + ($m.Groups[5].Value -as [int])) / 2
      return @{ x = $cx; y = $cy; text = $m.Groups[1].Value }
    }
  }
  return $null
}

function Tap-Text([string]$needle, [int]$wait = 1200) {
  $c = Get-Center $needle
  if ($null -eq $c) { Write-Output "TAP-MISS: '$needle'"; return $false }
  & $global:ADB shell input tap $c.x $c.y
  Start-Sleep -Milliseconds $wait
  Write-Output ("TAP-OK: '{0}' @ {1},{2}" -f $needle, $c.x, $c.y)
  return $true
}

function Tap-XY([int]$x, [int]$y, [int]$wait = 1000) {
  & $global:ADB shell input tap $x $y
  Start-Sleep -Milliseconds $wait
}

function Type-Text([string]$t, [int]$wait = 1400) {
  & $global:ADB shell input text $t
  Start-Sleep -Milliseconds $wait
}

function Shot([string]$name) {
  $p = "$global:SHOTDIR\$name.png"
  & $global:ADB shell screencap -p /sdcard/_s.png *> $null
  & $global:ADB pull /sdcard/_s.png $p *> $null
  & $global:ADB shell rm /sdcard/_s.png *> $null
  Write-Output "SHOT: $p"
}

function Back([int]$n = 1) { for ($i=0; $i -lt $n; $i++) { & $global:ADB shell input keyevent 4; Start-Sleep -Milliseconds 500 } }
function Focus { (& $global:ADB shell dumpsys window | Select-String "mCurrentFocus" | Select-Object -First 1).ToString().Trim() }
