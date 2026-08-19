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
    $BaseUrl = "https://app.lightsprint.ai"
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

# ── Install CLI binary ────────────────────────────────────────────────────
function Install-Binary {
    Write-Host "Downloading CLI binary..."

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
        Write-Warning "Could not fetch latest release. Lightsprint hooks will not be available."
        return $false
    }

    if (-not $tag) {
        Write-Warning "Could not parse release tag. Lightsprint hooks will not be available."
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
        Write-Warning "Failed to download binary. Lightsprint hooks will not be available."
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
if ($BaseUrl -ne "https://app.lightsprint.ai") {
    Write-Host "Base URL: $BaseUrl"
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

# Repo detection lives in scripts/lib/git-remote.js — the same code the CLI uses —
# so bash, PowerShell and the CLI can never disagree about which repo this is.
$detectScript = "$pluginDir\scripts\detect-repo.js"
$detectReason = ""

if ((Get-Command node -ErrorAction SilentlyContinue) -and (Test-Path $detectScript)) {
    $detected = & node $detectScript 2>$null
    if ($LASTEXITCODE -eq 0 -and $detected) {
        $repoFullName = ($detected | Select-Object -First 1).ToString().Trim()
    } else {
        $detectReason = (& node $detectScript --explain 2>$null) -join "`n"
    }
}

if ($repoFullName) {
    Write-Host ([char]0x2500 * 41)
    Write-Host "  Connecting repo to Lightsprint..."
    Write-Host ([char]0x2500 * 41)
    Write-Host ""
    Write-Host "  Repo: $repoFullName"
    Write-Host ""
    & node "$pluginDir\scripts\lightsprint.js" connect
} else {
    Write-Host ([char]0x2500 * 41)
    Write-Host "  No GitHub repository detected"
    Write-Host ([char]0x2500 * 41)
    Write-Host ""
    if ($detectReason) {
        foreach ($line in $detectReason -split "`n") { Write-Host "  $line" }
        Write-Host ""
    }
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
