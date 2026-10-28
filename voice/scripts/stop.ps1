#requires -Version 7.0
<#
.SYNOPSIS
  停止由 start.ps1 启动的 LiveKit 服务。
#>
[CmdletBinding()]
param(
  [switch]$Quiet
)

$ErrorActionPreference = 'Stop'

$root    = Split-Path -Parent $PSScriptRoot
$exeDir  = Join-Path $root 'livekit_1.13.11_windows_amd64'
$pidFile = Join-Path $root 'logs\server.pid'
$url     = 'http://127.0.0.1:7880/'

function Test-Health {
  try {
    $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
    return ($r.StatusCode -eq 200)
  } catch {
    return $false
  }
}

$stopped = @()

# 1) 按 PID 文件停止
if (Test-Path -LiteralPath $pidFile) {
  $savedId = Get-Content -LiteralPath $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($savedId) {
    $p = Get-Process -Id ([int]$savedId) -ErrorAction SilentlyContinue
    if ($p -and $p.ProcessName -eq 'livekit-server') {
      Stop-Process -Id $p.Id -Force
      $stopped += $p.Id
    }
  }
  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
}

# 2) 兜底：本目录二进制启动的所有 livekit-server（例如手工在终端里跑的）
Get-CimInstance Win32_Process -Filter "Name='livekit-server.exe'" -ErrorAction SilentlyContinue |
  Where-Object {
    $_.ExecutablePath -and $_.ExecutablePath.StartsWith($exeDir, [System.StringComparison]::OrdinalIgnoreCase)
  } |
  ForEach-Object {
    if ($stopped -notcontains $_.ProcessId) {
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
      $stopped += $_.ProcessId
    }
  }

Start-Sleep -Milliseconds 500

# 3) 联调服务（dev/server.mjs）：按 PID 文件停止，并核对确实是我们启动的 node
$devPidFile = Join-Path $root 'logs\dev-server.pid'
if (Test-Path -LiteralPath $devPidFile) {
  $devId = Get-Content -LiteralPath $devPidFile -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($devId) {
    $devProc = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$devId)" -ErrorAction SilentlyContinue
    if ($devProc -and $devProc.Name -eq 'node.exe' -and $devProc.CommandLine -like '*server.mjs*') {
      Stop-Process -Id $devProc.ProcessId -Force -ErrorAction SilentlyContinue
      if (-not $Quiet) { Write-Host "已停止联调服务（PID $($devProc.ProcessId)）" -ForegroundColor Green }
    }
  }
  Remove-Item -LiteralPath $devPidFile -Force -ErrorAction SilentlyContinue
}

# 4) 语音 Agent（python -m agent.pet_agent）
$agentPidFile = Join-Path $root 'logs\agent.pid'
$agentStopped = @()
if (Test-Path -LiteralPath $agentPidFile) {
  $agentId = Get-Content -LiteralPath $agentPidFile -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($agentId) {
    $agentProc = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$agentId)" -ErrorAction SilentlyContinue
    if ($agentProc -and $agentProc.Name -eq 'python.exe' -and $agentProc.CommandLine -like '*agent.pet_agent*') {
      Stop-Process -Id $agentProc.ProcessId -Force -ErrorAction SilentlyContinue
      $agentStopped += $agentProc.ProcessId
    }
  }
  Remove-Item -LiteralPath $agentPidFile -Force -ErrorAction SilentlyContinue
}
# 兜底：本项目 venv 里跑的所有 agent.pet_agent 进程
Get-CimInstance Win32_Process -Filter "Name='python.exe'" -ErrorAction SilentlyContinue |
  Where-Object {
    $_.CommandLine -like '*agent.pet_agent*' -and
    $_.ExecutablePath -and $_.ExecutablePath.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)
  } |
  ForEach-Object {
    if ($agentStopped -notcontains $_.ProcessId) {
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
      $agentStopped += $_.ProcessId
    }
  }
if ($agentStopped.Count -gt 0 -and -not $Quiet) {
  Write-Host ("已停止语音 Agent（PID " + ($agentStopped -join ', ') + "）") -ForegroundColor Green
}

if (Test-Health) {
  if (-not $Quiet) { Write-Host '警告：7880 仍有服务响应，可能由其它进程提供。' -ForegroundColor Yellow }
  exit 1
}

if ($stopped.Count -gt 0) {
  if (-not $Quiet) { Write-Host ("已停止 LiveKit（PID " + ($stopped -join ', ') + "）") -ForegroundColor Green }
} elseif (-not $Quiet) {
  Write-Host '当前没有正在运行的 LiveKit 实例。'
}
exit 0
