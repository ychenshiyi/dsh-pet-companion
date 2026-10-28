# dsh-pet 伴侣版 · 技术路线

> 版本：2026-10-28（基于当前工作区 `002dshlivekit`）
> 定位：独立运行的桌宠 + 文本/语音伴侣 + 情感记忆 + 可扩展的 QQ 桥接方案
> 配套文档：[USAGE.md](USAGE.md)（使用）、[SIMPLIFICATION.md](SIMPLIFICATION.md)（精简审查）、[PLAN-companion-voice.md](../../../PLAN-companion-voice.md)（阶段计划）

---

## 1. 目标与非目标

### 目标

- 不依赖 DSH Desktop 也能双击运行（Electron 独立应用）
- 保留原 dsh-pet 的全部桌宠体验：透明窗、动画、拖拽、多宠物、右键菜单
- 文本对话与语音对话共用同一只宠物的记忆/情感/人设
- 语音可离线兜底（MeloTTS）也可在线（Edge TTS）
- 设置统一在一个独立窗口，不跳浏览器
- 可逐渐接入外部渠道（QQ），但不把 QQ 账号/第三方运行时塞进主进程

### 非目标（当前阶段）

- 不代登录/扫码 QQ，不内置 SnowLuma 等第三方运行时
- 不做多用户/远程服务；本机回环 + 令牌
- 不做付费加速、成瘾机制、情绪操纵
- 不把桌宠动画素材替换成通用 UI；原 106 个 webm 保留

---

## 2. 技术栈与版本（实测）

| 层        | 选型                                | 版本/说明                                 |
| --------- | ----------------------------------- | ----------------------------------------- |
| 桌面壳    | Electron                            | 由 `~/.dsh/electron/electron.exe` 启动    |
| 主语言    | TypeScript                          | Node 24.12（当前开发机）                  |
| 构建      | tsdown                              | `pnpm run bundle` 产出 `lib/*.js`         |
| 桌宠原体  | dsh-pet 0.3.8                       | 透明窗 + 106 个 webm 动画 + 物理/拖拽     |
| 本地 HTTP | Node `http`                         | 随机端口 + `X-DSH-Pet-Token`              |
| 语音服务  | LiveKit Server                      | 1.13.11（Windows amd64）                  |
| 语音框架  | LiveKit Agents                      | Python 1.8.9                              |
| Python    | 3.12.14                             | `.venv`（DSH standalone Python）          |
| STT       | SenseVoice int8                     | sherpa-onnx 2.0.1，模型约 239MB           |
| 离线 TTS  | MeloTTS zh_en                       | sherpa-onnx VITS，模型约 170MB            |
| 在线 TTS  | Edge TTS                            | `zh-CN-XiaoxiaoNeural`，失败回退 Melo     |
| LLM       | DeepSeek / OpenAI 兼容 / Anthropic  | `ctx.llm` 统一抽象；默认 `deepseek-flash` |
| 记忆/情感 | JSON 文件                           | 无数据库，原子替换、单写者                |
| 测试      | Node test + Playwright（人工/脚本） | `pnpm test` 1519 passed                   |

---

## 3. 总体架构

```
┌────────────────────────────────────────────────────────────────────┐
│ Electron 主进程（src/app/main.ts）                                  │
│  ├─ 本机 HTTP（随机端口 + 令牌）                                     │
│  │   ├─ /companion/*   设置中心（独立 BrowserWindow）                │
│  │   ├─ /dsh-pet-7340/* 插件宿主路由（chat/state/anim/emotion/...） │
│  │   └─ /companion/voice/* 隐藏语音页/token/预览/PTT（已移除）       │
│  ├─ DSH 插件 apply(ctx)（in-process 伪 ctx）                         │
│  │   └─ 配置/路由/桌面 Helper/轮询/命令                              │
│  ├─ VoiceSupervisor：按需拉起 livekit-server + Python Agent          │
│  ├─ 隐藏语音窗（WebRTC/麦克风/AEC/字幕）                             │
│  └─ 桌宠透明窗（原 helper 进程）                                     │
├────────────────────────────────────────────────────────────────────┤
│ Python Agent（voice/agent）                                      │
│  ├─ SenseVoice STT → WakeGate → DeepSeek LLM → Edge/Melo TTS        │
│  ├─ emotion.apply（关系/情绪/事实）                                  │
│  └─ usage.record（语音用量估算）                                    │
└────────────────────────────────────────────────────────────────────┘
```

