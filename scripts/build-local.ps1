<#
.SYNOPSIS
  Build the DeepSeek Harness Windows installer on a Windows machine.

.DESCRIPTION
  Runs the exact steps the CI workflow runs, so a local build and a GitHub
  Actions build produce the same artifact:

    1. stage build\portable (download Node, npm install the dsh package, verify)
    2. smoke-test the staged app (boot the Web UI and fetch its shell)
    3. compile the installer with Inno Setup
    4. write dist\SHA256SUMS.txt and report what was produced

  Run it from the repository root:
      powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-local.ps1

  Common overrides:
      -DshVersion 0.1.5-rc.3   package a different dsh version
      -NodeVersion 24.21.0     bundle a different Node runtime
      -Registry https://registry.npmmirror.com   use a mirror
      -SkipSmoke               skip the boot test (not recommended)

.PARAMETER DshVersion
  @deepseek-ai/dsh version to package. Defaults to $env:DSH_VERSION or 0.1.5-rc.3.

.PARAMETER NodeVersion
  Node.js runtime version to bundle. Defaults to $env:NODE_VERSION or 24.21.0.

.PARAMETER Registry
  npm registry to use. Defaults to $env:NPM_REGISTRY (empty = npm default).

.PARAMETER SkipSmoke
  Skip the Web UI boot test.

.PARAMETER SkipInno
  Stage and smoke-test only; do not compile the installer.
#>
[CmdletBinding()]
param(
  [string]$DshVersion = $(if ($env:DSH_VERSION) { $env:DSH_VERSION } else { '0.1.5-rc.3' }),
  [string]$NodeVersion = $(if ($env:NODE_VERSION) { $env:NODE_VERSION } else { '24.21.0' }),
  [string]$Registry = $env:NPM_REGISTRY,
  [string]$GiteeRepo = $env:GITEE_REPO,
  [switch]$SkipSmoke,
  [switch]$SkipInno
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

function Write-Step([string]$text) {
  Write-Host ''
  Write-Host "==== $text" -ForegroundColor Cyan
}

function Find-Iscc {
  $fromPath = Get-Command ISCC.exe -ErrorAction SilentlyContinue
  if ($fromPath) { return $fromPath.Source }
  # ${env:ProgramFiles(x86)} must use the braces form; it is empty on 32-bit hosts.
  $roots = @(${env:ProgramFiles(x86)}, $env:ProgramFiles) | Where-Object { $_ }
  foreach ($root in $roots) {
    foreach ($version in @('Inno Setup 6', 'Inno Setup 7')) {
      $candidate = Join-Path $root "$version\ISCC.exe"
      if (Test-Path $candidate) { return $candidate }
    }
  }
  return $null
}

function Install-Iscc {
  Write-Host 'Inno Setup was not found; trying winget, then Chocolatey...' -ForegroundColor Yellow
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    try {
      winget install --id JRSoftware.InnoSetup --accept-source-agreements --accept-package-agreements --silent
    } catch {
      Write-Warning "winget failed: $($_.Exception.Message)"
    }
  }
  if (-not (Find-Iscc) -and (Get-Command choco -ErrorAction SilentlyContinue)) {
    try {
      choco install innosetup --no-progress -y
    } catch {
      Write-Warning "choco failed: $($_.Exception.Message)"
    }
  }
  return (Find-Iscc)
}

Write-Host "DeepSeek Harness Windows installer build" -ForegroundColor Green
Write-Host "  repository : $root"
Write-Host "  dsh        : $DshVersion"
Write-Host "  node       : $NodeVersion"
Write-Host "  registry   : $(if ($Registry) { $Registry } else { '(npm default)' })"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Node.js is required to run the packaging scripts (https://nodejs.org).'
}
$hostNode = (& node --version).TrimStart('v')
$hostMajor = [int]($hostNode -split '\.')[0]
if ($hostMajor -lt 22) { throw "packaging scripts need Node >= 22, found $hostNode" }

