#requires -Version 7.0
<#
.SYNOPSIS
  一键启动本机 LiveKit + 联调服务（两者都在后台），并打印访问地址。

.DESCRIPTION
  - LiveKit 已在运行则复用（调用 start.ps1，幂等）
  - 联调服务（dev/server.mjs，127.0.0.1:7890）未运行则在后台拉起，日志在 logs\
  - -Restart 先停掉全部再启动

  想前台看联调日志时，直接：cd dev; npm start
#>
[CmdletBinding()]
param(
  [switch]$Restart
)

$ErrorActionPreference = 'Stop'

$root   = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $root 'logs'
$devDir = Join-Path $root 'dev'
$devPidFile = Join-Path $logDir 'dev-server.pid'
$devOut = Join-Path $logDir 'dev-server.out.log'
$devErr = Join-Path $logDir 'dev-server.err.log'
$healthUrl = 'http://127.0.0.1:7890/health'

if ($Restart) {
  & (Join-Path $PSScriptRoot 'stop.ps1') -Quiet
}

# 1) LiveKit
& (Join-Path $PSScriptRoot 'start.ps1')

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Test-DevHealth {
  try {
    $r = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 2
    return ($r.StatusCode -eq 200)
  } catch {
    return $false
  }
}

# 2) 联调服务
if (-not (Test-DevHealth)) {
  $node = (Get-Command node -ErrorAction SilentlyContinue)?.Source
  if (-not $node) {
    $fallback = Join-Path $env:USERPROFILE '.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
    if (Test-Path -LiteralPath $fallback) { $node = $fallback }
  }
  if (-not $node) { throw '找不到 node（请把 Node.js 加进 PATH）' }

  Set-Content -LiteralPath $devOut -Value '' -Encoding utf8
  Set-Content -LiteralPath $devErr -Value '' -Encoding utf8
  $proc = Start-Process -FilePath $node -ArgumentList 'server.mjs' -WorkingDirectory $devDir `
    -RedirectStandardOutput $devOut -RedirectStandardError $devErr -WindowStyle Hidden -PassThru
  Set-Content -LiteralPath $devPidFile -Value $proc.Id -Encoding ascii

  $ready = $false
  for ($i = 0; $i -lt 25; $i++) {
    Start-Sleep -Milliseconds 300
    if ($proc.HasExited) { break }
    if (Test-DevHealth) { $ready = $true; break }
  }
  if (-not $ready) {
    Write-Host '联调服务启动失败，日志尾部：' -ForegroundColor Red
    Get-Content -LiteralPath $devErr -Tail 30 -ErrorAction SilentlyContinue
    Get-Content -LiteralPath $devOut -Tail 30 -ErrorAction SilentlyContinue
    exit 1
  }
  Write-Host "联调服务已启动（PID $($proc.Id)）" -ForegroundColor Green
} else {
  Write-Host '联调服务已在运行（复用现有实例）'
}

Write-Host ''
Write-Host '  LiveKit 信令 : ws://127.0.0.1:7880'
Write-Host '  联调页面     : http://127.0.0.1:7890/' -ForegroundColor Green
Write-Host '  停止全部     : scripts\stop.cmd'
Write-Host ''

# 3) 语音 Agent
& (Join-Path $PSScriptRoot 'agent.ps1')

