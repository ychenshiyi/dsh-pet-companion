#requires -Version 7.0
<#
.SYNOPSIS
  启动语音 Agent（后台），并等待它注册到 LiveKit。

.DESCRIPTION
  - 依赖：livekit\.venv（Python 3.12）、models\sense-voice、LiveKit 服务
  - 已在运行则直接返回（幂等）
  - -Foreground 前台运行，Ctrl+C 结束
#>
[CmdletBinding()]
param(
  [switch]$Foreground
)

$ErrorActionPreference = 'Stop'

$root    = Split-Path -Parent $PSScriptRoot
$python  = Join-Path $root '.venv\Scripts\python.exe'
$logDir  = Join-Path $root 'logs'
$pidFile = Join-Path $logDir 'agent.pid'
$outLog  = Join-Path $logDir 'agent.out.log'
$errLog  = Join-Path $logDir 'agent.err.log'

if (-not (Test-Path -LiteralPath $python)) {
  throw "找不到 venv Python：$python（先用 Python 3.12 建 venv 并装 agent/requirements.txt）"
}
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Test-AgentRunning {
  if (-not (Test-Path -LiteralPath $pidFile)) { return $false }
  $savedId = Get-Content -LiteralPath $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $savedId) { return $false }
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$savedId)" -ErrorAction SilentlyContinue
  return ($proc -and $proc.Name -eq 'python.exe' -and $proc.CommandLine -like '*agent.pet_agent*')
}

if (Test-AgentRunning) {
  Write-Host "语音 Agent 已在运行（PID $((Get-Content -LiteralPath $pidFile | Select-Object -First 1))）"
  exit 0
}

if ($Foreground) {
  Write-Host "前台运行语音 Agent（Ctrl+C 结束）"
  Set-Location $root
  & $python -m agent.pet_agent dev
  exit $LASTEXITCODE
}

Set-Content -LiteralPath $outLog -Value '' -Encoding utf8
Set-Content -LiteralPath $errLog -Value '' -Encoding utf8
$proc = Start-Process -FilePath $python -ArgumentList @('-m', 'agent.pet_agent', 'dev') -WorkingDirectory $root `
  -RedirectStandardOutput $outLog -RedirectStandardError $errLog -WindowStyle Hidden -PassThru
Set-Content -LiteralPath $pidFile -Value $proc.Id -Encoding ascii

# 等它注册到 LiveKit（日志里出现 registered worker）
$ready = $false
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Milliseconds 500
  if ($proc.HasExited) { break }
  if (Select-String -LiteralPath $outLog -Pattern 'registered worker' -Quiet -ErrorAction SilentlyContinue) {
    $ready = $true
    break
  }
}
if (-not $ready) {
  Write-Host '语音 Agent 启动失败或超时，日志尾部：' -ForegroundColor Red
  Get-Content -LiteralPath $errLog -Tail 30 -ErrorAction SilentlyContinue
  Get-Content -LiteralPath $outLog -Tail 30 -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
  exit 1
}

Write-Host "语音 Agent 已启动（PID $($proc.Id)）" -ForegroundColor Green
Write-Host "  自动加入 pet-room* 房间；日志：$outLog"
