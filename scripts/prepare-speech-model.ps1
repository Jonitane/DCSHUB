$ErrorActionPreference = 'Stop'

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$outputDir = Join-Path $repoRoot 'build\native\speech-models\sensevoice'
$noticeDir = Join-Path $repoRoot 'resources\speech-models\sensevoice'
$legacyDir = Join-Path $env:APPDATA 'dcs-control-hub\speech-models\sensevoice'

$files = @(
  @{
    Name = 'model.int8.onnx'
    Size = 239233841
    Sha256 = 'C71F0CE00BEC95B07744E116345E33D8CBBE08CEF896382CF907BF4B51A2CD51'
  },
  @{
    Name = 'tokens.txt'
    Size = 315894
    Sha256 = 'F449EB28DC567533D7FA59BE34E2ABCA8784F771850C78A47FB731A31429A1DC'
  }
)

$modelScopeRevision = 'b1bc3fb60fdafcb26f301f306f72beb19498ffc4'
$modelScopeBase = "https://modelscope.cn/models/gomodels/sherpa/resolve/$modelScopeRevision/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17"

function Test-ModelFile {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][hashtable]$Expected
  )
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
  $item = Get-Item -LiteralPath $Path
  if ($item.Length -ne $Expected.Size) { return $false }
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -eq $Expected.Sha256
}

function Test-ModelDirectory {
  param([Parameter(Mandatory = $true)][string]$Directory)
  foreach ($expected in $files) {
    if (-not (Test-ModelFile -Path (Join-Path $Directory $expected.Name) -Expected $expected)) {
      return $false
    }
  }
  return $true
}

New-Item -ItemType Directory -Path $outputDir -Force | Out-Null

if (-not (Test-ModelDirectory -Directory $outputDir)) {
  if (Test-ModelDirectory -Directory $legacyDir) {
    Write-Host 'Preparing bundled SenseVoice model from the verified local cache...'
    foreach ($expected in $files) {
      Copy-Item -LiteralPath (Join-Path $legacyDir $expected.Name) -Destination (Join-Path $outputDir $expected.Name) -Force
    }
  } else {
    Write-Host 'Downloading bundled SenseVoice model from ModelScope (domestic mirror)...'
    foreach ($expected in $files) {
      $destination = Join-Path $outputDir $expected.Name
      $partial = "$destination.partial"
      if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial -Force }
      & curl.exe -L --fail --retry 4 --retry-all-errors --connect-timeout 30 --output $partial "$modelScopeBase/$($expected.Name)"
      if ($LASTEXITCODE -ne 0) { throw "ModelScope download failed: $($expected.Name)" }
      if (-not (Test-ModelFile -Path $partial -Expected $expected)) {
        Remove-Item -LiteralPath $partial -Force
        throw "SenseVoice model validation failed: $($expected.Name)"
      }
      Move-Item -LiteralPath $partial -Destination $destination -Force
    }
  }
}

if (-not (Test-ModelDirectory -Directory $outputDir)) {
  throw 'The bundled SenseVoice model is incomplete or failed SHA-256 validation.'
}

foreach ($name in @('LICENSE.txt', 'THIRD_PARTY_NOTICES.md')) {
  Copy-Item -LiteralPath (Join-Path $noticeDir $name) -Destination (Join-Path $outputDir $name) -Force
}

Write-Host "SenseVoice model is ready: $outputDir"
