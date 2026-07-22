[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [ValidatePattern('^[a-z0-9]{20}$')]
  [string] $ProjectRef
)

. (Join-Path $PSScriptRoot 'common.ps1')

$root = Get-InterActRoot
$coreFunctions = @('create-session', 'participant-action', 'presenter-action')

Push-Location $root
try {
  Write-Host 'Linking the new Supabase project...'
  Invoke-Checked 'pnpm.cmd' @('dlx', 'supabase', 'link', '--project-ref', $ProjectRef)

  Write-Host 'Creating the InterAct database, Realtime publication, and Storage bucket...'
  Invoke-Checked 'pnpm.cmd' @('dlx', 'supabase', 'db', 'query', '--linked', '--file', 'supabase/schema.sql')

  Write-Host 'Deploying the core Edge Functions...'
  Invoke-Checked 'pnpm.cmd' (@('dlx', 'supabase', 'functions', 'deploy') + $coreFunctions + @('--project-ref', $ProjectRef, '--no-verify-jwt', '--use-api'))

  Write-Host 'Supabase core deployment completed.' -ForegroundColor Green
} finally {
  Pop-Location
}
