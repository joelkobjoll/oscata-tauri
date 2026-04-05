param(
    [string]$OutputDir = "portable-dist",
    [string]$ZipPath = "",
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

if ($env:OS -ne "Windows_NT") {
    throw "Este script solo funciona en Windows."
}

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$packageJson = Get-Content "package.json" -Raw | ConvertFrom-Json
$version = [string]$packageJson.version

if ([string]::IsNullOrWhiteSpace($ZipPath)) {
    $ZipPath = "oscata-windows-portable-$version.zip"
}

$exePath = Join-Path $repoRoot "src-tauri\target\release\oscata-tauri.exe"
$distPath = Join-Path $repoRoot "src-tauri\target\release\dist"
$resourcesPath = Join-Path $repoRoot "src-tauri\target\release\resources"
$resolvedOutputDir = Join-Path $repoRoot $OutputDir
$resolvedZipPath = Join-Path $repoRoot $ZipPath

if (-not $SkipBuild) {
    Write-Host "Generando build de Tauri para Windows..."
    npm run tauri build
    if ($LASTEXITCODE -ne 0) {
        throw "La compilación portable de Tauri ha fallado."
    }
} else {
    Write-Host "Saltando la compilación y reutilizando el build existente..."
}

if (-not (Test-Path $exePath)) {
    throw "No se ha encontrado el ejecutable en $exePath"
}

if (-not (Test-Path $distPath)) {
    throw "No se ha encontrado la carpeta dist en $distPath"
}

if (Test-Path $resolvedOutputDir) {
    Remove-Item -Path $resolvedOutputDir -Recurse -Force
}

if (Test-Path $resolvedZipPath) {
    Remove-Item -Path $resolvedZipPath -Force
}

New-Item -ItemType Directory -Path $resolvedOutputDir | Out-Null
Copy-Item $exePath (Join-Path $resolvedOutputDir "Oscata.exe")
New-Item -ItemType File -Path (Join-Path $resolvedOutputDir ".oscata-portable") | Out-Null
Copy-Item $distPath (Join-Path $resolvedOutputDir "dist") -Recurse

if (Test-Path $resourcesPath) {
    Copy-Item $resourcesPath (Join-Path $resolvedOutputDir "resources") -Recurse
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($resolvedOutputDir, $resolvedZipPath)

Write-Host "Portable generado en: $resolvedZipPath"