### 进程/职责

| 进程                           | 职责                                            | 生命周期                    |
| ------------------------------ | ----------------------------------------------- | --------------------------- |
| Electron 主进程                | 本机 HTTP、设置窗、语音窗、插件宿主、supervisor | 应用运行期                  |
| 桌面 Helper（Electron 子进程） | 透明桌宠窗、动画、拖拽、右键菜单                | 随主进程；可重载            |
| livekit-server                 | WebRTC 房间/音频转发                            | 语音开启时；空闲 5 分钟回收 |
| Python Agent                   | STT/LLM/TTS/唤醒/情感                           | 语音开启时；语音关闭立即杀  |
| 设置窗口                       | 统一设置 UI                                     | 用户打开时；独立窗口        |
| QQ 桥接（规划）                | OneBot WS ↔ 本机 HTTP                           | 设置开启时；独立进程        |

### 目录

```
dsh-pet-repo/dsh-pet/
├─ src/app/              Electron 主进程、路由、companion 设置
├─ src/host/             DSH 插件宿主：配置/路由/桌面 helper/循环
│  └─ plugin/            chat-memory、emotion、usage、policy、reminders
├─ src/client/           浏览器端桌宠组件
├─ src/shared/           菜单/聊天/类型/编解码
├─ runtime/electron-helper/  桌宠渲染与窗口
├─ runtime/voice/        隐藏语音页、livekit-client
├─ voice/agent/        Python Agent（SenseVoice/Edge/Melo/情感）
├─ voice/models/       STT/TTS 模型（可选按需下载）
├─ data/dsh-pet/         本机数据（DSH_PET_HOME）
└─ docs/                 使用/技术/精简文档
```

---

## 4. 数据模型

`DSH_PET_HOME`（默认项目 `data/dsh-pet`，首次从 `~/.dsh/dsh-pet` 复制）：

```
main-config.jsonc        原桌宠配置（pets/动画/物理）
companion.json           伴侣设置（不含密钥）
companion-secrets.json   API Key / LiveKit secret（ACL 当前用户）
memory.json              迁移前旧记忆（保留）
conversations/memory.json  文本+语音共用对话
conversations/emotion.json 关系/心情/事实/情节/成长日志
conversations/usage.jsonl  文本/语音用量
conversations/reminders.json 提醒
livekit.yaml / livekit-keys.json 运行时生成
logs.txt / app.out.log   日志
```

### memory.json

```jsonc
{
  "main": {
    "main": {
      "messages": [
        { "role": "user", "content": "...", "ts": 1700000000000 },
        { "role": "assistant", "content": "...", "ts": 1700000000000 },
      ],
    },
  },
}
```

### emotion.json

```jsonc
{
  "main": {
    "main": {
      "affection": 22,
      "trust": 16,
      "familiarity": 11,
      "energy": 79,
      "mood": "happy",
      "userMood": "happy",
      "turns": 1,
      "episodes": [{ "ts": 0, "summary": "...", "emotion": "happy", "weight": 2 }],
      "facts": [{ "ts": 0, "text": "喜欢猫", "confidence": 0.7 }],
      "insights": ["..."],
      "updatedAt": 0,
    },
  },
}
```

### 写入策略

- 单文件写：临时文件 + `rename` 原子替换
- 单写者优先：host 是 memory 的唯一写者；语音侧 emotion 直写（极小概率竞争，下一轮补）
- 文本/语音共用同一份；语音启动读最近 N 轮
- 记忆窗口按轮截断；开头孤立的 assistant 会被裁掉（独立 AI 适配器要求首条 user）

