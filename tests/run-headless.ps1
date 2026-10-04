param(
  [ValidateSet('all', 'term', 'model', 'ui', 'sm', 'aduc', 'dns', 'dhcp', 'evt', 'disk', 'comp', 'fw', 'net', 'explorer', 'fss', 'gpo', 'tm', 'labs', 'shell', 'settings', 'iis', 'hv', 'gpp', 'snap', 'mount')][string]$Test = 'all',
  # Screenshot mode passed to the page as &shot=<name> (each test file lists its modes). Needs a single -Test.
  [string]$Shot = ''
)
# Fresh profiles isolate test mutations from the user's lab. Run from any directory.
$ErrorActionPreference = 'Stop'
$workspace = Split-Path $PSScriptRoot -Parent
$outputDir = Join-Path $workspace '.test-output'
New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
$browser = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
if (!(Test-Path -LiteralPath $browser)) { $browser = 'C:\Program Files\Google\Chrome\Application\chrome.exe' }
if (!(Test-Path -LiteralPath $browser)) { throw 'Install Edge or Chrome to run the headless tests.' }
$tests = if ($Test -eq 'all') { @('term', 'model', 'ui', 'sm', 'aduc', 'dns', 'dhcp', 'evt', 'disk', 'comp', 'fw', 'net', 'explorer', 'fss', 'gpo', 'tm', 'labs', 'shell', 'settings', 'iis', 'hv', 'gpp', 'snap', 'mount') } else { @($Test) }
if ($Shot -and $tests.Count -ne 1) { throw 'Use -Shot with a single -Test suite.' }
if ($Shot -and $Shot -notmatch '^[\w-]+$') { throw 'Shot names are letters, digits, - and _.' }
$failed = $false
foreach ($suite in $tests) {
  $profile = Join-Path $outputDir ($suite + '-' + [guid]::NewGuid().ToString('N'))
  $pagePath = Join-Path $PSScriptRoot ($suite + '-test.html')
  $url = ([Uri]$pagePath).AbsoluteUri + '?quick=1'
  if ($Shot) { $url += '&shot=' + $Shot }
  $label = if ($Shot) { $suite + '-' + $Shot } else { $suite }
  $log = Join-Path $outputDir ($label + '.log')
  $dom = Join-Path $outputDir ($label + '-dom.html')
  $screenshot = Join-Path $outputDir ($label + '.png')
  Start-Process -FilePath $browser -WindowStyle Hidden -ArgumentList @(
    '--headless=new', '--disable-gpu', ('--user-data-dir="' + $profile + '"'),
    '--enable-logging=stderr', '--v=0', '--no-first-run', '--window-size=1600,900',
    '--virtual-time-budget=60000', '--dump-dom', ('--screenshot="' + $screenshot + '"'), $url
  ) -Wait -RedirectStandardError $log -RedirectStandardOutput $dom
  $lines = Get-Content -LiteralPath $log
  $result = $lines | Where-Object { $_ -match 'CONSOLE.*"RESULT \d+ passed, \d+ failed"' }
  $errors = $lines | Where-Object { $_ -match 'CONSOLE.*(FAIL |Uncaught |SimulatorError)' }
  Write-Output ($suite + ':')
  $result | ForEach-Object { Write-Output $_ }
  $errors | ForEach-Object { Write-Output $_ }
  if (!$result -or $errors -or !($result -match 'RESULT \d+ passed, 0 failed')) { $failed = $true }
  # Only remove the GUID profile created by this iteration, within our output directory.
  $resolvedProfile = [IO.Path]::GetFullPath($profile)
  if ((Split-Path $resolvedProfile -Parent) -ne [IO.Path]::GetFullPath($outputDir)) { throw 'Unexpected profile path.' }
  Remove-Item -LiteralPath $resolvedProfile -Recurse -Force
}
if ($failed) { exit 1 }
