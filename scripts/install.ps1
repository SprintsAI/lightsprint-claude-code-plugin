# Lightsprint Windows Installer
# Note: No local dev mode (LIGHTSPRINT_LOCAL_PATH) — Windows is production-only.
# Local development uses install.sh on macOS/Linux.
param(
    [string]$BaseUrl
)

$ErrorActionPreference = "Stop"

$repo = "SprintsAI/lightsprint-claude-code-plugin"
$marketplaceName = "lightsprint"
$pluginName = "lightsprint"
$pluginDir = "$env:USERPROFILE\.claude\plugins\marketplaces\lightsprint"
$binaryName = "lightsprint"
$installDir = "$env:LOCALAPPDATA\lightsprint"

Write-Host "Installing Lightsprint for Claude Code..."

# ── Base URL configuration ────────────────────────────────────────────────
if (-not $BaseUrl) {
    $BaseUrl = $env:LIGHTSPRINT_BASE_URL
}
if (-not $BaseUrl) {
    $BaseUrl = "https://lightsprint.ai"
}

# Persist base URL so hooks can read it later
$configDir = "$env:USERPROFILE\.lightsprint"
New-Item -ItemType Directory -Force -Path $configDir | Out-Null
@{ baseUrl = $BaseUrl } | ConvertTo-Json | Set-Content -Path "$configDir\config.json" -Encoding UTF8

# ── Check prerequisites ──────────────────────────────────────────────────
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
    Write-Error "claude CLI not found. Install it first: https://docs.anthropic.com/en/docs/claude-code"
    exit 1
}

# ── Remove previous installation (idempotent) ────────────────────────────
& claude plugin uninstall $pluginName 2>$null
& claude plugin marketplace remove $marketplaceName 2>$null

# ── Install plan review binary ────────────────────────────────────────────
function Install-Binary {
    Write-Host "Downloading plan review binary..."

    # Detect architecture
    $arch = if ([Environment]::Is64BitOperatingSystem) {
        if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x64" }
    } else {
        Write-Warning "32-bit Windows is not supported"
        return $false
    }

    $platform = "win32-$arch"
    $assetName = "$binaryName-$platform.exe"

    # Get latest release tag
    try {
        $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/latest"
        $tag = $release.tag_name
    } catch {
        Write-Warning "Could not fetch latest release. Plan review hook will not be available."
        return $false
    }

    if (-not $tag) {
        Write-Warning "Could not parse release tag. Plan review hook will not be available."
        return $false
    }

    # Determine plugin cache bin/ directory
    $version = $tag -replace '^v', ''
    $pluginBinDir = "$env:USERPROFILE\.claude\plugins\cache\lightsprint\lightsprint\$version\bin"
    New-Item -ItemType Directory -Force -Path $pluginBinDir | Out-Null

    $downloadUrl = "https://github.com/$repo/releases/download/$tag/$assetName"
    $checksumUrl = "$downloadUrl.sha256"

    $tmpFile = [System.IO.Path]::GetTempFileName()

    try {
        Invoke-WebRequest -Uri $downloadUrl -OutFile $tmpFile -UseBasicParsing
    } catch {
        Write-Warning "Failed to download binary. Plan review hook will not be available."
        Remove-Item $tmpFile -Force -ErrorAction SilentlyContinue
        return $false
    }

    # Verify checksum if available
    try {
        $checksumResponse = Invoke-WebRequest -Uri $checksumUrl -UseBasicParsing
        if ($checksumResponse.Content -is [byte[]]) {
            $checksumContent = [System.Text.Encoding]::UTF8.GetString($checksumResponse.Content)
        } else {
            $checksumContent = $checksumResponse.Content
        }
        $expectedChecksum = $checksumContent.Split(" ")[0].Trim().ToLower()
        $actualChecksum = (Get-FileHash -Path $tmpFile -Algorithm SHA256).Hash.ToLower()

        if ($actualChecksum -ne $expectedChecksum) {
            Remove-Item $tmpFile -Force
            Write-Warning "Checksum verification failed!"
            return $false
        }
    } catch {
        # Checksum not available, continue without verification
    }

    Move-Item -Force $tmpFile "$pluginBinDir\$binaryName.exe"
    Write-Host "Installed $binaryName to $pluginBinDir\"

    # Also copy to LOCALAPPDATA for CLI convenience
    New-Item -ItemType Directory -Force -Path $installDir | Out-Null
    Copy-Item "$pluginBinDir\$binaryName.exe" "$installDir\$binaryName.exe" -Force -ErrorAction SilentlyContinue
    if ($?) {
        Write-Host "Also copied to $installDir\ for CLI convenience"
    }

    return $true
}

$null = Install-Binary

# ── Install plugin (skills + hooks) ──────────────────────────────────────
Write-Host "Installing plugin..."
& claude plugin marketplace add $repo
if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to add Lightsprint marketplace"
    exit 1
}

& claude plugin install $pluginName
if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to install Lightsprint plugin"
    exit 1
}

Write-Host ""
Write-Host "Plugin installed successfully."
if ($BaseUrl -ne "https://lightsprint.ai") {
    Write-Host "Base URL: $BaseUrl"
}

# ── Check for conflicting ExitPlanMode hooks ─────────────────────────────
$conflictingPlugins = @()
$marketplacesDir = "$env:USERPROFILE\.claude\plugins\marketplaces"

