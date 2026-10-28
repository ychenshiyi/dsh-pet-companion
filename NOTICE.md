# NOTICE · 第三方组件与素材

本仓库（dsh-pet 伴侣分支）以 **MIT** 发布，见 [`LICENSE`](LICENSE)。
下面是随仓库分发或运行时依赖的第三方内容，**各自的许可证优先于本仓库的 MIT**。

---

## 1. 上游项目

| 组件 | 来源 | 许可证 |
| --- | --- | --- |
| dsh-pet（桌宠插件、素材生成链、提示词） | <https://github.com/PC2005-cloud/dsh-pet> | MIT，Copyright (c) 2026 PC2005-cloud |

本仓库在其基础上增加了「伴侣模式」（独立应用、设置中心、语音栈、情感养成）。
`dsh-pet/` 目录下未被改动的文件仍属上游版权；改动记录见 `git log`。

## 2. 运行时依赖

| 组件 | 用途 | 许可证 |
| --- | --- | --- |
| [LiveKit server](https://github.com/livekit/livekit) | 本机 WebRTC 服务端（`voice/livekit_*_windows_amd64/`，不打入仓库） | Apache-2.0 |
| [livekit-agents](https://github.com/livekit/agents) | Python Agent 框架（`voice/agent/requirements.txt`） | Apache-2.0 |
| [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) | 本地 STT/TTS 推理运行时 | Apache-2.0 |
| [SenseVoice](https://github.com/FunAudioLLM/SenseVoice) | 本地语音识别模型（`voice/models/sense-voice/`，不打入仓库） | Apache-2.0（以模型卡为准） |
| [MeloTTS](https://github.com/myshell-ai/MeloTTS) | 离线中文 TTS 模型（`voice/models/melo-tts/`，不打入仓库） | MIT，Copyright (c) 2024 MyShell.ai |
| [onnxruntime](https://github.com/microsoft/onnxruntime) | 推理后端 | MIT |
| [edge-tts](https://github.com/rany2/edge-tts) | 默认在线音色（微软 Edge 朗读服务客户端） | **GPL-3.0** ⚠ 见下方说明 |
| [livekit-client](https://github.com/livekit/client-sdk-js) | 联调页与隐藏语音窗的浏览器端 SDK | Apache-2.0 |
| Electron | 独立应用的窗口运行时 | MIT |

> ⚠ **edge-tts 是 GPL-3.0**。它与本仓库（MIT）不冲突，但如果你要把**打包产物**闭源分发，
> 需要评估：要么接受 GPL 的传染性，要么在构建里排除 `edge-tts`、只用 MeloTTS 离线档
> （`voice/agent/tts_melo.py` 已实现同一接口，可直接替换）。

## 3. 素材与字体

| 内容 | 说明 |
| --- | --- |
| `dsh-pet/assets/webm/`、`assets/preview/` 下的动画 | 由本仓库素材生成链（`scripts/` + `prompts/`）产出；源视频托管在 GitHub Releases，不入库 |
| `dsh-pet/assets/fonts/上首软糖体.ttf` | 第三方中文字体，**商用授权需自行确认**；若你的分发场景涉及商用，请替换为可商用的开源字体（如思源黑体 / 得意黑） |
| `assets/screenshots/` | 本项目运行截图，随仓库以 MIT 分发 |

## 4. 未随仓库分发的大文件

以下内容按需下载，**不在 Git 历史里**（见 `.gitignore` 与 `voice/scripts/bootstrap.ps1`）：

- LiveKit server 二进制（约 55 MB）
- SenseVoice 模型（约 239 MB）、MeloTTS 模型（约 170 MB）
- Python venv（约 460 MB）、`node_modules`
