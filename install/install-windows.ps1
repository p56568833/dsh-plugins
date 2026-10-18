#Requires -Version 5.1
<#
.SYNOPSIS
    Install the 8 self-authored DSH plugins from this repository into a DSH profile.

.DESCRIPTION
    Calls the DSH CLI ("dsh plugin --profile <name> add <dir>"), which runs pnpm in the
    profile directory, records each plugin as a link: dependency and appends it to
    dsh.profile.bundles so it is enabled after the next start.

    Requirements:
      * DeepSeek Harness is installed and has been started at least once.
      * The "dsh" command is registered: app menu -> "Manage dsh command..." -> Install.
      * This repository lives on the same drive as the user profile (C: by default),
        because link: installs use directory junctions on Windows.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\install\install-windows.ps1

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\install\install-windows.ps1 -DryRun
#>
[CmdletBinding()]
param(
    [string]$Profile = 'desktop',
    [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot),
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$pluginNames = @(
    'dsh-approval-clear',
    'dsh-claude-style-addons',
    'dsh-cost-balance',
    'dsh-market-sidebar',
    'dsh-plugin-groups',
    'dsh-plugin-l10n-zh',
    'dsh-todo-bar',
    'dsh-whale-splash'
)

$profileDir = Join-Path $env:USERPROFILE ".dsh\profiles\$Profile"
if (-not (Test-Path -LiteralPath $profileDir)) {
    throw "DSH profile not found: $profileDir. Start DeepSeek Harness once on this machine first."
}

$dshCommand = Get-Command dsh -ErrorAction SilentlyContinue
if (-not $dshCommand) {
    throw "The 'dsh' command was not found on PATH. In DSH open the app menu, choose 'Manage dsh command...', install it, then reopen PowerShell."
}
$dshExe = if ($dshCommand.Path) { $dshCommand.Path } else { $dshCommand.Source }

$paths = @()
foreach ($name in $pluginNames) {
    $dir = Join-Path $RepoRoot "plugins\$name"
    if (-not (Test-Path -LiteralPath (Join-Path $dir 'package.json'))) {
        throw "Plugin package is missing or incomplete: $dir"
    }
    $paths += $dir
}

Write-Host "Repo root : $RepoRoot"
Write-Host "Profile   : $profileDir"
Write-Host "Plugins   : $($paths.Count)"
foreach ($path in $paths) { Write-Host "            $path" }

if ($DryRun) {
    Write-Host ""
    Write-Host "Dry run only. Nothing was installed."
    exit 0
}

Write-Host ""
Write-Host "Running: dsh plugin --profile $Profile add <8 paths>"
& $dshExe plugin --profile $Profile add @paths
if ($LASTEXITCODE -ne 0) {
    throw "dsh plugin add failed with exit code $LASTEXITCODE. Nothing else was changed by this script."
}

Write-Host ""
Write-Host "Done."
Write-Host "Quit DeepSeek Harness completely (tray icon -> Quit), then start it again."
Write-Host "Optional: install the third-party plugins listed in third-party/plugins.json."