---

## 5. 关键流程

### 5.1 启动

1. Electron 主进程读取 `DSH_PET_HOME`；无数据则从 `~/.dsh/dsh-pet` 复制
2. 创建 `companion.json`/secrets；生成/读取本机访问令牌
3. 启动本机 HTTP（随机端口；动态发现，不硬编码）
4. 以伪 ctx 调用 dsh-pet 的 `apply()`：注册路由、桌面 Helper、轮询
5. 桌面 Helper 按配置建透明桌宠窗
6. 设置入口 = 独立 BrowserWindow，URL 带 `#token=`

### 5.2 文本对话

```
用户输入 → POST /dsh-pet-7340/chat?pet=&surface=
  → 读 memory 最近 N 轮 + 人设 + 情感提示
  → ctx.llm.stream（DeepSeek/OpenAI 兼容/Anthropic）
  → 增量写 say（气泡式流式，1s 轮询）
  → 真实 token 记 usage；写 memory；更新 emotion；返回
```

### 5.3 语音对话

```
右键「语音对话（常开）」→ app 开隐藏语音窗 + supervisor
  → livekit-server 启动 → Python Agent 注册
  → 语音窗 token 加入房间、发布麦克风、订阅 Agent 音频
  → SenseVoice 识别 → WakeGate 过滤 → LLM → Edge/Melo TTS
  → 字幕写 say；emotion/usage 写文件
关闭 → 语音窗关闭 → supervisor 杀 Agent/LiveKit
```

### 5.4 唤醒词

- 默认开启时 `awake=true`，可直接说话
- 超过 `wakeIdleSeconds`（默认 10）无对话 → `awake=false`
- `WakeGate.filter()` 只放行含唤醒词（默认「小鱼」）的转写，其余返回空串
- 空转写不会触发 Agent 回合；唤醒后重置计时

### 5.5 情感 / 语音情绪

- 每轮文本：启发式情感（正/负词、关系数值、事实抽取、情节、规则反思）
- 语音：SenseVoice 返回 `<|HAPPY|>` 等 emotion 标签 → `userMood`；无标签回退文本
- TTS 韵律：`emotion.json` 的 `mood` → Edge rate/pitch 或 Melo speed
- 情绪动画：心情变化时写 `anim` 叶子，播放已有动画

### 5.6 主动 / 专注 / 提醒 / 用量

- 主动关心：默认关；专注、安静时段、每日次数、最小间隔、锁全通过才自动碎碎念
- 专注：关闭主动；可立即停语音
- 提醒：15s 检查，到点写 `say` 气泡
- 用量：文本真实 token、语音估算；配额到阈值附加到回复；费用按每 1k token 估价

### 5.7 显示位置

- 设置「显示」页 → `POST /dsh-pet-7340/pet-display` `{id, display}`
- 写入 main-config 用户层，宿主重启 Helper 重建窗口
- 右键「显示位置」已移除

---

## 6. 关键设计决策

| 决策             | 选择                              | 理由                                             |
| ---------------- | --------------------------------- | ------------------------------------------------ |
| 独立 vs DSH 插件 | 独立 Electron + in-process 伪 ctx | 不装 DSH 也能用；保留插件路由/helper             |
| 语音框架         | LiveKit + Python Agent            | AEC/重连/打断/设备切换；Python 生态 STT/TTS 成熟 |
| Agent 语言       | 先 Python，后评估 Node            | Python 模型生态；P7 试点 agents-js               |
| TTS              | Edge 默认，Melo 兜底              | Edge 音色好；Melo 离线可用的保底                 |
| 记忆             | JSON 文件，不上数据库             | 单机、小数据、易备份；避免 SQLite 迁移成本       |
| 唤醒             | STT 后过滤                        | 不引入额外唤醒模型；10 秒空闲后要求唤醒词        |
| 情感             | 状态 + 启发式，不额外调 LLM       | 零 token、可解释、可重置                         |
| 设置             | 独立 BrowserWindow                | 不跳 Edge；统一标签页                            |
| 安全             | 回环 + 随机端口 + 令牌 + ACL      | 本机多进程/多端共享，不暴露内网                  |

