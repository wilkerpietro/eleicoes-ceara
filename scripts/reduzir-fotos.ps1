# Reduz as fotos oficiais dos candidatos (TSE) para miniaturas leves, adequadas aos avatares do site.
# Uso: powershell -ExecutionPolicy Bypass -File scripts/reduzir-fotos.ps1 -Pasta data/2024-1/fotos [-Largura 96] [-Qualidade 75]
# Sobrescreve os arquivos no lugar; imagens já menores ou iguais à largura alvo só são recomprimidas.
param(
  [Parameter(Mandatory = $true)][string]$Pasta,
  [int]$Largura = 96,
  [int]$Qualidade = 75
)
Add-Type -AssemblyName System.Drawing

$pasta = (Resolve-Path $Pasta).Path
$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$params = New-Object System.Drawing.Imaging.EncoderParameters(1)
$params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]$Qualidade)

$arquivos = Get-ChildItem -LiteralPath $pasta -File | Where-Object { $_.Extension -match '^\.(jpe?g|png)$' }
$antes = ($arquivos | Measure-Object Length -Sum).Sum
$n = 0
foreach ($f in $arquivos) {
  try {
    $bytes = [IO.File]::ReadAllBytes($f.FullName)
    $ms = New-Object IO.MemoryStream(, $bytes)
    $img = [System.Drawing.Image]::FromStream($ms)
    $w = [Math]::Min($Largura, $img.Width)
    $h = [int][Math]::Round($img.Height * $w / $img.Width)
    $bmp = New-Object System.Drawing.Bitmap($w, $h)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.DrawImage($img, 0, 0, $w, $h)
    $g.Dispose(); $img.Dispose(); $ms.Dispose()
    $tmp = "$($f.FullName).tmp"
    $bmp.Save($tmp, $codec, $params)
    $bmp.Dispose()
    Move-Item -LiteralPath $tmp -Destination $f.FullName -Force
    $n++
  } catch {
    Write-Warning "Falhou: $($f.Name) - $($_.Exception.Message)"
  }
}
$depois = (Get-ChildItem -LiteralPath $pasta -File | Measure-Object Length -Sum).Sum
"{0} fotos reduzidas: {1:N1} MB -> {2:N1} MB" -f $n, ($antes / 1MB), ($depois / 1MB)
