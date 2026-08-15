# Apply execute: ["users"] on the live runShiftScore function.
# Usage (from repo root or this folder):
#   .\functions\runShiftScore\harden-exec.ps1
# Reads APPWRITE_API_KEY from root .env (never prints it).

$ErrorActionPreference = "Stop"
$EnvFile = Join-Path $PSScriptRoot "..\..\.env"

function Read-EnvValue([string]$name) {
  $line = Get-Content $EnvFile -ErrorAction SilentlyContinue |
    Where-Object { $_ -match "^$name=" } |
    Select-Object -First 1
  if (-not $line) { return "" }
  return ($line -replace "^$name=", "").Trim().Trim('"').Trim("'")
}

$ApiKey = Read-EnvValue "APPWRITE_API_KEY"
if (-not $ApiKey) { $ApiKey = $env:APPWRITE_API_KEY }
if (-not $ApiKey) {
  Write-Host "Missing APPWRITE_API_KEY in root .env"
  exit 1
}

$Endpoint = if ($env:APPWRITE_ENDPOINT) { $env:APPWRITE_ENDPOINT } else { "https://sgp.cloud.appwrite.io/v1" }
$ProjectId = if ($env:APPWRITE_PROJECT_ID) { $env:APPWRITE_PROJECT_ID } else { "6a5b0ce3002605c7a776" }
$FunctionId = "runShiftScore"

$headers = @{
  "X-Appwrite-Project" = $ProjectId
  "X-Appwrite-Key"     = $ApiKey
  "Content-Type"       = "application/json"
}

$uri = "$Endpoint/functions/$FunctionId"
$fn = Invoke-RestMethod -Uri $uri -Headers $headers -Method Get
Write-Host "current execute=$($fn.execute -join ',')"

$patchBody = (@{ execute = @("users") } | ConvertTo-Json)
try {
  $updated = Invoke-RestMethod -Uri $uri -Headers $headers -Method Patch -Body $patchBody
  Write-Host "PATCH ok execute=$($updated.execute -join ',')"
} catch {
  Write-Host "PATCH failed; falling back to PUT with existing fields"
  $put = @{
    name        = $fn.name
    runtime     = $fn.runtime
    execute     = @("users")
    enabled     = $fn.enabled
    logging     = $fn.logging
    timeout     = $fn.timeout
    entrypoint  = $fn.entrypoint
    commands    = $fn.commands
    scopes      = $fn.scopes
  }
  $updated = Invoke-RestMethod -Uri $uri -Headers $headers -Method Put -Body ($put | ConvertTo-Json)
  Write-Host "PUT ok execute=$($updated.execute -join ',')"
}

$check = Invoke-RestMethod -Uri $uri -Headers $headers -Method Get
$joined = @($check.execute) -join ","
if ($joined -ne "users") {
  Write-Host "FAIL execute is still [$joined]"
  exit 1
}
Write-Host "execute hardened to users"
