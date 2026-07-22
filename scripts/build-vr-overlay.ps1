$ErrorActionPreference = 'Stop'

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$sourceDir = Join-Path $repoRoot 'native\vr-overlay'
$buildDir = Join-Path $repoRoot 'build\native\vr-overlay-build'
$outputDir = Join-Path $repoRoot 'build\native\vr-overlay'

$cmake = (Get-Command cmake.exe -ErrorAction SilentlyContinue).Source
if (-not $cmake) {
  $candidate = 'C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe'
  if (Test-Path $candidate) { $cmake = $candidate }
}
if (-not $cmake) { throw 'CMake was not found; the OpenXR overlay cannot be built.' }

New-Item -ItemType Directory -Path $buildDir -Force | Out-Null
New-Item -ItemType Directory -Path $outputDir -Force | Out-Null

& $cmake -S $sourceDir -B $buildDir -A x64
if ($LASTEXITCODE -ne 0) { throw 'OpenXR overlay CMake configuration failed.' }
& $cmake --build $buildDir --config Release --target DcsHubOpenXrLayer DcsHubVrBridge DcsHubLayerProbe
if ($LASTEXITCODE -ne 0) { throw 'OpenXR overlay native build failed.' }

$builtDir = Join-Path $buildDir 'out\Release'
foreach ($name in @('DcsHubOpenXrLayer.dll', 'DcsHubVrBridge.exe', 'DCSHUBManualOverlayLayer.json', 'THIRD_PARTY_NOTICES.md')) {
  $source = Join-Path $builtDir $name
  if (-not (Test-Path $source)) { throw "Missing OpenXR overlay artifact: $name" }
  Copy-Item -LiteralPath $source -Destination (Join-Path $outputDir $name) -Force
}

& (Join-Path $outputDir 'DcsHubVrBridge.exe') --self-test
if ($LASTEXITCODE -ne 0) { throw 'OpenXR overlay bridge self-test failed.' }
& (Join-Path $builtDir 'DcsHubLayerProbe.exe') (Join-Path $outputDir 'DcsHubOpenXrLayer.dll')
if ($LASTEXITCODE -ne 0) { throw 'OpenXR API layer negotiation self-test failed.' }
