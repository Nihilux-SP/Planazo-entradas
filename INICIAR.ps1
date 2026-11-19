param([switch]$SoloConfigurar)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $root
$envFile = Join-Path $root "backend\.env.local"

function ConvertFrom-SecureStringText {
    param([System.Security.SecureString]$Secure)
    $pointer = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
    try {
        return [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    } finally {
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
}

function New-JwtSecret {
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    return [Convert]::ToBase64String($bytes)
}

if (-not (Test-Path $envFile)) {
    Write-Host "=== Configuracion inicial de Planazo ===" -ForegroundColor Cyan
    Write-Host "Crea una OAuth App en https://github.com/settings/developers"
    Write-Host("Authorization callback URL: http://localhost:8000/api/auth/oauth/github/callback")
    Write-Host ""
    $clientId = (Read-Host "GITHUB_CLIENT_ID").Trim()
    $clientSecret = (ConvertFrom-SecureStringText (Read-Host "GITHUB_CLIENT_SECRET" -AsSecureString)).Trim()

    if (-not $clientId -or -not $clientSecret) {
        throw "El Client ID y el Client Secret son obligatorios"
    }

    $lines = @(
        "# Archivo LOCAL de desarrollo. No lo compartas ni lo subas a Git.",
        "# Generado por INICIAR.bat el $(Get-Date -Format 'yyyy-MM-dd HH:mm').",
        "GITHUB_CLIENT_ID=$clientId",
        "GITHUB_CLIENT_SECRET=$clientSecret",
        "JWT_SECRET=$(New-JwtSecret)",
        "OAUTH_REDIRECT_URI=http://localhost:8000/api/auth/oauth/{provider}/callback",
        "FRONTEND_URI=http://localhost:8080/",
        "CORS_ORIGINS=http://localhost:8080"
    )
    Set-Content -Path $envFile -Value $lines -Encoding UTF8
    Write-Host "Configuracion guardada en $envFile" -ForegroundColor Green
    Write-Host ""
}

foreach ($line in (Get-Content $envFile -Encoding UTF8)) {
    $line = $line.Trim()
    if (-not $line -or $line.StartsWith("#")) { continue }
    if ($line -match "^([^=]+)=(.*)$") {
        [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), "Process")
    }
}

if (-not $env:GITHUB_CLIENT_ID -or -not $env:GITHUB_CLIENT_SECRET -or -not $env:JWT_SECRET) {
    throw "Faltan variables en $envFile"
}

if ($SoloConfigurar) {
    Write-Host "Variables cargadas correctamente (GITHUB_CLIENT_ID=$env:GITHUB_CLIENT_ID)."
    return
}

$backendExe = Join-Path $root "backend\.venv\Scripts\uvicorn.exe"
if (-not (Test-Path $backendExe)) {
    throw "No se encontro el entorno virtual: $backendExe"
}
$frontendDir = Join-Path $root "frontend"

Write-Host "Arrancando API en http://localhost:8000 ..." -ForegroundColor Cyan
Start-Process -FilePath "cmd.exe" -ArgumentList "/k `"$backendExe`" app.main:app --app-dir backend --reload --port 8000" -WorkingDirectory $root

Write-Host "Arrancando frontend en http://localhost:8080 ..." -ForegroundColor Cyan
Start-Process -FilePath "cmd.exe" -ArgumentList "/k npm run dev" -WorkingDirectory $frontendDir

Start-Process "http://localhost:8080"
Write-Host "Listo. API docs: http://localhost:8000/docs" -ForegroundColor Green
