#requires -Version 7.0
<#
.SYNOPSIS
  一条命令搭好语音栈：LiveKit 服务端 + 离线模型 + Python venv + 本机配置。

.DESCRIPTION
  仓库里只放源码，运行时产物（约 1.2GB）全部用本脚本按需下载，并且每个文件都校验 SHA256，
  避免「下到一半的模型」在运行时炸出难以定位的错误。

  可重复执行：已存在且哈希正确的文件会跳过。

.PARAMETER Force
  即使文件已存在、哈希正确也重新下载 / 重建 venv。

.PARAMETER SkipModels
  跳过 SenseVoice / MeloTTS 模型（只用 Edge TTS 在线音色时够用）。

.PARAMETER SkipPython
  跳过 venv 创建与依赖安装。

.PARAMETER SkipLiveKit
  跳过 LiveKit 服务端二进制（已自建/外部 LiveKit 时）。

.PARAMETER Mirror
  模型改从 hf-mirror.com 下载（国内网络访问 huggingface.co 慢或不通时用）。

.EXAMPLE
  pwsh -File voice\scripts\bootstrap.ps1

.EXAMPLE
  pwsh -File voice\scripts\bootstrap.ps1 -Mirror -Force
#>
[CmdletBinding()]
param(
  [switch]$Force,
  [switch]$SkipModels,
  [switch]$SkipPython,
  [switch]$SkipLiveKit,
  [switch]$Mirror
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest 进度条会拖慢下载数倍

$root      = Split-Path -Parent $PSScriptRoot          # voice/
$modelDir  = Join-Path $root 'models'
$venvDir   = Join-Path $root '.venv'
$venvPy    = Join-Path $venvDir 'Scripts\python.exe'
$livekitDir = Join-Path $root 'livekit_1.13.11_windows_amd64'
$livekitExe = Join-Path $livekitDir 'livekit-server.exe'
$cache     = Join-Path $root '.cache'

# ── 下载源与期望哈希（本机实测通过的那一份）──────────────────────────────
$hfHost = if ($Mirror) { 'https://hf-mirror.com' } else { 'https://huggingface.co' }

$assets = @(
  @{
    Name = 'SenseVoice 模型（int8）'
    Url  = "$hfHost/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main/model.int8.onnx"
    Path = Join-Path $modelDir 'sense-voice\model.int8.onnx'
    Size = 239233841
    Sha  = 'C71F0CE00BEC95B07744E116345E33D8CBBE08CEF896382CF907BF4B51A2CD51'
  }
  @{
    Name = 'SenseVoice tokens'
    Url  = "$hfHost/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main/tokens.txt"
    Path = Join-Path $modelDir 'sense-voice\tokens.txt'
    Size = 315894
    Sha  = 'F449EB28DC567533D7FA59BE34E2ABCA8784F771850C78A47FB731A31429A1DC'
  }
)

$meloArchive = @{
  Name = 'MeloTTS zh_en（vits-melo-tts-zh_en）'
  Url  = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-melo-tts-zh_en.tar.bz2'
  Path = Join-Path $cache 'vits-melo-tts-zh_en.tar.bz2'
  Size = 167006755
  Sha  = ''   # 官方包会更新，只校验解包后的 model.onnx
}

$livekitArchive = @{
  Name = 'LiveKit server 1.13.11 (windows amd64)'
  Url  = 'https://github.com/livekit/livekit/releases/download/v1.13.11/livekit_1.13.11_windows_amd64.zip'
  Path = Join-Path $cache 'livekit_1.13.11_windows_amd64.zip'
  Size = 19691002
  Sha  = ''
}

$meloModelSha = 'BF30582EB1B012250A35B1A4A80E7DFBCF8485E7BB9DE0D95EFBBEEF0E4AD86D'
$livekitSha   = '7C63B07E78121EDAB0C81554AF97754CC7ABBAAC05313CDB91C81F51287E16C2'

# ── 工具函数 ──────────────────────────────────────────────────────────────
function Write-Step([string]$text) {
  Write-Host ''
  Write-Host "── $text " -ForegroundColor Cyan -NoNewline
  Write-Host ('─' * [Math]::Max(1, 62 - $text.Length)) -ForegroundColor DarkGray
}

function Test-FileHash([string]$path, [string]$sha) {
  if (-not (Test-Path -LiteralPath $path)) { return $false }
  if (-not $sha) { return $true }
  return (Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash -eq $sha
}

function Get-Asset([hashtable]$asset) {
  $path = $asset.Path
  if ((Test-Path -LiteralPath $path) -and -not $Force) {
    if (Test-FileHash $path $asset.Sha) {
      Write-Host "  ✓ 已存在且校验通过：$(Split-Path $path -Leaf)" -ForegroundColor DarkGray
      return
    }
    Write-Host "  ! 已存在但哈希不符，重新下载：$(Split-Path $path -Leaf)" -ForegroundColor Yellow
    Remove-Item -LiteralPath $path -Force
  }

  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path) | Out-Null
  $tmp = "$path.part"
  Write-Host "  ↓ $($asset.Name)  ($('{0:N0}' -f ($asset.Size / 1MB)) MB)" -ForegroundColor Gray
  $sw = [Diagnostics.Stopwatch]::StartNew()
  Invoke-WebRequest -Uri $asset.Url -OutFile $tmp -UseBasicParsing -TimeoutSec 3600
  $sw.Stop()

  $actual = (Get-Item -LiteralPath $tmp).Length
  if ($asset.Size -and $actual -ne $asset.Size) {
    Remove-Item -LiteralPath $tmp -Force
    throw "下载不完整：$($asset.Name) 期望 $($asset.Size) 字节，实际 $actual 字节"
  }
  if ($asset.Sha) {
    $got = (Get-FileHash -Algorithm SHA256 -LiteralPath $tmp).Hash
    if ($got -ne $asset.Sha) {
      Remove-Item -LiteralPath $tmp -Force
      throw "SHA256 不匹配：$($asset.Name)`n  期望 $($asset.Sha)`n  实际 $got"
    }
  }
  Move-Item -LiteralPath $tmp -Destination $path -Force
  Write-Host ("  ✓ 完成（{0:N1}s，{1:N0} MB/s）" -f $sw.Elapsed.TotalSeconds, ($actual / 1MB / [Math]::Max(0.001, $sw.Elapsed.TotalSeconds))) -ForegroundColor Green
}

function Resolve-Python {
  # 1) 显式指定 2) py launcher 3) PATH 上的 python
  if ($env:DSH_PET_PYTHON_BASE -and (Test-Path -LiteralPath $env:DSH_PET_PYTHON_BASE)) {
    return $env:DSH_PET_PYTHON_BASE
  }
  foreach ($candidate in @('py -3.12', 'python')) {
    $parts = $candidate -split ' '
    try {
      $exe = (Get-Command $parts[0] -ErrorAction Stop).Source
      $args = @($parts | Select-Object -Skip 1) + @('-c', 'import sys; assert sys.version_info[:2] >= (3, 12); print(sys.executable)')
      $out = & $exe @args 2>$null
      if ($LASTEXITCODE -eq 0 -and $out) { return $out.Trim() }
    } catch { continue }
  }
  throw '找不到 Python 3.12+。安装后重试，或设置 DSH_PET_PYTHON_BASE 指向 python.exe。'
}

# ── 1. LiveKit 服务端 ─────────────────────────────────────────────────────
if (-not $SkipLiveKit) {
  Write-Step '1/4 LiveKit 服务端'
  if ((Test-FileHash $livekitExe $livekitSha) -and -not $Force) {
    Write-Host '  ✓ livekit-server.exe 已就位' -ForegroundColor DarkGray
  } else {
    Get-Asset $livekitArchive
    Write-Host '  解包中…' -ForegroundColor Gray
    $unzip = Join-Path $cache 'livekit-unzip'
    if (Test-Path $unzip) { Remove-Item $unzip -Recurse -Force }
    Expand-Archive -LiteralPath $livekitArchive.Path -DestinationPath $unzip -Force
    $inner = Get-ChildItem $unzip -Directory | Select-Object -First 1
    if (-not $inner) { throw '压缩包结构异常：找不到解包目录' }
    if (Test-Path $livekitDir) { Remove-Item $livekitDir -Recurse -Force }
    Move-Item -LiteralPath $inner.FullName -Destination $livekitDir
    Remove-Item $unzip -Recurse -Force -ErrorAction SilentlyContinue
    if (-not (Test-FileHash $livekitExe $livekitSha)) { throw 'livekit-server.exe 校验失败' }
    Write-Host '  ✓ livekit-server.exe 校验通过' -ForegroundColor Green
  }
}

# ── 2. 离线模型 ───────────────────────────────────────────────────────────
if (-not $SkipModels) {
  Write-Step '2/4 离线模型（SenseVoice STT + MeloTTS TTS）'

  foreach ($asset in $assets) { Get-Asset $asset }

  # MeloTTS：官方包自带 dict/ 与 *.fst，按整包解，省得逐个补文件
  $meloTarget = Join-Path $modelDir 'melo-tts'
  $meloModel = Join-Path $meloTarget 'model.onnx'
  if ((Test-FileHash $meloModel $meloModelSha) -and -not $Force) {
    Write-Host '  ✓ melo-tts 已就位' -ForegroundColor DarkGray
  } else {
    Get-Asset $meloArchive
    Write-Host '  解包中…' -ForegroundColor Gray
    $stage = Join-Path $cache 'melo-unzip'
    if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $stage | Out-Null
    & tar.exe -xjf $meloArchive.Path -C $stage
    if ($LASTEXITCODE -ne 0) { throw 'tar 解包 MeloTTS 失败（需要 Windows 自带的 tar.exe）' }
    $inner = Get-ChildItem $stage -Directory | Select-Object -First 1
    if (-not $inner) { throw 'MeloTTS 包结构异常：找不到解包目录' }
    if (Test-Path $meloTarget) { Remove-Item $meloTarget -Recurse -Force }
    Move-Item -LiteralPath $inner.FullName -Destination $meloTarget
    Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
    if (-not (Test-FileHash $meloModel $meloModelSha)) { throw 'melo-tts/model.onnx 校验失败' }
    Write-Host '  ✓ melo-tts 校验通过' -ForegroundColor Green
  }
}

# ── 3. Python venv ────────────────────────────────────────────────────────
if (-not $SkipPython) {
  Write-Step '3/4 Python 虚拟环境'
  $needVenv = $Force -or -not (Test-Path -LiteralPath $venvPy)
  if ($needVenv) {
    $base = Resolve-Python
    Write-Host "  使用 Python：$base" -ForegroundColor Gray
    if (Test-Path $venvDir) { Remove-Item $venvDir -Recurse -Force }
    & $base -m venv $venvDir
    if ($LASTEXITCODE -ne 0) { throw 'venv 创建失败' }
  } else {
    Write-Host '  ✓ .venv 已存在' -ForegroundColor DarkGray
  }
  Write-Host '  安装 requirements.txt（首次约 3–6 分钟）…' -ForegroundColor Gray
  & $venvPy -m pip install --upgrade pip --quiet
  & $venvPy -m pip install -r (Join-Path $root 'agent\requirements.txt') --quiet
  if ($LASTEXITCODE -ne 0) { throw 'pip install 失败' }
  Write-Host '  ✓ 依赖安装完成' -ForegroundColor Green
}

# ── 4. 本机 LiveKit 配置 ──────────────────────────────────────────────────
Write-Step '4/4 本机配置'
$yaml = Join-Path $root 'livekit.yaml'
if ((Test-Path -LiteralPath $yaml) -and -not $Force) {
  Write-Host '  ✓ livekit.yaml 已存在（含密钥，已被 .gitignore 排除）' -ForegroundColor DarkGray
} else {
  $bytes = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  $key = 'API' + (($bytes[0..7] | ForEach-Object { $_.ToString('x2') }) -join '')
  $secret = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
  @"
# LiveKit 服务端配置（本机开发用）—— 由 scripts\bootstrap.ps1 生成，已被 .gitignore 排除
port: 7880
rtc:
  tcp_port: 7881
  udp_port: 7882
  use_external_ip: false
room:
  auto_create: true
  empty_timeout: 60
  departure_timeout: 20
logging:
  level: info
  json: false
keys:
  ${key}: ${secret}
"@ | Set-Content -LiteralPath $yaml -Encoding utf8
  Write-Host "  ✓ 已生成 livekit.yaml（API key: $key）" -ForegroundColor Green
}

# ── 收尾自检 ──────────────────────────────────────────────────────────────
Write-Host ''
if (Test-Path -LiteralPath $venvPy) {
  $probe = & $venvPy -c "import livekit.agents, sherpa_onnx, edge_tts; print('ok')" 2>&1
  if ($LASTEXITCODE -eq 0) { Write-Host '✓ Python 依赖自检通过' -ForegroundColor Green }
  else { Write-Host "✗ Python 依赖自检失败：`n$probe" -ForegroundColor Red; exit 1 }
} else {
  Write-Host '· 跳过 Python 自检（-SkipPython）' -ForegroundColor DarkGray
}
if (-not $SkipLiveKit -and (Test-Path -LiteralPath $livekitExe)) { Write-Host '✓ LiveKit 二进制就位' -ForegroundColor Green }
if (-not $SkipModels -and (Test-Path -LiteralPath (Join-Path $modelDir 'sense-voice\model.int8.onnx'))) { Write-Host '✓ 离线模型就位' -ForegroundColor Green }

Write-Host ''
Write-Host '下一步：' -ForegroundColor Cyan
Write-Host '  voice\scripts\dev.cmd                       # 起 LiveKit + 联调页（浏览器打开 127.0.0.1:7890）'
Write-Host '  dsh-pet\scripts\app.cmd                     # 起桌宠伴侣应用'
