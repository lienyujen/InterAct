[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [ValidatePattern('^[^/\s]+/[^/\s]+$')]
  [string] $Repository,

  [Parameter(Mandatory)]
  [ValidatePattern('^https://[a-z0-9]+\.supabase\.co/?$')]
  [string] $SupabaseUrl,

  [Parameter(Mandatory)]
  [string] $PublishableKey,

  [Parameter(Mandatory)]
  [ValidatePattern('^https://')]
  [string] $PublicAppUrl
)

. (Join-Path $PSScriptRoot 'common.ps1')

if ($PublishableKey -like '*dashboard*' -or $PublishableKey -match '^https?://') {
  throw 'PublishableKey must be the Supabase publishable key, not a dashboard URL.'
}

Invoke-Checked 'gh.exe' @('auth', 'status')
Invoke-Checked 'gh.exe' @('variable', 'set', 'VITE_SUPABASE_URL', '-R', $Repository, '--body', $SupabaseUrl.TrimEnd('/'))
Invoke-Checked 'gh.exe' @('variable', 'set', 'VITE_SUPABASE_ANON_KEY', '-R', $Repository, '--body', $PublishableKey)
Invoke-Checked 'gh.exe' @('variable', 'set', 'VITE_PUBLIC_APP_URL', '-R', $Repository, '--body', $PublicAppUrl.TrimEnd('/'))

& gh.exe api "repos/$Repository/pages" *> $null
$pagesMethod = if ($LASTEXITCODE -eq 0) { 'PATCH' } else { 'POST' }
& gh.exe api --method $pagesMethod "repos/$Repository/pages" -f 'build_type=workflow' *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Warning 'GitHub Pages could not be enabled automatically. Select GitHub Actions under Repository Settings > Pages, then continue.'
}

Invoke-Checked 'gh.exe' @('workflow', 'run', 'deploy.yml', '-R', $Repository)
Write-Host 'GitHub variables are set and the Pages workflow was started.' -ForegroundColor Green
