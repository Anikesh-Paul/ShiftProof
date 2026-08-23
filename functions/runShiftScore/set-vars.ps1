$ErrorActionPreference = "Continue"
$EnvFile = Join-Path $PSScriptRoot "..\..\.env"

function Read-EnvValue([string]$name) {
  $line = Get-Content $EnvFile -ErrorAction SilentlyContinue |
    Where-Object { $_ -match "^$name=" } |
    Select-Object -First 1
  if (-not $line) { return "" }
  return ($line -replace "^$name=", "").Trim().Trim('"').Trim("'")
}

$Key = Read-EnvValue "APPWRITE_API_KEY"
if (-not $Key) { $Key = $env:APPWRITE_API_KEY }
$GoogleKey = Read-EnvValue "GOOGLE_AI_API_KEY"
if (-not $GoogleKey) { $GoogleKey = $env:GOOGLE_AI_API_KEY }
$Provider = Read-EnvValue "GEMINI_PROVIDER"
if (-not $Provider) { $Provider = $env:GEMINI_PROVIDER }
$VertexKey = Read-EnvValue "VERTEX_API_KEY"
if (-not $VertexKey) { $VertexKey = $env:VERTEX_API_KEY }
$VertexProject = Read-EnvValue "VERTEX_PROJECT_ID"
if (-not $VertexProject) { $VertexProject = $env:VERTEX_PROJECT_ID }
$VertexLocation = Read-EnvValue "VERTEX_LOCATION"
if (-not $VertexLocation) { $VertexLocation = $env:VERTEX_LOCATION }
if (-not $VertexLocation) { $VertexLocation = "global" }

$Endpoint = "https://sgp.cloud.appwrite.io/v1"
$ProjectId = "6a5b0ce3002605c7a776"
$FunctionId = "runShiftScore"
$headers = @{
  "X-Appwrite-Project" = $ProjectId
  "X-Appwrite-Key"     = $Key
  "Content-Type"       = "application/json"
}

$pairs = @(
  @{ id = "apiKey"; key = "APPWRITE_API_KEY"; value = $Key },
  @{ id = "endpoint"; key = "APPWRITE_ENDPOINT"; value = $Endpoint },
  @{ id = "projectId"; key = "APPWRITE_PROJECT_ID"; value = $ProjectId },
  @{ id = "fnEndpoint"; key = "APPWRITE_FUNCTION_API_ENDPOINT"; value = $Endpoint },
  @{ id = "fnProject"; key = "APPWRITE_FUNCTION_PROJECT_ID"; value = $ProjectId }
)

if ($VertexKey) {
  $pairs += @{ id = "vertexApiKey"; key = "VERTEX_API_KEY"; value = $VertexKey }
  $pairs += @{ id = "vertexProject"; key = "VERTEX_PROJECT_ID"; value = $VertexProject }
  $pairs += @{ id = "vertexLocation"; key = "VERTEX_LOCATION"; value = $VertexLocation }
  $pairs += @{ id = "geminiProvider"; key = "GEMINI_PROVIDER"; value = $(if ($Provider) { $Provider } else { "vertex" }) }
} else {
  Write-Host "WARN: VERTEX_API_KEY not in .env — Function will stay on AI Studio until set"
}
if ($GoogleKey) {
  $pairs += @{ id = "googleAiKey"; key = "GOOGLE_AI_API_KEY"; value = $GoogleKey }
}

foreach ($p in $pairs) {
  $body = (@{ variableId = $p.id; key = $p.key; value = $p.value } | ConvertTo-Json)
  try {
    $r = Invoke-WebRequest -Uri "$Endpoint/functions/$FunctionId/variables" -Headers $headers -Method Post -Body $body -UseBasicParsing
    Write-Host "OK $($p.key) status=$($r.StatusCode)"
  } catch {
    $msg = $_.ErrorDetails.Message
    Write-Host "FAIL $($p.key) $msg"
    try {
      $r2 = Invoke-WebRequest -Uri "$Endpoint/functions/$FunctionId/variables/$($p.id)" -Headers $headers -Method Put -Body (@{ key = $p.key; value = $p.value } | ConvertTo-Json) -UseBasicParsing
      Write-Host "UPDATED $($p.key) status=$($r2.StatusCode)"
    } catch {
      Write-Host "UPDATE FAIL $($p.key) $($_.ErrorDetails.Message)"
    }
  }
}

$fn = Invoke-RestMethod -Uri "$Endpoint/functions/$FunctionId" -Headers $headers -Method Get
Write-Host "deploymentId=$($fn.deploymentId) latest=$($fn.latestDeploymentId) enabled=$($fn.enabled)"
$vars = Invoke-RestMethod -Uri "$Endpoint/functions/$FunctionId/variables" -Headers $headers -Method Get
Write-Host "vars total=$($vars.total)"
foreach ($v in $vars.variables) {
  Write-Host (" - " + $v.key)
}
