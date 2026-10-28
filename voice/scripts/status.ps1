#requires -Version 7.0
<#
.SYNOPSIS
  查看本机 LiveKit 运行状态（进程 / 健康检查 / 端口 / 日志尾部）。
#>
[CmdletBinding()]
param(
  [int]$Tail = 12
)

$ErrorActionPreference = 'Stop'

$root    = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $root 'logs\server.pid'
$errLog  = Join-Path $root 'logs\server.err.log'
$url     = 'http://127.0.0.1:7880/'

$healthy = $false
try {
  $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
  $healthy = ($r.StatusCode -eq 200)
} catch { }

$procId = $null
if (Test-Path -LiteralPath $pidFile) {
  $savedId = Get-Content -LiteralPath $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1
  $p = if ($savedId) { Get-Process -Id ([int]$savedId) -ErrorAction SilentlyContinue } else { $null }
  if ($p -and $p.ProcessName -eq 'livekit-server') { $procId = $p.Id }
}

Write-Host '=== LiveKit 状态 ==='
if ($procId) {
  $p = Get-Process -Id $procId
  Write-Host ("进程   : 运行中 PID $procId（启动于 " + $p.StartTime.ToString('yyyy-MM-dd HH:mm:ss') + "）") -ForegroundColor Green
} else {
  Write-Host '进程   : 未运行（start.ps1 启动的实例）' -ForegroundColor Yellow
}
Write-Host ("健康   : " + $(if ($healthy) { '200 OK' } else { '不可达' })) -ForegroundColor $(if ($healthy) { 'Green' } else { 'Red' })
Write-Host ("地址   : ws://127.0.0.1:7880  (RTC TCP 7881 / UDP 7882)")

$listening = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $_.LocalPort -in 7880, 7881 } |
  Select-Object LocalAddress, LocalPort, OwningProcess
if ($listening) {
  Write-Host '端口   :'
  $listening | ForEach-Object { Write-Host ("         {0}:{1}  PID {2}" -f $_.LocalAddress, $_.LocalPort, $_.OwningProcess) }
}
$udp = Get-NetUDPEndpoint -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -eq 7882 } | Select-Object -First 4
if ($udp) {
  Write-Host 'UDP    :'
  $udp | ForEach-Object { Write-Host ("         {0}:7882  PID {1}" -f $_.LocalAddress, $_.OwningProcess) }
}

if (Test-Path -LiteralPath $errLog) {
  Write-Host "--- 日志尾部（$errLog）---"
  Get-Content -LiteralPath $errLog -Tail $Tail -ErrorAction SilentlyContinue
}

# 联调服务（dev/server.mjs）
$devHealthy = $false
try {
  $devRes = Invoke-WebRequest -Uri 'http://127.0.0.1:7890/health' -UseBasicParsing -TimeoutSec 2
  $devHealthy = ($devRes.StatusCode -eq 200)
} catch { }
Write-Host ''
Write-Host '=== 联调服务 ==='
Write-Host ("状态   : " + $(if ($devHealthy) { '运行中  http://127.0.0.1:7890/' } else { '未运行（scripts\dev.cmd 启动）' })) `
  -ForegroundColor $(if ($devHealthy) { 'Green' } else { 'Yellow' })

# 语音 Agent
$agentPidFile = Join-Path $root 'logs\agent.pid'
$agentId = $null
if (Test-Path -LiteralPath $agentPidFile) {
  $savedAgentId = Get-Content -LiteralPath $agentPidFile -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($savedAgentId) {
    $agentProc = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$savedAgentId)" -ErrorAction SilentlyContinue
    if ($agentProc -and $agentProc.Name -eq 'python.exe' -and $agentProc.CommandLine -like '*agent.pet_agent*') {
      $agentId = $agentProc.ProcessId
    }
  }
}
Write-Host ''
Write-Host '=== 语音 Agent ==='
if ($agentId) {
  Write-Host "状态   : 运行中 PID $agentId（自动加入 pet-room* 房间）" -ForegroundColor Green
} else {
  Write-Host '状态   : 未运行（scripts\agent.cmd 启动）' -ForegroundColor Yellow
}
$agentLog = Join-Path $root 'logs\agent.out.log'
if (Test-Path -LiteralPath $agentLog) {
  Write-Host '--- Agent 日志尾部 ---'
  Get-Content -LiteralPath $agentLog -Tail $Tail -ErrorAction SilentlyContinue
}


