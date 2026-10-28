# dsh-pet × LiveKit 语音伴侣 —— 实施计划 v1.1

> v1.1 变更：确认 4 项决策；**弃用 VoiceStudio**，改用 sherpa-onnx 系本地 TTS；新增「情感养成 / 受控自我进化」设计；
> 回答「Python → Node Agent」可行性；补充生态选型与你没提到的扩展点（含反驳意见）。

---

## 0. 决策记录

| 编号 | 决策 | 结论 |
| --- | --- | --- |
| D1 | 打包路线 | **先 Python sidecar，验证后再评估 Node Agent**（可行，见 §2） |
| D2 | VoiceStudio | **不安装**（5GB+、实时性未知）；改用 sherpa-onnx 本地 TTS / 其它轻量项目 |
| D3 | 首次启动语音 | **默认关闭**，右键或设置里开启 |
| D4 | 数据目录 | **`<项目>/data/dsh-pet`**；首次从 `~/.dsh/dsh-pet` 复制一份（`DSH_PET_HOME` 覆盖，见 §3.1） |
| D5 | 扩展功能 | 「建议加的」全部采纳；**语音情绪**纳入 P6 |
| D6 | 离线 TTS | **MeloTTS 首选，Kokoro 第二档**（模型按需下载，不随包） |
| D7 | 情感养成 v1 | 只做状态 + 记忆；主动消息放 P6 末尾且默认关 |
| D8 | 资源策略 | 语音关闭后**直接杀掉 Agent 与 LiveKit**（下次冷启动 2–4s） |
| D9 | Node 试点 | 放在 **P6 之后**（P7），先完成 P0–P6 的产品闭环 |

---

## 1. 为什么可以放心弃用 VoiceStudio

VoiceStudio 的强项是「克隆 + 配音 + 声音设计」，但它是一个 5GB+ 的独立 Electron/FastAPI 应用，实时 TTS 延迟未验证；
对「桌宠日常对话」来说过重。它的 OpenAI 兼容 TTS 接口说明**方向是对的**（`/v1/audio/speech` + `/v1/audio/voices`），
我们可以保留同样的 provider 接口，只换实现。

**替代方案（按推荐顺序）**：

| 方案 | 体积（约） | 中文 | 情感 | 离线 | 许可 | 定位 |
| --- | --- | --- | --- | --- | --- | --- |
| **Edge TTS**（现有） | 0 | 好 | 无 | 否 | 微软服务条款 | 默认，零安装 |
| **sherpa-onnx + MeloTTS zh_en** | 模型 ~300MB | 良好 | 无 | 是 | MeloTTS MIT / sherpa Apache-2.0 | **离线档首选** |
| sherpa-onnx + Kokoro v1.1-zh | 模型 ~300MB | 好 | 有限 | 是 | Apache-2.0 | 离线备选，音色更活泼 |
| **EmotiVoice** | ~1–1.5GB | 好 | **强（prompt 控制）** | 是 | Apache-2.0 | 情感档（后期） |
| Piper | 60–100MB/音色 | 一般 | 无 | 是 | MIT | 低配兜底 |
| GPT-SoVITS / CosyVoice | 2–3GB+ | 好 | 克隆 | 是（建议 GPU） | 各自许可 | 克隆档（更后期） |

**关键优势**：sherpa-onnx 已经是我们 STT 的运行时，**同一套依赖同时做 STT 和 TTS**，
模型可换、接口不用换；将来换 Node Agent 时 `sherpa-onnx-node` 还能复用同一批模型（见 §2）。

