# Servidor HTTP estático mínimo para desenvolvimento (Windows, sem Python/Node).
# Uso: powershell -ExecutionPolicy Bypass -File scripts/serve.ps1 [-Port 8080]
param([int]$Port = 8080)

$raiz = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$tipos = @{
  '.html'='text/html; charset=utf-8'; '.css'='text/css; charset=utf-8'; '.js'='application/javascript; charset=utf-8'
  '.json'='application/json; charset=utf-8'; '.csv'='text/csv; charset=utf-8'; '.png'='image/png'; '.svg'='image/svg+xml'
  '.ico'='image/x-icon'; '.geojson'='application/geo+json; charset=utf-8'; '.jpg'='image/jpeg'; '.jpeg'='image/jpeg'; '.webp'='image/webp'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Servindo $raiz em http://localhost:$Port/  (Ctrl+C para parar)"

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response
    try {
      $caminho = [Uri]::UnescapeDataString($req.Url.AbsolutePath)
      if ($caminho -eq '/') { $caminho = '/index.html' }
      $arquivo = [IO.Path]::GetFullPath((Join-Path $raiz ($caminho -replace '/', '\')))
      if ($arquivo.StartsWith($raiz) -and (Test-Path -LiteralPath $arquivo -PathType Leaf)) {
        $bytes = [IO.File]::ReadAllBytes($arquivo)
        $ext = [IO.Path]::GetExtension($arquivo).ToLower()
        $res.ContentType = if ($tipos.ContainsKey($ext)) { $tipos[$ext] } else { 'application/octet-stream' }
        $res.AddHeader('Cache-Control', 'no-cache')
        $res.ContentLength64 = $bytes.Length
        if ($req.HttpMethod -ne 'HEAD' -and $bytes.Length -gt 0) {
          $res.OutputStream.Write($bytes, 0, $bytes.Length)
        }
      } else {
        $res.StatusCode = 404
      }
    } catch {
      Write-Host "ERRO $caminho : $($_.Exception.Message)"
      try { $res.StatusCode = 500 } catch {}
    } finally {
      try { $res.Close() } catch {}
    }
    Write-Host ("{0} {1} {2}" -f $res.StatusCode, $req.HttpMethod, $caminho)
  }
} finally {
  $listener.Stop()
}
