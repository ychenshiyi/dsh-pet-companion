#requires -Version 7.0
<#
.SYNOPSIS
  启动本机 LiveKit 服务（后台），并等待健康检查通过。

.DESCRIPTION
  读取 livekit.yaml，后台启动 livekit-server.exe，PID 与日志落在 livekit\logs\。
  - 已有本脚本启动的实例在跑：直接返回成功（幂等）
  - 端口被其它进程占用：报错退出，不抢占
  - 启动失败：打印日志尾部并以非 0 退出

.PARAMETER Foreground
  前台运行（调试用，Ctrl+C 结束）。
#>
[CmdletBinding()]
param(
  [switch]$Foreground
)

$ErrorActionPreference = 'Stop'

$root    = Split-Path -Parent $PSScriptRoot
$exe     = Join-Path $root 'livekit_1.13.11_windows_amd64\livekit-server.exe'
$cfg     = Join-Path $root 'livekit.yaml'
$logDir  = Join-Path $root 'logs'
$pidFile = Join-Path $logDir 'server.pid'
$outLog  = Join-Path $logDir 'server.out.log'
$errLog  = Join-Path $logDir 'server.err.log'
$url     = 'http://127.0.0.1:7880/'

if (-not (Test-Path -LiteralPath $exe)) { throw "找不到 livekit-server.exe：$exe" }
if (-not (Test-Path -LiteralPath $cfg)) { throw "找不到配置文件：$cfg（含 API 密钥，不要提交）" }
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Test-Health {
  try {
    $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
    return ($r.StatusCode -eq 200)
  } catch {
    return $false
  }
}

# 1) 已有本脚本启动的实例：幂等返回
if (Test-Path -LiteralPath $pidFile) {
  $oldId = Get-Content -LiteralPath $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($oldId) {
    $oldProc = Get-Process -Id ([int]$oldId) -ErrorAction SilentlyContinue
    if ($oldProc -and $oldProc.ProcessName -eq 'livekit-server') {
      if (Test-Health) {
        Write-Host "LiveKit 已在运行（PID $oldId）：ws://127.0.0.1:7880"
        exit 0
      }
      Write-Host "发现残留 PID $oldId（健康检查失败），先停止再重启…"
      & (Join-Path $PSScriptRoot 'stop.ps1') -Quiet
    }
  }
}

# 2) 端口被别的实例占用：不抢占，明确报错
if (Test-Health) {
  throw "端口 7880 已有服务在响应，但不是本脚本记录的实例。先停止它（scripts\stop.ps1）或改用其它端口。"
}

$cliArgs = @('--config', $cfg)

if ($Foreground) {
  Write-Host "前台运行：`"$exe`" $($cliArgs -join ' ')"
  & $exe @cliArgs
  exit $LASTEXITCODE
}

# 3) 后台启动
Set-Content -LiteralPath $outLog -Value '' -Encoding utf8
Set-Content -LiteralPath $errLog -Value '' -Encoding utf8
$proc = Start-Process -FilePath $exe -ArgumentList $cliArgs -WorkingDirectory $root `
  -RedirectStandardOutput $outLog -RedirectStandardError $errLog -WindowStyle Hidden -PassThru
Set-Content -LiteralPath $pidFile -Value $proc.Id -Encoding ascii

for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Milliseconds 500
  if ($proc.HasExited) {
    Write-Host "启动失败（退出码 $($proc.ExitCode)），日志尾部：" -ForegroundColor Red
    Get-Content -LiteralPath $errLog -Tail 40 -ErrorAction SilentlyContinue
    Get-Content -LiteralPath $outLog -Tail 40 -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
    exit 1
  }
  if (Test-Health) {
    Write-Host "LiveKit 已启动（PID $($proc.Id)）" -ForegroundColor Green
    Write-Host "  HTTP/WS : ws://127.0.0.1:7880"
    Write-Host "  RTC TCP : 7881"
    Write-Host "  RTC UDP : 7882"
    Write-Host "  日志    : $errLog"
    exit 0
  }
}

Write-Host "启动超时（15 秒内健康检查未通过）。日志尾部：" -ForegroundColor Red
Get-Content -LiteralPath $errLog -Tail 40 -ErrorAction SilentlyContinue
Get-Content -LiteralPath $outLog -Tail 40 -ErrorAction SilentlyContinue
exit 1