$env:DSH_VERSION = $DshVersion
$env:NODE_VERSION = $NodeVersion
$env:DSH_ARCH = 'x64'
if ($Registry) { $env:NPM_REGISTRY = $Registry } else { Remove-Item Env:NPM_REGISTRY -ErrorAction SilentlyContinue }

Write-Step 'Step 1/4: stage build\portable'
& node scripts/prepare-portable.mjs
if ($LASTEXITCODE -ne 0) { throw "staging failed with exit code $LASTEXITCODE" }

if (-not $SkipSmoke) {
  Write-Step 'Step 2/4: smoke-test the staged app'
  & node scripts/smoke-test.mjs
  if ($LASTEXITCODE -ne 0) { throw "smoke test failed with exit code $LASTEXITCODE" }
} else {
  Write-Step 'Step 2/4: smoke test skipped (-SkipSmoke)'
}

if ($SkipInno) {
  Write-Step 'Step 3/4: installer compile skipped (-SkipInno)'
  Write-Host 'Staged app is ready at build\portable' -ForegroundColor Green
  exit 0
}

Write-Step 'Step 3/4: compile the installer'
$iscc = Find-Iscc
if (-not $iscc) { $iscc = Install-Iscc }
if (-not $iscc) {
  throw @'
Inno Setup is required to build the installer.
Install it, then re-run this script:
  winget install --id JRSoftware.InnoSetup
  choco install innosetup -y
or download it from https://jrsoftware.org/isdl.php
'@
}
Write-Host "  ISCC : $iscc"
Remove-Item (Join-Path $root 'dist') -Recurse -Force -ErrorAction SilentlyContinue
& $iscc "/DMyAppVersion=$DshVersion" (Join-Path $root 'installer\DeepSeekHarness.iss')
if ($LASTEXITCODE -ne 0) { throw "ISCC failed with exit code $LASTEXITCODE" }

Write-Step 'Step 4/4: checksums, release notes, and summary'
$installers = Get-ChildItem (Join-Path $root 'dist') -Filter '*.exe'
if (-not $installers) { throw 'ISCC reported success but produced no .exe in dist\' }
$lines = foreach ($file in $installers) {
  $hash = (Get-FileHash $file.FullName -Algorithm SHA256).Hash.ToLower()
  "$hash  $($file.Name)"
}
$lines | Set-Content -Path (Join-Path $root 'dist\SHA256SUMS.txt') -Encoding ascii
$lines | ForEach-Object { Write-Host "  $_" }

$notes = @(
  "## DeepSeek Harness Windows x64 — $DshVersion",
  '',
  '- 免管理员安装到用户目录；首次使用请在「设置 → 模型」里配置你自己的 DeepSeek API Key。',
  "- 内置 Node.js $NodeVersion，目标机器无需安装 Node。",
  '- 下载后可用 `SHA256SUMS.txt` 校验安装包完整性。',
  '',
  'Per-user install, no administrator rights required. Configure your own',
  'DeepSeek API key on first run (Settings -> Models). Node.js is bundled.'
) -join "`r`n"
$notes | Set-Content -Path (Join-Path $root 'dist\RELEASE-NOTES.md') -Encoding utf8

Write-Host ''
Write-Host "Built in $($root)\dist:" -ForegroundColor Green
Get-ChildItem (Join-Path $root 'dist') | ForEach-Object {
  Write-Host ("  {0,-52} {1,10:N1} MiB" -f $_.Name, ($_.Length / 1MB))
}

Write-Host ''
Write-Host 'Publish to Gitee (发行版):' -ForegroundColor Cyan
if ($GiteeRepo) {
  Write-Host "  `$env:GITEE_TOKEN = '<你的 Gitee 私人令牌>'"
  Write-Host "  node scripts/upload-to-gitee.mjs --repo $GiteeRepo --tag v$DshVersion"
} else {
  Write-Host '  node scripts/upload-to-gitee.mjs --repo 你的用户名/仓库名 --tag v' -NoNewline
  Write-Host $DshVersion
  Write-Host '  （也可以直接在 Gitee 网页上创建发行版并拖入 dist\*.exe）'
}
Write-Host '  注意：Gitee 单个附件上限 100MB；超限时脚本会提前拒绝并给出处理建议。'

