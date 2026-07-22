[CmdletBinding()]
param(
  [string] $DestinationRoot = (Join-Path $HOME '.codex\skills')
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$source = Join-Path $repositoryRoot 'skills\interact-self-deploy'
$destination = Join-Path $DestinationRoot 'interact-self-deploy'

if (-not (Test-Path -LiteralPath $source)) {
  throw "Deployment skill source was not found: $source"
}

New-Item -ItemType Directory -Path $destination -Force | Out-Null
Copy-Item -Path (Join-Path $source '*') -Destination $destination -Recurse -Force

Write-Host "Installed InterAct deployment skill at $destination" -ForegroundColor Green
Write-Host 'Restart Codex, then invoke $interact-self-deploy.'
