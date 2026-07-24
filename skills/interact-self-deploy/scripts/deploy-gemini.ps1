[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [ValidatePattern('^[a-z0-9]{20}$')]
  [string] $ProjectRef,

  [string] $Model = 'gemini-3.6-flash'
)

. (Join-Path $PSScriptRoot 'common.ps1')

$root = Get-InterActRoot
$apiKey = Read-SecretText 'Paste the Google AI Studio Gemini API key'
if ([string]::IsNullOrWhiteSpace($apiKey)) { throw 'Gemini API key is required.' }

$secretFile = [IO.Path]::GetTempFileName()
$aiFunctions = @(
  'ai-exit-ticket-summary',
  'ai-screen-preview',
  'ai-short-answer-summary',
  'analyze-question',
  'analyze-session',
  'generate-exit-ticket'
)

Push-Location $root
try {
  Write-Utf8NoBom $secretFile "GEMINI_API_KEY=$apiKey`nGEMINI_MODEL=$Model`n"
  Invoke-Checked 'pnpm.cmd' @('dlx', 'supabase', 'secrets', 'set', '--project-ref', $ProjectRef, '--env-file', $secretFile)
  Invoke-Checked 'pnpm.cmd' (@('dlx', 'supabase', 'functions', 'deploy') + $aiFunctions + @('--project-ref', $ProjectRef, '--no-verify-jwt', '--use-api'))
  Write-Host "Gemini deployment completed with model $Model." -ForegroundColor Green
} finally {
  $apiKey = $null
  if (Test-Path -LiteralPath $secretFile) { Remove-Item -LiteralPath $secretFile -Force }
  Pop-Location
}
