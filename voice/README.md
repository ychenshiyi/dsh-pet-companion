# LiveKit 本机环境 + 语音 Agent（小鱼）

自托管 **LiveKit 1.13.11**（Windows 二进制）+ 本机令牌服务 + 浏览器联调页 + **可以自由对话的中文语音 Agent**。
所有入口都只在本机：信令 `ws://127.0.0.1:7880`，令牌/页面 `127.0.0.1:7890`，API secret 不进浏览器。

## 目录

```
voice/
├─ livekit_1.13.11_windows_amd64/   官方 Windows 二进制（gitignore，bootstrap 下载）
├─ livekit.yaml                     服务端配置（含 API key/secret，gitignore）
├─ pyproject.toml                   ruff / pytest 配置（CI 用）
├─ scripts/                         bootstrap / dev / start / stop / status / agent / selftest（.ps1 + .cmd）
├─ tools/                           jwt.mjs（签令牌）/ verify.mjs（服务端校验）
├─ tests/                           纯逻辑单测（text_split / wake_gate / prosody / emotion）
├─ dev/
│  ├─ server.mjs                    127.0.0.1:7890：/token、/health、静态页
│  ├─ public/                       联调页、app.js、本地 livekit-client、测试语音
│  └─ test/                         webrtc-check / agent-check / loop-check
├─ agent/
│  ├─ pet_agent.py                  语音 Agent 入口（AgentServer）
│  ├─ stt_sensevoice.py             本地 SenseVoice STT（sherpa-onnx）
│  ├─ tts_edge.py / tts_melo.py     Edge TTS 适配器 / 离线 MeloTTS 适配器
│  ├─ emotion.py / prosody.py       语音侧情感状态 / 情绪 → 韵律
│  ├─ wake_gate.py                  唤醒词门（空闲后必须叫名字）
│  ├─ audio_utils.py / settings.py  音频与配置
│  ├─ smoke_test.py                 TTS→STT→LLM 冒烟测试
│  └─ .env.example
├─ models/sense-voice/              SenseVoice int8 模型（约 230MB，gitignore）
├─ models/melo-tts/                 MeloTTS 模型（约 170MB，gitignore）
├─ .venv/                           Python 3.12 虚拟环境（gitignore）
└─ logs/                            服务日志与 PID（gitignore）
```

## 快速开始

```bat
:: 下载模型与二进制（约 1.2GB）、建 venv、装依赖；可重复执行
pwsh -File scripts\bootstrap.ps1

:: 起 LiveKit + 联调页 + Agent
scripts\dev.cmd
```

1. 打开 **<http://127.0.0.1:7890/>**
2. 身份随便填，房间保持 `pet-room`（或 `pet-room-任意后缀`）→ 加入
3. **语音 Agent「小鱼」会自动出现在房间里并打招呼**
4. 允许麦克风后直接说话：说完停 0.6 秒左右，Agent 就会回答（也可以随时打断它）

停止全部：`scripts\stop.cmd`

> 首次启动 Agent 要加载 230MB 模型（约 2 秒），第一次识别会稍慢。

## 开发与测试

```bat
.venv\Scripts\python.exe -m pytest -q          :: 纯逻辑单测，不需要模型
.venv\Scripts\ruff.exe format --check .        :: 格式
.venv\Scripts\ruff.exe check .                 :: 静态检查
```

CI（`.github/workflows/ci.yml`）只装 `pytest` + `ruff`，不装 `livekit-agents` 那套重依赖——
被测的四个模块是纯逻辑，几秒内就能出结果。

## 语音 Agent 是什么

```
麦克风 ──► LiveKit ──► 小鱼 Agent
                         ├─ STT：SenseVoice（本地、离线、中文带标点）
                         ├─ LLM：DeepSeek（复用 DSH 里的 API key）
                         └─ TTS：Edge TTS（晓晓，免费在线，自然口语）
                                     └──► LiveKit ──► 浏览器扬声器
```

- **人设**：Q 版蓝发小女仆（本体是爱吃白饭的蓝色大肥鱼），只回一两句口语短句，不提 AI
- **自动分派**：Agent 只服务 `pet-room*` 房间（`AGENT_ROOM_PREFIX` 可改），其它测试房间不受打扰
- **打断**：本地 VAD 判定（不用 LiveKit Cloud 的 turn-detector，避免每次会话先等云端超时）
- **实测延迟**：STT ~150ms · LLM 首字 ~1.1s · TTS 每句 1.8–2.5s → 说完到听见回复约 **3–4 秒**

## 常用命令

| 目的 | 命令 |
| --- | --- |
| 启动全部（LiveKit + 联调服务 + Agent） | `scripts\dev.cmd` |
| 单独启动 Agent | `scripts\agent.cmd` |
| 停止全部 | `scripts\stop.cmd` |
| 查看状态 / 端口 / 日志尾部 | `scripts\status.cmd` |
| 一键自检（服务端 + 语音链路 + 双浏览器 + Agent） | `scripts\selftest.cmd` |
| 完整对话回环（发布一段中文问题给 Agent） | `scripts\looptest.cmd` |
| 只校验服务端与令牌 | `scripts\verify.cmd` |
| 浏览器自动化（双人音频 / Agent / 回环） | `cd dev && npm test` 等 |

## 端口

| 端口 | 协议 | 绑定 | 用途 |
| --- | --- | --- | --- |
| 7880 | TCP | 所有网卡 | HTTP / WebSocket 信令 |
| 7881 | TCP | 所有网卡 | WebRTC over TCP（UDP 不通时回退） |
| 7882 | UDP | 所有网卡 | WebRTC 媒体（单端口 mux） |
| 7890 | TCP | **仅 127.0.0.1** | 令牌签发 + 联调页 |