---

## 7. 安全与隐私

- HTTP 只绑定 `127.0.0.1`；令牌 `X-DSH-Pet-Token`，URL hash 传递，不写日志
- 设置页/语音页请求由桌面 auth 拦截器附加令牌；不是任意网页都能调
- `companion-secrets.json` / `livekit-keys.json` 用 Windows ACL 仅当前用户
- 密钥不回显；公开设置只有 `hasKey`
- 语音原始音频不落盘；只留转写/记忆
- 情感/记忆可整体关闭、重置、导出；不用于付费引导
- 发布前必须移除 `DSH_PET_TOKEN_OVERRIDE` 调试令牌

---

## 8. 阶段路线（实际状态）

| 阶段 | 内容                                                | 状态                          |
| ---- | --------------------------------------------------- | ----------------------------- |
| P0   | clone 完整仓库、构建独立应用、项目数据目录          | 完成                          |
| P1   | `DSH_PET_HOME`、设置中心、多服务商、密钥分离        | 完成                          |
| P2   | LiveKit/Agent supervisor、按需启停、空闲回收        | 完成（Agent 仍有 job 子进程） |
| P3   | 文本对话、记忆目录迁移、气泡式流式                  | 完成（非 SSE 对话框）         |
| P4   | 隐藏语音窗、字幕、听/想/说、唤醒词、无 PTT          | 完成                          |
| P5   | Edge 音色/试听、MeloTTS、情感韵律                   | 完成                          |
| P6   | 情感养成 v1、episodes/facts/反思/动画               | 完成                          |
| P6.5 | 用量/主动/专注/提醒/回忆录/气泡按钮/语音情绪/多宠物 | 完成 v1                       |
| P7   | Node Agent（agents-js）试点                         | 未开始                        |
| P8   | 打包、模型按需下载、首启向导、自动更新              | 未开始                        |

---

## 9. 构建、运行、测试

```bat
cd dsh-pet-repo\dsh-pet
pnpm install
pnpm run bundle
pnpm run build:desktop-core
pnpm run typecheck
pnpm test
scripts\app.cmd
```

- `DSH_PET_HOME` 默认 `<项目>/data/dsh-pet`
- LiveKit/Python/Agent 路径由 `scripts/app.ps1` 推导
- 测试：Node test 1519 passed / 1 skipped；Playwright 用于设置页/语音页人工验收
- 语音端到端：隐藏窗 `{status:"connected",mic:true}`、LiveKit 1 人 2 publisher、字幕气泡

---

## 10. 已知限制

- 未打包：依赖开发目录/环境变量；P8 处理
- Agent 在 Windows 仍派生 job 子进程（框架行为），靠空闲回收
- MeloTTS 只有 speed，情感表达弱；Edge 依赖网络
- 语音用量为字符估算；语音情绪标签准确率有限
- 多宠物语音同一时间只代表一只
- 气泡快捷回复目前仅桌面端
- 主动关心默认关；配额只提醒不硬停
- 旧 `/standalone-ai` 兼容路由仍存在但无入口
- 日志偶有重复行（logger 叠加）
- QQ 尚未实装（方案见下）

---

## 11. QQ 接入方案（参考 SurfCore）

### 11.1 结论

**可以接入，且不需要改 Electron 主链路。** 推荐把 QQ 做成**独立的桥接进程**，通过 OneBot v11（SnowLuma2）收发，调用 dsh-pet 的本机 HTTP 完成对话/记忆/情感。

本机当前 SnowLuma 网关实测 **不可达**（`reachable:false`），所以此节是方案，不是已实装/已验证。

### 11.2 参考 SurfCore 的架构

SurfCore 的 QQ 侧是两段式：