> 参考：[sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx)、[MeloTTS](https://github.com/myshell-ai/MeloTTS)、
> [Kokoro](https://github.com/hexgrad/kokoro)、[EmotiVoice](https://github.com/netease-youdao/EmotiVoice)。

---

## 2. 「先 Python，后 Node Agent」是否可行？

**可行，而且推荐**，但要先立好边界，否则第二次实现会漂移。

### 2.1 现在就要定下来的 Agent 契约

- 输入：`agent-runtime.json`（模型/语音/记忆配置，由主进程写、带 ACL）
- 输出：stdout 就绪信号 + 健康检查；音频只走 LiveKit，不经 IPC
- 记忆：通过本机 HTTP（`/companion/memory/*`，带令牌）读写，**不直接碰文件**
- 进程：主进程只负责启动/停止/重启，不 import Agent 代码

只要这四条不变，Python 换成 Node 就是**换一个可执行文件**，设置页/桌面端/记忆都不用改。

### 2.2 体积账（诚实版）

| 组成 | Python sidecar | Node Agent |
| --- | --- | --- |
| 运行时 | Python 3.12 + venv ≈ 450–600MB | 复用 Electron 的 Node，0 |
| 原生依赖 | onnxruntime/av/ctranslate2 ≈ 150–250MB | sherpa-onnx-node / onnxruntime-node ≈ 80–150MB |
| 模型 | SenseVoice 230MB（+TTS 300MB） | 同一批模型（共享） |
| 合计 | ≈ 800MB–1.1GB | ≈ 500–700MB |

**净省约 250–400MB**，没有想象中「小一个数量级」。Node 化的真正收益是：少一个运行时、少一套依赖升级、
打包/签名更简单；代价是 `@livekit/agents`（JS）生态比 Python 年轻（约 950 stars），VAD/打断/本地 STT/TTS 插件要自己补。

### 2.3 建议节奏

1. P0–P4 用 Python 把产品闭环跑通（已验证，风险最低）。
2. P7 做 **2–3 天 timebox 的 Node 试点**：`@livekit/agents` + `sherpa-onnx-node`（同一模型）+ Edge TTS。
3. 切换门槛（三条同时满足才换）：
   - 首声延迟 ≤ Python 版 + 10%
   - 安装包 ≤ Python 版 − 200MB
   - 现有验收用例（打断、常开、记忆、音色）全部通过

---

## 3. 开源生态选型（除 TTS 外）

| 需求 | 可选项目 | 结论 |
| --- | --- | --- |
| 记忆/长期上下文 | [mem0](https://github.com/mem0ai/mem0)（Apache-2.0）、[Graphiti](https://github.com/getzep/graphiti)（Apache-2.0，需图库）、[Letta](https://github.com/letta-ai/letta)（Apache-2.0，完整 agent 平台） | **先自研 SQLite + 向量检索**，接口留 adapter；需要语义抽取时再接 mem0；Graphiti/Letta 过重，不采用 |
| 语音情绪识别 | [emotion2vec+](https://github.com/ddlBoJack/emotion2vec)（Apache-2.0）、SenseVoice 自带 emotion/event 标签 | 先用 SenseVoice 标签（零额外依赖），不够再上 emotion2vec |
| 唤醒词 | [openWakeWord](https://github.com/dscripka/openWakeWord)（Apache-2.0） | 常开模式强烈建议加，避免 24/7 占用麦克风与流量 |
| 降噪/AEC | WebRTC 内置 `echoCancellation` + RNNoise（BSD） | 常开外放必需；先开 WebRTC AEC，噪声大再加 RNNoise |
| 本地 LLM | Ollama（MIT） | 作为「离线/隐私」可选 provider，不改变默认 DeepSeek |
| 离线 TTS | sherpa-onnx（MeloTTS/Kokoro）、EmotiVoice | 见 §1 |
| Node Agent | [agents-js](https://github.com/livekit/agents-js)（Apache-2.0） | P7 试点 |

---

## 3.1 数据目录：用 `DSH_PET_HOME` 解析到项目目录

`dshHomeDir()` 只认 `DSH_HOME`；如果直接把它指到项目目录，会把 `$DSH_HOME/electron` 运行时缓存一起搬走，
也会影响同机其它 DSH 插件——**不建议**。

改为新增一个「桌宠数据根」专用覆盖：

```ts
// host/helper-process.ts
export function dshPetHome(): string {
  return process.env.DSH_PET_HOME || join(dshHomeDir(), 'dsh-pet');
}
```

- 默认：`$DSH_HOME/dsh-pet`（兼容现有配置）
- 开发/项目：启动器设 `DSH_PET_HOME=<项目>/data/dsh-pet`
- 便携：exe 同目录有 `portable.txt` → `<exeDir>/data/dsh-pet`
- 首次指向空目录：自动从旧目录**复制** `main-config.jsonc` / `memory.json` / `main-animation/` / `memes/` / `pet/`（复制不移动，旧 DSH 仍能用）
- 设置页显示真实路径、支持切换与「打开文件夹」；切换后重启 Agent 生效

---

## 4. 情感养成 + 受控自我进化

> 这是本计划新增的重点。原则：**可感知、可解释、可回滚、不可操纵**。

### 4.1 关系状态（Relationship State）

持久化一份轻量状态（每只宠物一份）：

```jsonc
{
  "affection": 42,        // 好感 0-100
  "trust": 30,            // 信任 0-100
  "familiarity": 55,      // 熟悉 0-100
  "mood": { "valence": 0.3, "arousal": 0.5 },
  "energy": 70,
  "updatedAt": "2026-10-28T00:00:00+08:00"
}
```

- 每轮对话由 LLM 输出结构化增量（`relationship_delta` / `user_emotion` / `important_fact`），代码做**夹紧与冷却**，
  防一夜满好感、防情绪跳变。
- 影响：称呼、语气、主动性、动画分类（开心/撒娇/低落/疲惫）、TTS 情感（EmotiVoice 时）。
- 设置页可见、可重置、可整体关闭；**不做付费加速/成瘾机制**。

### 4.2 三层记忆

1. **短期**：最近 N 轮原文（沿用 `chatMemoryRounds`）
2. **情节记忆**：`episode(事件, 情绪, 重要性, 时间)`，向量检索（SQLite + sqlite-vec / LanceDB）
3. **语义记忆**：`fact(偏好, 重要日期, 关系里程碑)`，去重 + 置信度

- 检索打分：`recency + importance + relevance`（Generative Agents 的思路）
- 反思：每 10 轮或每晚，LLM 把 episodes 汇总成 insights，更新 facts 与「成长日志」
- 存储：单个 SQLite 文件放在可配置目录；导出 JSONL/Markdown（回忆录）

### 4.3 受控自我进化

- **可变层**：口头禅、说话风格、兴趣话题、主动性
- **不可变层**：核心人设、安全边界、用户明确设定
- 每次反思产出**候选变更** → 写进「成长日志」（版本化、可回滚）；高影响变更需用户确认（可开「自动采纳」）
- **禁止**：自主改代码/权限、伪造记忆、情感操纵、绕过用户设置
- 固定问题集做「人设一致性」回归；用户可随时「重置成长」

> 参考思路：Stanford Generative Agents（记忆流+反思）、mem0（抽取/去重）。不直接套 Letta —— 它会替换我们的 agent 主循环。

### 4.4 语音情绪（v1 范围）

- **识别**：先用 SenseVoice 自带的 emotion/event 标签（本地、零额外依赖）；准确率不够再上 emotion2vec+（Apache-2.0）
- **用途**：更新「用户情绪」与关系状态；影响回复策略（安慰/逗乐/收敛）、动画分类、TTS 韵律
- **表达**：Edge TTS 用 rate/pitch 微调 + 措辞；EmotiVoice（后期）再上真正的情感音色
- **边界**：原始音频不落盘、可整体关闭、不根据情绪做诱导或付费引导
- **v1 不做**：情感克隆、情绪驱动的自动长文、跨用户情绪画像

---

## 5. 你没提到、但我建议加的

| 建议 | 理由 | 优先级 |
| --- | --- | --- |
| **唤醒词**（openWakeWord） | 常开不等于一直上传；说「小鱼」才进入对话 | P8 |
| **流式 TTS**（Edge 首包即播） | 现在首声 3–4s，流式可降到 ~2s | P5 |
| **AEC + 降噪** | 外放时不断被自己的声音打断 | P4 |
| **本地 LLM 选项**（Ollama） | 断网/隐私场景 | P8 |
| **多宠物多音色** | 一只宠物一个声音/性格 | P5 |
| **情绪 → 动画映射** | 不新增素材也能“看出心情” | P6 |
| **主动关心**（定时/事件，默认关） | 情感养成的自然延伸，但必须可关 | P6 |
| **回忆录/日记导出** | 长期陪伴的价值沉淀 | P6 |
| **用量/费用面板** | 文本+语音都烧 token，透明可控 | P3 |
| **看门狗 + 自动更新** | 桌面应用长期运行 | P8 |
| **字幕/无障碍** | 听障/静音场景 | P4 |
| **隐私模式**（不落盘、遥测全关） | 语音数据敏感 | P1 |

### 反驳 / 提醒

1. **「自我进化」不能无约束**：让人设/提示词自动改写，几周后必漂移，甚至出现不安全内容。必须版本化 + 可回滚 + 核心不可变。
2. **Node Agent 省不了太多空间**（约 250–400MB），别为了它推迟 MVP；P7 试点即可。
3. **LiveKit 对单机桌宠偏重**（58MB server + WebRTC + 额外进程），但换来 AEC、重连、打断、设备切换；
   实测它只占 57MB 内存——**真正的大头是 Python Agent 的 ONNX Runtime**，优化要打在那里。
   现在换成本地 WebSocket 音频是倒退，不建议。
4. **情感数值不要做成上瘾机制**：透明、可关、可重置，否则产品价值观有问题。
5. **开源项目不要贪多**：每加一个引擎就多一份模型/许可/兼容成本；先 Edge + sherpa 离线 TTS 两档，其余走 provider 接口。

---

## 6. 修订后的架构（变化部分）

```
dsh-pet app（Electron）
├─ 主进程
│  ├─ 本机 HTTP /companion/*（设置、token、记忆、进程状态）
│  ├─ ProcessSupervisor：LiveKit + Agent（Python；P7 后可换 Node）
│  ├─ ConversationStore（SQLite：episodes/facts/relationship）
│  └─ 隐藏语音窗（WebRTC/麦克风/AEC）
├─ Agent（Python sidecar）
│  ├─ STT：SenseVoice（默认）/ 可选 VoiceStudio 已弃用
│  ├─ TTS：Edge（默认）/ sherpa-onnx MeloTTS/Kokoro（离线）/ EmotiVoice（情感，后期）
│  └─ 每轮输出 relationship_delta + 记忆候选
└─ 桌宠窗：状态角标 / 字幕 / 情感动画
```

## 6.5 资源占用：实测与优化

本机实测（2026-10-28，语音栈运行时）：

| 进程 | WorkingSet | Private commit |
| --- | --- | --- |
| livekit-server | 57 MB | 93 MB |
| Python Agent 的 job 子进程 | **411 MB** | 1324 MB |
| Python Agent worker | 4 MB | 1 MB |
| 联调 node 服务 | 50 MB | 62 MB |

**结论：LiveKit 不是内存大头（57MB）**。大头是 Python Agent 的 ONNX Runtime（模型 230MB + 推理 arena），
而且 Windows 上 AgentServer 默认 `job_executor_type=PROCESS` —— **每个会话一个子进程、各自加载一份模型**，
多开/多会话会成倍增长。其它来源：每只桌宠一个 Electron 窗口（30–60MB/只）、浏览器联调页（Chrome 标签 100–200MB）、
磁盘上还留着一份损坏的 Anaconda venv（约 460MB）。

优化措施与目标：

1. **语音栈按需启停**：只在「常开 / 一次语音」时启动 LiveKit + Agent，空闲 5 分钟自动停 → 纯文本待机目标 ≤150MB。
2. **强制线程执行器**：`job_executor_type=THREAD` + `num_idle_processes=0`，所有会话共用一份模型，避免每会话 400MB。
3. **单实例**：同时只允许 1 个语音会话；多宠物语音排队而非并行。
4. **线程收紧**：`num_threads=2`、`OMP_NUM_THREADS=2`，降低 CPU 与 ORT 工作集。
5. **空闲卸载**：停 Agent 进程（最彻底，arena 归还系统）；设置里可切「常驻」。
6. **桌宠窗口**：默认 1 只；多开共享素材；后续评估合并窗口。
7. **素材**：桌面端可下采样到 480×270/更低码率；视频 `preload="none"`，只保留当前+下一段。
8. **磁盘**：删除重复/损坏 venv；运行时只留一份；TTS 模型按需下载。

目标：待机（纯文本）≤150MB；语音会话中 ≤700MB；安装包不含重复运行时。

---

## 7. 修订后的阶段

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| P0 基座（0.5d） | clone 完整仓库、构建独立应用 | 无 DSH 可运行 |
| P1 设置中心（1.5d） | companion 配置 + secrets + 多标签 UI + 测试 | 配置生效、密钥不回显、隐私模式 |
| P2 进程编排（1d） | LiveKit/Agent supervisor；**线程执行器、按需启停、空闲卸载** | 一键启动、崩溃重启、内存达标 |
| P3 文本对话（1d） | provider 配置、流式、SQLite 记忆、迁移 | 重启上下文连续、用量面板 |
| P4 语音对话（1.5d） | 隐藏语音窗、常开、静音、打断、字幕、AEC | 右键开启可自由对话 |
| P5 音色（1d） | Edge 音色/试听 + sherpa-onnx MeloTTS 离线档（Kokoro 第二档按需下载） | 切换/试听即时生效 |
| P6 情感养成 v1（1.5d） | 关系状态、episodes/facts、反思、成长日志、**语音情绪**、情绪动画 | 状态可见可重置；事实能回忆；有反思记录 |
| P7 Node 试点（2–3d，可选） | agents-js + sherpa-onnx-node + Edge TTS | 三条门槛达标才切换 |
| P8 打包/扩展（1.5d） | electron-builder、首启向导、唤醒词、自动更新 | 纯净机可跑、安装包达标 |

**MVP 到 P6 约 8 天**；P7 视体积目标再定。

---

## 8. 验收清单（v1.1）

- [ ] 不装 DSH Desktop，双击即用；数据默认 `$DSH_HOME/dsh-pet`，可切到项目目录（`DSH_PET_HOME`）
- [ ] 设置中心可改 API URL/Key/模型/记忆目录；密钥不回显；有隐私模式
- [ ] 文本对话可用、流式、与语音共享记忆、可导出回忆录
- [ ] 语音对话默认关；右键「语音对话（常开）」开启后自由对话、可打断、可静音、断线重连
- [ ] 音色可切换/试听；MeloTTS 离线档可选用；VoiceStudio 不再依赖
- [ ] 情感养成：状态可见/可重置；回复风格随状态变化；跨重启记得重要事实；成长日志可回滚；语音情绪能更新状态
- [ ] 资源：待机（纯文本）≤150MB；语音会话 ≤700MB；语音关闭后无 Agent/LiveKit 常驻进程
- [ ] 现有桌宠配置与动画完全不受影响

---

## 9. 已确认（v1.2）

1. 数据目录：`<项目>/data/dsh-pet`，首次从 `~/.dsh/dsh-pet` 复制一份，之后互不影响。
2. 内存：接受待机 ≤150MB / 语音 ≤700MB；语音关闭后直接杀掉 Agent 与 LiveKit，冷启动 2–4s 可接受。
3. Node 试点：P6 之后（P7），先交付 P0–P6 的产品闭环。

> 下一步：P0 —— clone 完整仓库、构建独立应用、准备项目数据目录。

---

## 10. 进度

- **P0 完成（2026-10-28）**
  - 完整仓库 clone 到 `dsh-pet-repo/`（0.3.8，含 `src/app`、`tsdown.config.mjs`、`electron-builder.yml`）
  - `pnpm install` + `pnpm run bundle`：产出 `lib/app.js`（独立应用入口）
  - 首次启动渲染端报 `PetShared undefined`：补跑 `pnpm run build:desktop-core` 生成 `runtime/electron-helper/shared-core.js` 后正常
  - 数据目录：`data/dsh-pet`（从 `~/.dsh/dsh-pet` 复制 main-config.jsonc / memory.json）
  - 独立应用已运行：`/health` 返回 `dsh-pet-app 0.3.8`，桌宠窗口与动画正常（截图 `data/pet-p0.png`）
  - 临时用 `DSH_HOME=<项目>/data` 指向项目数据；P1 会替换为 `DSH_PET_HOME`，避免影响 Electron 缓存
- **P1 完成（2026-10-28）**
  - `DSH_PET_HOME` 数据根：首启从旧目录复制；`host/plugin/setup`、`app/main`、`standalone/cli`、AI 配置全部走同一入口
  - `companion.json`（非敏感）+ `companion-secrets.json`（ACL 仅当前用户）分离；公开视图只回 `hasKey`
  - 新设置中心 `/companion/`：模型（多服务商/测试连接）、语音、对话记忆目录、LiveKit、路径/桌宠
  - 保存时同步 legacy `standalone-ai.json`，文本对话立即生效（实测 `{"ok":true,"text":"有点困困的，但还不想睡～"}`）
  - 校验：`pnpm run typecheck` 通过；`pnpm test` 1510 passed；UI 用无头 Chrome 跑通测试连接（截图 `data/companion-settings.png`）
  - 右键「打开网站」现在打开设置中心（P4 会加独立的「设置中心…」菜单项）
- **P2 完成（2026-10-28）**
  - `VoiceSupervisor`：按需拉起 `livekit-server.exe` + `.venv` 里的 Python Agent；`/companion/runtime` 可查状态、启停、touch
  - 空闲 5 分钟自动回收；关闭语音后 LiveKit/Agent 进程确实退出（实测无残留）
  - Agent 改为 `job_executor_type=THREAD, num_idle_processes=0`；但 1.8.9 在 Windows 仍会派生一个 job 子进程（框架行为），因此内存优化主要靠「按需启停 + 空闲回收」
- **P3 部分完成（2026-10-28）**
  - 文本与语音共用 `$DSH_PET_HOME/memory.json`：Agent 启动时加载最近 N 轮、每轮写回；实测语音问候已写入同一文件，文本对话能读到
  - **未完成**：流式文本对话（SSE）、把 `chat.memoryDir` 真正接到 memory.json、记忆摘要/检索
  - **2026-10-28 补完**：`chat.memoryDir` 已接；文本回复改为**气泡式流式**（`generateChat.onDelta` 增量写 `say`，前端 1s 轮询看到逐步变长）；未做对话框逐 token 与用量面板
  - 修复：`memory.json` 窗口以 assistant 开头时独立 AI 校验拒绝请求（`GenerateOnce` 前裁掉开头孤立 assistant）
- **P4 核心完成（2026-10-28）**
  - 隐藏语音窗：`/companion/voice/` + 本地 livekit-client，取 token、发布麦克风、订阅 Agent 音频、断线重连
  - `/companion/voice/open|close|token`；`open` 后 LiveKit 房间实测 1 人 2 publisher（麦克风 + Agent）
  - 右键菜单新增「语音对话（常开）」「语音设置…」；preload/IPC 已接（菜单点击的真机回归待做）
  - 关闭语音后进程清理、状态回到 idle；`pnpm test` 1510 passed
  - **未完成**：桌宠听/想/说状态角标与字幕、push-to-talk、菜单点击端到端自动化
- **P3/P4 收尾修复（2026-10-28 晚）**
  - 修复设置页脚本换行转义导致的语法错误（表现为卡「正在读取」、标签点不动、无法保存）
  - 语音菜单 ✓ 改为**主进程真实状态**（IPC 广播 + preload 查询），不再靠点击本地猜测
  - `chat.memoryDir` 真正生效：文本与语音共用 `<目录>/memory.json`，首次自动迁移旧文件
  - LiveKit 页「停止语音服务」与空闲 5 分钟回收都会**同时关闭隐藏语音窗**
  - 新增 `scripts/app.cmd` 一键启动；新增 `docs/USAGE.md` 并写入 README 入口与“功能变更必须更新文档”约定
  - `pnpm typecheck` / `pnpm test`（1510 passed）通过
- **P5 音色（2026-10-28）**
  - 语音页：Edge 音色列表（16 个中文音色）+ 语速/音调/音量 + 试听文本 + 播放器
  - 本机试听接口 `/companion/voices`、`/companion/voice/preview`（Python 子进程合成 WAV）
  - **MeloTTS（sherpa-onnx + vits-melo-tts-zh_en，约 160MB）** 本地离线接入 Agent；Edge 断网时自动 fallback 到 MeloTTS（`tts.FallbackAdapter`）
  - 实测：Melo 试听 2 秒音频正常；Agent 切 Melo 后能识别并语音回复；Edge 当前 DNS 失败（网络原因），fallback 生效
  - 文档补充音色、模型目录、Edge/ Melo 故障排查
- **P5 音色增强（2026-10-28）**
  - 默认 TTS 切回 Edge `zh-CN-XiaoxiaoNeural`（MeloTTS 只做离线兜底，音色更平）
  - 新增 `agent/prosody.py` + `agent/tts_emotional.py`：按 emotion.json 的 mood 动态调 Edge rate/pitch 或 Melo speed（开心 +6%/+3Hz，低落 -8%/-3Hz，疲惫 -10%/-4Hz…）
  - 实测同一句：happy 1.92s / sad 2.21s；`pnpm test` 1514 passed
  - 删除 159MB 模型压缩包；移除未实现的 `custom` 引擎
  - 精简审查见 `docs/SIMPLIFICATION.md`
- **P6 情感养成 v1（2026-10-28）**
  - 关系状态：好感/信任/熟悉/精力 + 心情（开心/平静/害羞/低落/生气/疲惫），持久化 `conversations/emotion.json`
  - 记忆：episodes（≤120）、facts（自述抽取去重）、insights（每 6 段/12 轮规则反思）；不额外调用 LLM
  - 文本：system 注入关系与事实；每轮后启发式更新；心情变化自动播已有动画
  - 语音：Agent 启动读状态注入提示词，回合结束本地写回；与文本共用同一文件
  - 设置页新增「情感」标签：四维进度、心情、情节/事实/日志、启用开关、重置成长
  - 右键新增「情感 / 心情…」直达设置；主动关心只留开关，默认关
  - P4 尾巴：语音字幕（Agent 最终转写 → 宿主气泡）已接；听/想/说气泡状态；语音改为常开 + 空闲唤醒词（默认「小鱼」10 秒），移除 PTT；修复语音页请求插件路由时令牌被剥离
  - 测试套件改为 `--test-concurrency=4`，消除高并发下 body 超时导致的 408/413 偶发失败
  - `pnpm typecheck` / `pnpm test`（1519 passed）通过
- **8 项陪伴功能 v1（2026-10-28）**
  - 用量/费用：`usage.jsonl`（文本真实 token、语音按字符估算），陪伴页面板、每日上限/80% 提醒、每 1k token 估价
  - 主动关心：默认关；专注/安静时段/每日次数/最小间隔/锁全部硬闸门后才自动碎碎念
  - 专注模式：关闭主动；可同时立即关闭语音
  - 记忆衰减：情节权重/事实置信度按 30 天半衰期衰减并淘汰过低项
  - 回忆录：导出对话 + 关系 + 事实 + 情节 + 成长日志 Markdown
  - 气泡快捷回复：继续/换话题/记下来（桌面气泡）
  - 语音情绪：转写文本判断 `userMood`，情感页展示；v1 非声学模型
  - 提醒/日程：15 秒检查，到点气泡，`reminders.json` 持久化
  - 多宠物音色/人设：设置里选择语音代表宠物，覆盖 voice/persona；同一时间一只
  - `pnpm typecheck` / `pnpm test`（1519 passed）通过

---

## 11. 上游同步状态（2026-10-28）

- 本分支基于上游 `b78e3fc`（`feat(surface): any 放行 display:none`）。
- 上游 `origin/main` 已到 `e77a6f5`，**领先 18 个提交**，其中包含一套独立的语音合成实现：
  `dsh-pet/src/shared/voice.ts`、`dsh-pet/src/host/voice/voices.ts`、语音播报按钮、音色列表接口。
- 与本分支新写的 `src/app/companion/voices.ts` + `runtime/voice/` **功能重叠**。
- 同步（rebase / merge）时预计冲突的文件（13 个）：
  `README.md`、`dsh-pet/package.json`、`runtime/electron-helper/{main/ipc,sprite/bubble,sprite/input,sprite/menu}.js`、
  `src/app/main.ts`、`src/host/index.ts`、`src/host/open-target.test.ts`、`src/host/plugin/{chat-memory,setup}.ts`、
  `src/host/routes/{chat,types}.ts`。

**建议顺序**：先让本分支功能稳定并出包，再单独开一次「上游同步」专项：逐文件挑上游改动，
语音部分二选一（保留 companion 的进程编排，或改用上游的 shared/voice 抽象），不要两边各留一套。
