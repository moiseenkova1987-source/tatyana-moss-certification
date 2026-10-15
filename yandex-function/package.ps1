$ErrorActionPreference = 'Stop'
$packageRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$archivePath = Join-Path $packageRoot 'tm-cert-contact-yandex.zip'
$files = @('index.js', 'ydb.js', 'metadata.js', 'package.json', 'package-lock.json')
foreach ($file in $files) {
  if (-not (Test-Path -LiteralPath (Join-Path $packageRoot $file) -PathType Leaf)) {
    throw "Missing package file: $file"
  }
}
Add-Type -AssemblyName System.IO.Compression
$stream = [IO.File]::Open($archivePath, [IO.FileMode]::Create)
$zip = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($file in $files) {
    $entry = $zip.CreateEntry($file, [IO.Compression.CompressionLevel]::Optimal)
    $output = $entry.Open()
    try {
      $bytes = [IO.File]::ReadAllBytes((Join-Path $packageRoot $file))
      $output.Write($bytes, 0, $bytes.Length)
    } finally { $output.Dispose() }
  }
} finally { $zip.Dispose(); $stream.Dispose() }
$readZip = [IO.Compression.ZipFile]::OpenRead($archivePath)
try {
  $names = @($readZip.Entries | ForEach-Object { $_.FullName })
  if (Compare-Object $files $names) { throw 'Unexpected ZIP contents' }
  Write-Output ($names -join ', ')
} finally { $readZip.Dispose() }
Get-Item -LiteralPath $archivePath | Select-Object FullName, Length
Get-FileHash -LiteralPath $archivePath -Algorithm SHA256
