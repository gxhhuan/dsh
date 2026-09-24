# Stop a running DeepSeek Harness before an uninstall or upgrade replaces its files.
#
# Called by the uninstaller ([UninstallRun] in installer/DeepSeekHarness.iss)
# and available by hand:
#   powershell -NoProfile -ExecutionPolicy Bypass -File launchers\dsh-stop.ps1
#
# Deliberately bounded: it never kills every node.exe. It targets the process
# that owns a loopback listener, and node processes whose command line names this
# installation or the dsh package. Both signals are checked, because a clean
# shutdown releases the port but the console launcher can linger.
#
# This lives in a script file rather than inline in the .iss because an inline
# command line ended up with four levels of nested quoting, and Inno Setup
# interprets a bare '{' as the start of a constant — which is exactly how the
# '$_' inside a PowerShell pipeline broke the compile.
$ErrorActionPreference = 'SilentlyContinue'

$pids = New-Object System.Collections.Generic.HashSet[int]

# 1. Whatever holds a loopback listener (the Web GUI binds 127.0.0.1 only).
try {
  Get-NetTCPConnection -State Listen |
    Where-Object { $_.LocalAddress -in @('127.0.0.1', '::1') } |
    ForEach-Object { [void]$pids.Add([int]$_.OwningProcess) }
} catch {
  Write-Host "listener scan skipped: $($_.Exception.Message)"
}

# 2. node.exe processes that are clearly ours.
try {
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object { $_.CommandLine -like '*@deepseek-ai*dsh*' -or $_.CommandLine -like '*dsh-windows-installer*' -or $_.CommandLine -like '*launchers\dsh.cmd*' } |
    ForEach-Object { [void]$pids.Add([int]$_.ProcessId) }
} catch {
  Write-Host "process scan skipped: $($_.Exception.Message)"
}

# Never kill ourselves or our own shell.
$self = @($PID)
try { $self += (Get-CimInstance Win32_Process -Filter "ProcessId = $PID").ParentProcessId } catch { }

$targets = @($pids | Where-Object { $_ -gt 0 -and $self -notcontains $_ })
if ($targets.Count -eq 0) {
  Write-Host 'no running DeepSeek Harness process found'
  exit 0
}

foreach ($target in $targets) {
  Write-Host "stopping pid $target"
  & taskkill /PID $target /T /F 2>&1 | ForEach-Object { Write-Host $_ }
}

Start-Sleep -Milliseconds 500
exit 0