信令监听所有网卡是 WebRTC 取候选地址的需要；能否进房由 JWT 决定。本机使用不要做端口映射。

## 配置

- `livekit.yaml`：端口、RTC、密钥（`livekit-server generate-keys` 生成，gitignore）
- `agent/.env`（可选，参考 `.env.example`）：
  - `DEEPSEEK_API_KEY`：**不填会自动复用 `~/.dsh/.credentials.yaml` 里的 DEEPSEEK_API_KEY**
  - `DEEPSEEK_MODEL`（默认 `deepseek-chat`）、`EDGE_TTS_VOICE`（默认 `zh-CN-XiaoxiaoNeural`）
  - `PET_NAME`（默认「小鱼」）、`STT_LANGUAGE`（默认 `zh`）
- `AGENT_ROOM_PREFIX`（默认 `pet-room`）：Agent 只进这些房间

> venv 必须基于 **独立 Python 3.12**（DSH 自带那个）。用 Anaconda 3.11 时 `livekit-local-inference` 的原生扩展会 0xC0000005 崩溃（已踩过，`requirements.txt` 里写了原因）。

## 架构

```
浏览器 ──GET /health / POST /token──► 本机服务 127.0.0.1:7890（签名 JWT）
   │
   └── WS 7880 + UDP 7882 ──► LiveKit ◄──► 小鱼 Agent（Python）
                                 │
                                 └── STT(SenseVoice) → DeepSeek → TTS(Edge)
```

## 验证明细（本机实测通过）

| 项 | 结果 |
| --- | --- |
| `tools/verify.mjs` | **5/5**：健康 200、CreateRoom、ListRooms、join 令牌字段、DeleteRoom |
| `dev/test/webrtc-check.mjs` | **8/8**：发布/订阅、远端音量 46%~100%、live 轨道、静音同步 |
| `dev/test/agent-check.mjs` | **4/4**：Agent 自动进房、音频轨道、TTS 音量 100% |
| `dev/test/loop-check.mjs` | **7/7**：发布 7 秒中文问题 → STT 识别 → LLM 回复 → 语音回传（峰值 100%） |
| `agent/smoke_test.py` | TTS 出声、STT 146ms、DeepSeek 首字 1113ms |

实测对话片段：

```
用户：小鱼你好，今天心情怎么样？用一句话回答我就好。祝你能天天开心。
小鱼：今天心情可好啦，看到主人回来就更开心了，你呢？
```

截图：`dev/test/artifacts/agent-greeting.png`、`loop-check.png`。

## 故障排查

| 现象 | 处理 |
| --- | --- |
| 加入后提示 **Permission denied** | 麦克风被浏览器/系统拦了。① 地址栏左侧图标 → 麦克风 → 允许，刷新；② `chrome://settings/content/microphone` 删掉 127.0.0.1 的「阻止」；③ Windows 设置 → 隐私和安全性 → 麦克风 → 允许桌面应用访问。**页面会降级成「仅收听」而不会断连** |
| Agent 不进来 | 房间名必须是 `pet-room` 开头；看 `logs/agent.out.log` 是否有 `registered worker` / `新会话` |
| 有转写但没声音 | 检查 Edge TTS 网络（`python -m agent.smoke_test`）；TTS 失败会写在 `logs/agent.out.log` |
| 说完半天才回 | Edge TTS 在网络差时单句要 2s+；可把 `EDGE_TTS_RATE` 调快，或后续换本地 TTS |
| `start` 报 7880 占用 | `scripts\stop.cmd`，或改 `livekit.yaml` 端口 |
| 跨机加入失败 | `nodeIP` 取的是本机某块网卡（Hyper-V/WSL 的虚拟网卡常被选中）；跨机时在 `livekit.yaml` 把 `rtc.node_ip` 显式设成真实 LAN IP |
| venv 里 import 崩溃 | 不要用 Anaconda 3.11 建 venv；改用 Python 3.12 重建 |

## 安全与边界

- `livekit.yaml` 含 API secret，已 gitignore；轮换：停服 → `generate-keys` → 改配置 → 起服
- 7890 只绑回环且校验 Origin；JWT 默认 1 小时、限房间
- Agent 会复用 DSH 的 DeepSeek key（计费算在你的账号上）；Edge TTS 会把文字发到微软语音服务
- 当前只做本机；公网/手机访问需要 TLS + TURN，且要重新评估暴露面

## 与桌宠的接线（已完成）

`dsh-pet` 的 `VoiceSupervisor`（`dsh-pet/src/app/companion/supervisor.ts`）负责：

- 按需拉起 `livekit-server` 与 `python -m agent.pet_agent dev`，**空闲 5 分钟自动回收**
- 通过环境变量注入 `LIVEKIT_*` / `DEEPSEEK_*` / `PET_*` / `DSH_PET_MEMORY_FILE` / `DSH_PET_EMOTION_FILE`
- 三个路径由 `dsh-pet\scripts\app.ps1` 推导：`DSH_PET_LIVEKIT_BIN` / `DSH_PET_PYTHON` / `DSH_PET_AGENT_ROOT`（= 本目录 `voice/`）

## 下一步

1. 延迟：Edge TTS 改流式（首包 ~1.2s 出声）、STT 换流式
2. 唤醒词换 openWakeWord（现在靠转写文本匹配，安静环境下够用）
3. 局域网/手机访问：`rtc.node_ip` + 防火墙 + TURN
