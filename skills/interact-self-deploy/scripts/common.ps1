Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-InterActRoot {
  return (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..\..')).Path
}

function Invoke-Checked {
  param(
    [Parameter(Mandatory)] [string] $FilePath,
    [Parameter(Mandatory)] [string[]] $ArgumentList
  )

  & $FilePath @ArgumentList
  if ($LASTEXITCODE -ne 0) {
    throw "$FilePath failed with exit code $LASTEXITCODE."
  }
}

function Read-SecretText {
  param([Parameter(Mandatory)] [string] $Prompt)

  $secure = Read-Host -Prompt $Prompt -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

function Write-Utf8NoBom {
  param(
    [Parameter(Mandatory)] [string] $Path,
    [Parameter(Mandatory)] [string] $Content
  )

  [IO.File]::WriteAllText($Path, $Content, [Text.UTF8Encoding]::new($false))
}