- DSH 宿主里的 `surfcore` 插件（设置/记忆/桌宠 API）
- 独立的 `src/bridge.js`（OneBot v11 WS ↔ DSH Web API，控制台 :3100，单实例锁）
- SnowLuma2 是**第三方、不随包分发、不代登录**；bridge 只探测/连接
- 消息经会话映射进入 DSH agent，回复/工具审批再发回 QQ

我们不复用它的 DSH 耦合，只复用“**桥接进程 + OneBot + 白名单/闸门**”这个形态。

参考：[SurfCore ARCHITECTURE](https://github.com/Mieksido/surfcore/blob/main/docs/guides/ARCHITECTURE.md)、[README](https://github.com/Mieksido/surfcore)。

### 11.3 推荐拓扑

```
SnowLuma2（用户自己装/登录）
   │ OneBot v11 WS
   ▼
qq-bridge（独立 Node 进程，单实例）
   ├─ 白名单 / 频率限制 / 专注 / 配额 / 日志脱敏
   ├─ 会话映射：QQ 私聊/群 → petId（默认 main）
   └─ HTTP POST 127.0.0.1:<appPort>/dsh-pet-7340/chat?pet=main&surface=any
          X-DSH-Pet-Token: <token>
   ▼
dsh-pet 主进程（共享 memory/emotion/usage）
```

不让 bridge 直接读 `memory.json`：所有对话走宿主 `/chat`，保证记忆/情感/配额只有一套。

### 11.4 配置与安全

QQ 设置页（独立窗口新增「QQ」标签）：

- 启用开关
- OneBot WS URL / access token（只存 secrets，ACL）
- 允许的 QQ 号 / 群号（默认空 = 全部拒绝）
- 回复模式：仅私聊 / 仅 @ / 私聊+@
- 安静时段、每日条数、最小间隔
- 语音回复：默认关（先文字）
- 一键停用/杀开关

安全：

- bridge 只连回环；不监听公网
- 不自动加好友/不进群/不代扫码
- 不记录消息正文到日志（只记长度/结果）
- 群聊默认只响应 @/命令，不自主插话
- token 通过 spawn env 传给 bridge，不落盘
- 任何异常默认“不回复”，不伪造成功

### 11.5 MVP 实施步骤

1. app 增加 `QQConfig`（companion）与 secrets；设置「QQ」标签
2. 新增 `qq-bridge`（Node，OneBot v11 WS 客户端；可用 `ws`/`@snowluma/sdk`）
3. app supervisor 按开关 spawn/kill bridge；写 env：app URL/token、白名单、模式
4. bridge 收消息 → 过滤 → `POST /chat?surface=any` → 发回 QQ
5. 用**本地假 OneBot WS** 做集成测试（不需要真 QQ）；再接 SnowLuma 实测
6. 第二阶段：群 @、引用、图片/表情、语音回复
7. 第三阶段：多账号/多宠物映射、B站（另立项目，不塞进桌宠）

### 11.6 风险

- SnowLuma 是第三方专有运行时，协议/版本会变；不能打包/代登录
- QQ 账号风控/封号风险；必须用户自担、默认白名单
- 群聊语境与隐私：默认不自主发言
- 语音回复需要额外 TTS 端点（当前 TTS 在 Python/LiveKit 内，未暴露 HTTP）
- 本机 SnowLuma 当前不可达，接入前先解决运行环境

### 11.7 验收

- 假 OneBot：私聊一条 → 桌宠记忆新增 → 回复发回
- 非白名单：不回复、只记审计
- 专注/配额：到限不回复
- 群聊：未 @ 不回复
- 杀开关：bridge 退出、无残留进程

---

## 12. 后续路线

1. P8 打包：模型按需下载、首启向导、去掉调试令牌
2. QQ MVP：私聊 + 白名单 + 文字（桥接进程）
3. 声学情绪升级、语义记忆检索、额度硬停
4. 多宠物同时语音（每只房间/Agent）
5. Node Agent 试点（agents-js）
6. B站/QQ 群主动行为另立项目，避免把桌宠主进程做成平台机器人
