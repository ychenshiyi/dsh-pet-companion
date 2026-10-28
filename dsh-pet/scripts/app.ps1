#requires -Version 7.0
<#
.SYNOPSIS
  启动「桌宠伴侣」独立应用（开发期）。

.DESCRIPTION
  自动推导本机路径：LiveKit 二进制、Python venv、Agent 根目录、项目数据目录。
  已存在的同名环境变量优先，便于切换测试环境。
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$pkgRoot = Split-Path $PSScriptRoot -Parent          # dsh-pet/
$repoRoot = Split-Path $pkgRoot -Parent              # dsh-pet-repo/
$projectRoot = Split-Path $repoRoot -Parent          # 002dshlivekit/
$livekitDir = Join-Path $repoRoot 'voice'

function Set-IfEmpty([string]$name, [string]$value) {
  if (-not [Environment]::GetEnvironmentVariable($name, 'Process')) {
    [Environment]::SetEnvironmentVariable($name, $value, 'Process')
  }
}

Set-IfEmpty 'DSH_PET_HOME' (Join-Path $projectRoot 'data\dsh-pet')
Set-IfEmpty 'DSH_PET_LIVEKIT_BIN' (Join-Path $livekitDir 'livekit_1.13.11_windows_amd64\livekit-server.exe')
Set-IfEmpty 'DSH_PET_PYTHON' (Join-Path $livekitDir '.venv\Scripts\python.exe')
Set-IfEmpty 'DSH_PET_AGENT_ROOT' $livekitDir
Set-IfEmpty 'DSH_PET_ELECTRON_PATH' (Join-Path $env:USERPROFILE '.dsh\electron\electron.exe')

Write-Host '=== 桌宠伴侣 ==='
Write-Host ("数据目录 : " + $env:DSH_PET_HOME)
Write-Host ("LiveKit  : " + $env:DSH_PET_LIVEKIT_BIN)
Write-Host ("Agent    : " + $env:DSH_PET_PYTHON)
Write-Host ''

Set-Location $pkgRoot
node scripts/start-app.mjs
