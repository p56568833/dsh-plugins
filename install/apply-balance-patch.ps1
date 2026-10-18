#Requires -Version 5.1
<#
.SYNOPSIS
    Re-apply the local patch to dsh-balance-widget 0.6.3.

.DESCRIPTION
    The patch fixes session anchoring on DSH 0.2.x and folds subagent / team-member
    cost into the current-session and today totals. It only applies to version 0.6.3
    and is lost whenever the plugin is reinstalled or upgraded.

    Requires Git for Windows ("git" on PATH).

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\install\apply-balance-patch.ps1
#>
[CmdletBinding()]
param(
    [string]$Profile = 'desktop'
)

$ErrorActionPreference = 'Stop'

$packageDir = Join-Path $env:USERPROFILE ".dsh\profiles\$Profile\node_modules\dsh-balance-widget"
$patchPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'third-party\patches\dsh-balance-widget-0.6.3-subagent-cost.patch'

if (-not (Test-Path -LiteralPath (Join-Path $packageDir 'package.json'))) {
    throw "dsh-balance-widget is not installed in profile '$Profile': $packageDir"
}
if (-not (Test-Path -LiteralPath $patchPath)) {
    throw "Patch file not found: $patchPath"
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "git was not found on PATH. Install Git for Windows, or reinstall the plugin without this patch."
}

$version = (Get-Content -LiteralPath (Join-Path $packageDir 'package.json') -Raw | ConvertFrom-Json).version
if ($version -ne '0.6.3') {
    throw "This patch targets dsh-balance-widget 0.6.3, but $version is installed. Rebase the patch before applying."
}

& git -C $packageDir apply -R --check $patchPath 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Host "dsh-balance-widget $version is already patched. Nothing to do."
    exit 0
}

& git -C $packageDir apply $patchPath
if ($LASTEXITCODE -ne 0) {
    throw "git apply failed. The package files do not match the patch; reinstall dsh-balance-widget@0.6.3 and retry."
}

Write-Host "Patch applied to dsh-balance-widget $version."
Write-Host "Quit DeepSeek Harness completely (tray icon -> Quit), then start it again."
