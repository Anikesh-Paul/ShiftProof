# Deploy runShiftScore to Appwrite Cloud (project Jammu)
# Usage:
#   $env:APPWRITE_API_KEY = "your-server-api-key"
#   .\functions\runShiftScore\deploy.ps1

$ErrorActionPreference = "Stop"

$Endpoint = if ($env:APPWRITE_ENDPOINT) { $env:APPWRITE_ENDPOINT } else { "https://sgp.cloud.appwrite.io/v1" }
$ProjectId = if ($env:APPWRITE_PROJECT_ID) { $env:APPWRITE_PROJECT_ID } else { "6a5b0ce3002605c7a776" }
$FunctionId = "runShiftScore"
$ApiKey = $env:APPWRITE_API_KEY

if (-not $ApiKey) {
  Write-Host "Missing APPWRITE_API_KEY."
  Write-Host "Create a Server API key in Appwrite Console with Functions + Databases scopes, then:"
  Write-Host '  $env:APPWRITE_API_KEY = "..."'
  Write-Host "  .\functions\runShiftScore\deploy.ps1"
  exit 1
}

$Root = $PSScriptRoot
Set-Location $Root

# Ensure package + entrypoint
if (-not (Test-Path "node_modules")) {
  npm install --omit=dev
}
Copy-Item -Force "src\main.js" "index.js"

$Tar = Join-Path $Root "code.tar.gz"
if (Test-Path $Tar) { Remove-Item $Tar -Force }

# Prefer tar (Windows 10+)
tar --exclude code.tar.gz -czf code.tar.gz package.json package-lock.json index.js src node_modules
if (-not (Test-Path $Tar)) {
  throw "Failed to create code.tar.gz"
}

Write-Host "Uploading deployment ($([math]::Round((Get-Item $Tar).Length/1KB)) KB)..."

# Appwrite: POST /functions/{functionId}/deployments
# multipart: code (file), entrypoint, activate
$uri = "$Endpoint/functions/$FunctionId/deployments"
$boundary = [System.Guid]::NewGuid().ToString()
$fileBytes = [System.IO.File]::ReadAllBytes($Tar)
$enc = [System.Text.Encoding]::UTF8

function Part($name, $value) {
  return "--$boundary`r`nContent-Disposition: form-data; name=`"$name`"`r`n`r`n$value`r`n"
}

$pre = $enc.GetBytes(
  (Part "entrypoint" "index.js") +
  (Part "activate" "true") +
  "--$boundary`r`nContent-Disposition: form-data; name=`"code`"; filename=`"code.tar.gz`"`r`nContent-Type: application/gzip`r`n`r`n"
)
$post = $enc.GetBytes("`r`n--$boundary--`r`n")
$body = New-Object byte[] ($pre.Length + $fileBytes.Length + $post.Length)
[Array]::Copy($pre, 0, $body, 0, $pre.Length)
[Array]::Copy($fileBytes, 0, $body, $pre.Length, $fileBytes.Length)
[Array]::Copy($post, 0, $body, $pre.Length + $fileBytes.Length, $post.Length)

$headers = @{
  "X-Appwrite-Project" = $ProjectId
  "X-Appwrite-Key"     = $ApiKey
  "Content-Type"       = "multipart/form-data; boundary=$boundary"
}

try {
  $resp = Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -Body $body
  Write-Host "Deployment created:"
  $resp | ConvertTo-Json -Depth 6
  Write-Host ""
  Write-Host "Next: set Function env APPWRITE_API_KEY (server key) in Console if not already set."
  Write-Host "Then execute from web app submit, or:"
  Write-Host "  appwrite functions createExecution --function-id runShiftScore --body '{...}'"
} catch {
  Write-Host "Deploy failed:"
  if ($_.ErrorDetails.Message) { Write-Host $_.ErrorDetails.Message }
  else { Write-Host $_ }
  exit 1
}
