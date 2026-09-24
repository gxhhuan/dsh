# DeepSeek Harness diagnostics. Run this when the GUI does not start, then send
# the output (or its file) to whoever gave you the installer.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File dsh-diagnose.ps1
#
# Nothing here reads your API key value: the credential store is only reported
# as present or absent.

$ErrorActionPreference = 'Continue'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $here

function Write-Section([string]$title) {
  Write-Output ''
  Write-Output "== $title"
}

Write-Output "DeepSeek Harness diagnostics"
Write-Output "generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')"

Write-Section 'Installation'
$versionFile = Join-Path $root 'VERSION.txt'
if (Test-Path $versionFile) { Get-Content $versionFile | ForEach-Object { Write-Output $_ } }
Write-Output "install root : $root"
Write-Output "launchers    : $here"

Write-Section 'Bundled runtime'
$nodeExe = Join-Path $root 'node.exe'
if (Test-Path $nodeExe) {
  Write-Output "node.exe     : $nodeExe"
  Write-Output "version      : $(& $nodeExe --version 2>&1)"
} else {
  Write-Output "node.exe MISSING at $nodeExe"
}

$bin = Join-Path $root 'app\node_modules\@deepseek-ai\dsh\lib\bin.js'
Write-Output "dsh entry    : $bin"
Write-Output "entry exists : $(Test-Path $bin)"

Write-Section 'Data locations'
$userHome = $env:USERPROFILE
$defaultHome = Join-Path $userHome '.dsh'
$effectiveHome = if ([string]::IsNullOrEmpty($env:DSH_HOME)) { $defaultHome } else { $env:DSH_HOME }
Write-Output "USERPROFILE  : $userHome"
Write-Output "DSH_HOME     : $effectiveHome$(if ([string]::IsNullOrEmpty($env:DSH_HOME)) { ' (default)' } else { ' (set)' })"
Write-Output "home exists  : $(Test-Path $effectiveHome)"
$credentials = Join-Path $effectiveHome '.credentials.yaml'
if (Test-Path $credentials) {
  $hasKey = (Select-String -Path $credentials -Pattern 'DEEPSEEK_API_KEY' -Quiet)
  Write-Output "credential   : present (API key $(if ($hasKey) { 'configured' } else { 'not configured' }))"
} else {
  Write-Output 'credential   : absent (configure your API key in the Web UI: Settings -> Models)'
}
Write-Output "profiles     : $((Get-ChildItem (Join-Path $effectiveHome 'profiles') -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name) -join ', ')"

Write-Section 'Running processes'
$dshProcesses = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like '*deepseek-ai*dsh*' -or $_.CommandLine -like '*dsh.cmd*' }
if ($dshProcesses) {
  $dshProcesses | ForEach-Object { Write-Output "pid $($_.ProcessId): $($_.CommandLine)" }
} else {
  Write-Output 'no dsh node.exe process is running'
}

Write-Section 'Listening ports (loopback only is expected)'
$listeners = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $_.LocalAddress -in @('127.0.0.1', '::1') } |
  Sort-Object LocalPort
if ($listeners) {
  $listeners | ForEach-Object { Write-Output "$($_.LocalAddress):$($_.LocalPort)  pid $($_.OwningProcess)" }
} else {
  Write-Output 'no loopback listeners found'
}

Write-Section 'Latest log'
$logDir = Join-Path $effectiveHome 'logs'
if (Test-Path $logDir) {
  $latest = Get-ChildItem $logDir -Filter '*.log' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($latest) {
    Write-Output "file: $($latest.FullName)"
    Write-Output '--- last 40 lines ---'
    Get-Content $latest.FullName -Tail 40 | ForEach-Object { Write-Output $_ }
  } else {
    Write-Output 'no log files yet'
  }
} else {
  Write-Output "no log directory at $logDir (the GUI has not been started from the shortcut yet)"
}

Write-Section 'Done'
Write-Output 'Send this whole output when asking for help.'
