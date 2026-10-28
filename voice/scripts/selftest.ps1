#requires -Version 7.0
<#
.SYNOPSIS
  自检：拉起 LiveKit + 联调服务 + 语音 Agent，然后跑四组验收。
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$dev = Join-Path $root 'dev'

& (Join-Path $PSScriptRoot 'dev.ps1')

Write-Host ''
Write-Host '=== 1/4 服务端与令牌 ==='
Push-Location $root
node tools\verify.mjs
$c1 = $LASTEXITCODE
Pop-Location

Write-Host ''
Write-Host '=== 2/4 语音链路（Edge TTS → SenseVoice → DeepSeek）==='
Push-Location $root
& (Join-Path $root '.venv\Scripts\python.exe') -m agent.smoke_test
$c2 = $LASTEXITCODE
Pop-Location

Write-Host ''
Write-Host '=== 3/4 双浏览器音频 ==='
Push-Location $dev
node test\webrtc-check.mjs
$c3 = $LASTEXITCODE
Pop-Location

Write-Host ''
Write-Host '=== 4/4 语音 Agent（自动进房 + 问候）==='
Push-Location $dev
node test\agent-check.mjs
$c4 = $LASTEXITCODE
Pop-Location

Write-Host ''
if ($c1 -ne 0 -or $c2 -ne 0 -or $c3 -ne 0 -or $c4 -ne 0) {
  Write-Host "自检未全部通过（$c1/$c2/$c3/$c4）" -ForegroundColor Red
  exit 1
}
Write-Host '自检全部通过 ✔' -ForegroundColor Green
Write-Host '完整对话回环可另跑：scripts\looptest.cmd'
exit 0
