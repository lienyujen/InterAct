[CmdletBinding()]
param(
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

$root = Get-InterActRoot
$envPath = Join-Path $root '.env'
$output = Join-Path $env:TEMP ("InterAct-package-{0}" -f [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
$envContent = @"
VITE_SUPABASE_URL=$($SupabaseUrl.TrimEnd('/'))
VITE_SUPABASE_ANON_KEY=$PublishableKey
VITE_PUBLIC_APP_URL=$($PublicAppUrl.TrimEnd('/'))
"@

Push-Location $root
try {
  Write-Utf8NoBom $envPath ($envContent.Trim() + "`n")
  Invoke-Checked 'pnpm.cmd' @('install', '--frozen-lockfile')
  Invoke-Checked 'pnpm.cmd' @('build')
  Invoke-Checked 'pnpm.cmd' @('exec', 'electron-builder', '--win', 'portable', '--x64', "--config.directories.output=$output")

  $source = Join-Path $output 'interact.exe'
  if (-not (Test-Path -LiteralPath $source)) { throw 'electron-builder did not produce interact.exe.' }
  Copy-Item -LiteralPath $source -Destination (Join-Path $root 'interact.exe') -Force
  Get-Item -LiteralPath (Join-Path $root 'interact.exe') | Select-Object FullName, Length, LastWriteTime
} finally {
  Pop-Location
}