# Build list of already-disabled plugins from settings.json (marketplace names)
$disabledMarketplaces = @()
$settingsFile = "$env:USERPROFILE\.claude\settings.json"
if ((Test-Path $settingsFile) -and (Get-Command node -ErrorAction SilentlyContinue)) {
    try {
        $disabledOutput = & node -e "
            const s = require('$($settingsFile -replace '\\', '/')');
            const ep = s.enabledPlugins || {};
            const disabled = Object.entries(ep)
                .filter(([, v]) => v === false)
                .map(([k]) => k.split('@').pop());
            console.log(disabled.join('\n'));
        " 2>$null
        if ($disabledOutput) {
            $disabledMarketplaces = $disabledOutput -split "`n" | Where-Object { $_ }
        }
    } catch {}
}

if (Test-Path $marketplacesDir) {
    $hooksFiles = Get-ChildItem -Path $marketplacesDir -Recurse -Filter "hooks.json" -ErrorAction SilentlyContinue
    foreach ($file in $hooksFiles) {
        # Skip our own plugin
        if ($file.FullName -like "*\lightsprint\*") { continue }

        $content = Get-Content $file.FullName -Raw -ErrorAction SilentlyContinue
        if ($content -match "ExitPlanMode") {
            # Extract plugin name from path
            $relativePath = $file.FullName.Substring($marketplacesDir.Length + 1)
            $pluginNameConflict = $relativePath.Split('\')[0]
            # Skip plugins that are already disabled
            if ($disabledMarketplaces -contains $pluginNameConflict) { continue }
            $conflictingPlugins += $pluginNameConflict
        }
    }
}

# Also check user-level settings.json for ExitPlanMode hooks
if (Test-Path $settingsFile) {
    $settingsContent = Get-Content $settingsFile -Raw -ErrorAction SilentlyContinue
    if ($settingsContent -match "ExitPlanMode") {
        if (Get-Command node -ErrorAction SilentlyContinue) {
            $hasUserHook = & node -e "
                const s = require('$($settingsFile -replace '\\', '/')');
                const hooks = s.hooks || {};
                const pr = hooks.PermissionRequest || [];
                const match = pr.some(h => h.matcher === 'ExitPlanMode');
                console.log(match ? 'yes' : 'no');
            " 2>$null
            if ($hasUserHook -eq "yes") {
                $conflictingPlugins += "settings.json (user hook)"
            }
        }
    }
}

# Deduplicate
$uniqueConflicts = $conflictingPlugins | Select-Object -Unique

if ($uniqueConflicts.Count -gt 0) {
    Write-Host ""
    Write-Host ([char]0x2500 * 41)
    Write-Host "  Other ExitPlanMode hooks detected:"
    Write-Host ([char]0x2500 * 41)
    foreach ($p in $uniqueConflicts) {
        Write-Host "   - $p"
    }
    Write-Host ""
    Write-Host "  Having multiple ExitPlanMode hooks means multiple review UIs"
    Write-Host "  will open each time you exit plan mode."
    Write-Host ""

    $disableConfirm = Read-Host "Disable them? (Y/n)"
    if (-not $disableConfirm) { $disableConfirm = "Y" }

    if ($disableConfirm -match '^[Yy]$') {
        foreach ($p in $uniqueConflicts) {
            if ($p -eq "settings.json (user hook)") {
                Write-Host "  Note: Remove the ExitPlanMode hook from ~\.claude\settings.json manually."
            } else {
                Write-Host "  Disabling $p..."
                & claude plugin disable $p 2>$null
            }
        }
        Write-Host ""
    }
}

# ── Check if installDir is in PATH ───────────────────────────────────────
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$installDir*") {
    Write-Host ""
    Write-Host "$installDir is not in your PATH. Adding it..."
    [Environment]::SetEnvironmentVariable("Path", "$userPath;$installDir", "User")
    Write-Host "Added to PATH. Restart your terminal for changes to take effect."
}
Write-Host ""

# ── Interactive project connection ────────────────────────────────────────
$currentDir = Get-Location
$repoFullName = ""

if (Get-Command git -ErrorAction SilentlyContinue) {
    $isGitRepo = & git rev-parse --is-inside-work-tree 2>$null
    if ($isGitRepo -eq "true") {
        $remoteUrl = & git remote get-url origin 2>$null
        if ($remoteUrl) {
            $cleaned = $remoteUrl -replace '\.git$', ''
            $cleaned = $cleaned -replace '.*github\.com[:/]', ''
            if ($cleaned -match '/' -and $cleaned -ne $remoteUrl) {
                $repoFullName = $cleaned
            }
        }
    }
}

if ($repoFullName) {
    Write-Host ([char]0x2500 * 41)
    Write-Host "  Connect this folder to a project on Lightsprint?"
    Write-Host ([char]0x2500 * 41)
    Write-Host ""
    Write-Host "  Folder: $currentDir"
    Write-Host "  Repo:   $repoFullName"
    Write-Host ""

    $confirm = Read-Host "Connect? (Y/n)"
    if (-not $confirm) { $confirm = "Y" }

    if ($confirm -match '^[Yy]$') {
        Write-Host ""
        & node "$pluginDir\scripts\lightsprint.js" connect
    } else {
        Write-Host ""
        Write-Host "Skipped. You can connect later with 'lightsprint connect' or any /lightsprint: command."
    }
} else {
    Write-Host ([char]0x2500 * 41)
    Write-Host "  No git repository detected"
    Write-Host ([char]0x2500 * 41)
    Write-Host ""
    Write-Host "  To connect a project to Lightsprint, open Claude Code"
    Write-Host "  inside a git repository and run:"
    Write-Host ""
    Write-Host "    /lightsprint:tasks"
    Write-Host ""
    Write-Host "  This will trigger the OAuth flow and link that project."
}

Write-Host ""
Write-Host "Done!"
Write-Host ""
