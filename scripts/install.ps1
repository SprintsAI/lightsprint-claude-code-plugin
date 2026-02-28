# Lightsprint Windows Installer
$ErrorActionPreference = "Stop"

$repo = "SprintsAI/lightsprint-claude-code-plugin"
$installDir = "$env:LOCALAPPDATA\lightsprint"
$binaryName = "ls-plan"

# Detect architecture
$arch = if ([Environment]::Is64BitOperatingSystem) {
    if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x64" }
} else {
    Write-Error "32-bit Windows is not supported"
    exit 1
}

$platform = "win32-$arch"
$assetName = "$binaryName-$platform.exe"

Write-Host "Fetching latest version..."
$release = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/latest"
$latestTag = $release.tag_name

if (-not $latestTag) {
    Write-Error "Failed to fetch latest version"
    exit 1
}

Write-Host "Installing $binaryName $latestTag..."

$binaryUrl = "https://github.com/$repo/releases/download/$latestTag/$assetName"
$checksumUrl = "$binaryUrl.sha256"

# Create install directory
New-Item -ItemType Directory -Force -Path $installDir | Out-Null

$tmpFile = [System.IO.Path]::GetTempFileName()

Invoke-WebRequest -Uri $binaryUrl -OutFile $tmpFile -UseBasicParsing

# Verify checksum
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
    Write-Error "Checksum verification failed!"
    exit 1
}

Move-Item -Force $tmpFile "$installDir\$binaryName.exe"

Write-Host ""
Write-Host "$binaryName $latestTag installed to $installDir\$binaryName.exe"

# Add to PATH if not already there
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$installDir*") {
    Write-Host ""
    Write-Host "$installDir is not in your PATH. Adding it..."
    [Environment]::SetEnvironmentVariable("Path", "$userPath;$installDir", "User")
    Write-Host "Added to PATH. Restart your terminal for changes to take effect."
}

Write-Host ""
Write-Host "=========================================="
Write-Host "  INSTALL THE CLAUDE CODE PLUGIN"
Write-Host "=========================================="
Write-Host ""
Write-Host "In Claude Code, run:"
Write-Host "  /plugin marketplace add SprintsAI/lightsprint-claude-code-plugin"
Write-Host "  /plugin install lightsprint"
Write-Host ""
Write-Host "Done!"
