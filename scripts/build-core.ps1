$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$project = Join-Path $root 'core\DcsHub.Core.Host\DcsHub.Core.Host.csproj'
$output = Join-Path $root 'build\native\core'

dotnet publish $project `
  --configuration Release `
  --runtime win-x64 `
  --self-contained true `
  --output $output `
  -p:PublishSingleFile=true `
  -p:IncludeNativeLibrariesForSelfExtract=true `
  -p:EnableCompressionInSingleFile=true `
  -p:DebugType=None `
  -p:DebugSymbols=false

if ($LASTEXITCODE -ne 0) { throw "DCSHUB Core publish failed with exit code $LASTEXITCODE" }

$exe = Join-Path $output 'DcsHub.Core.Host.exe'
if (-not (Test-Path -LiteralPath $exe)) { throw "DCSHUB Core output is missing: $exe" }
