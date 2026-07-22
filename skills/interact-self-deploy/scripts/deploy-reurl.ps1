[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [ValidatePattern('^[a-z0-9]{20}$')]
  [string] $ProjectRef
)

. (Join-Path $PSScriptRoot 'common.ps1')

$root = Get-InterActRoot
$apiKey = Read-SecretText 'Paste the Reurl.cc API key'
if ([string]::IsNullOrWhiteSpace($apiKey)) { throw 'Reurl API key is required.' }

$secretFile = [IO.Path]::GetTempFileName()

Push-Location $root
try {
  Write-Utf8NoBom $secretFile "REURL_API_KEY=$apiKey`n"
  Invoke-Checked 'pnpm.cmd' @('dlx', 'supabase', 'secrets', 'set', '--project-ref', $ProjectRef, '--env-file', $secretFile)
  Invoke-Checked 'pnpm.cmd' @('dlx', 'supabase', 'functions', 'deploy', 'shorten-url', '--project-ref', $ProjectRef, '--no-verify-jwt', '--use-api')
  Write-Host 'Reurl deployment completed.' -ForegroundColor Green
} finally {
  $apiKey = $null
  if (Test-Path -LiteralPath $secretFile) { Remove-Item -LiteralPath $secretFile -Force }
  Pop-Location
}
