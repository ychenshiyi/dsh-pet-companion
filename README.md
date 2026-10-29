# dsh-pet 伴侣版 🐾

<p align="center">
  <img alt="license" src="https://img.shields.io/badge/license-MIT-orange">
  <img alt="platform" src="https://img.shields.io/badge/platform-Windows%20x64-0078D6">
  <img alt="node" src="https://img.shields.io/badge/node-24-339933">
  <img alt="python" src="https://img.shields.io/badge/python-3.12-3776AB">
</p>

一只住在你桌面上的宠物：一百余个透明动画随时无缝衔接（待机呼吸、打瞌睡、玩魔方、吃火锅……），可点击、拖拽、甩抛、多开、跟随工作状态切换动画，还能**说话**——本地语音识别 + 大模型对话 + 语音合成，配上好感度记忆。

它有两种用法，**先确认你要哪种**，再看对应章节，别混着装。

> **分支说明**：本仓库基于 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)（MIT），
> 在其上加了「伴侣模式」：独立桌面应用、语音对话、情感养成、上下文压缩。
> 上游的素材链与插件能力（动画生成、pet pack、余额、碎碎念）**原样保留**。

---

## 两种用法

| | **方式 A：完整伴侣应用**（推荐） | **方式 B：只当 DSH 插件** |
| --- | --- | --- |
| 你能得到 | 桌宠 + 语音对话 + 情感养成 + 全部陪伴功能 | 桌宠动画 + 碎碎念/对话/余额（在 DSH 界面里） |
| 需要什么 | Windows + Node 24 + Python 3.12，**不用装 DSH** | 已装 DSH（桌面版或 `dsh web`） |
| 磁盘占用 | 约 1.3 GB（含语音模型） | 约 100 MB |
| 怎么装 | 往下看「方式 A」，六步 | 跳到 [方式 B](#方式-b只当-dsh-插件) |
| 适合谁 | 想要"会说话的电子宠物" | 只想在 DSH 里多只桌宠 |

**两种方式共用同一份代码**，只是启动方式不同；数据目录也共用（默认 `%USERPROFILE%\.dsh\dsh-pet`）。

## 目录

- [方式 A：完整伴侣应用](#方式-a完整伴侣应用推荐)
- [日常怎么用](#日常怎么用)
- [语音对话](#语音对话)
- [记忆、上下文压缩与归档](#记忆上下文压缩与归档)
- [情感养成与陪伴功能](#情感养成与陪伴功能)
- [数据、备份与隐私](#数据备份与隐私)
- [常见问题](#常见问题)
- [卸载](#卸载)
- [方式 B：只当 DSH 插件](#方式-b只当-dsh-插件)

---

## 方式 A：完整伴侣应用（推荐）

### 环境要求

| 项 | 要求 | 怎么确认 |
| --- | --- | --- |
| 系统 | Windows 10/11 x64（当前只在 Windows 上验证过） | — |
| Node.js | **24.x** | `node -v` |
| pnpm | **12.x** | `pnpm -v`（没有就 `npm i -g pnpm`） |
| PowerShell | **7.x**（脚本用了 `#requires -Version 7.0`） | `pwsh -v` |
| Python | **3.12**（只有语音需要） | `py -3.12 -V` |
| 磁盘 | 约 1.3 GB（模型 400 MB + venv 470 MB + 依赖 250 MB + 二进制 55 MB） | — |
| 网络 | 首次需能访问 `github.com`、`huggingface.co` | — |
| 麦克风 | 语音需要；没有也能用文字 | — |

> Python 必须是**独立 3.12**，不能用 Anaconda 3.11——`livekit-local-inference` 的原生扩展会崩（`0xC0000005`）。

### 第 1 步：拉代码

```bat
git clone https://github.com/ychenshiyi/dsh-pet-companion.git
cd dsh-pet-companion
```

### 第 2 步：构建桌宠主体（必须做一次）

```bat
cd dsh-pet
pnpm install
pnpm run bundle
pnpm run ensure:electron
cd ..
```

- `pnpm install`：装依赖（约 250 MB）
- `pnpm run bundle`：产出 `lib/app.js`——**应用入口，不入库，必须自己编**
- `pnpm run ensure:electron`：把 Electron 下载到 `~/.dsh/electron/`（首次约 100 MB）

三个都成功再往下走。`pnpm run bundle` 报错通常是 Node 版本不对，先 `node -v` 核对。

### 第 3 步：装语音栈（可选，不做就只有文字对话）

```bat
pwsh -File voice\scripts\bootstrap.ps1
```

它会做四件事，全部带 SHA256 校验、可重复执行：

1. 下载 LiveKit 服务端（55 MB）→ `voice/livekit_*_windows_amd64/`
2. 下载 SenseVoice 语音识别模型（239 MB）+ MeloTTS 语音合成模型（167 MB）→ `voice/models/`
3. 用 Python 3.12 建 venv 并装依赖（约 470 MB，3–6 分钟）
4. 生成 `voice/livekit.yaml`（含随机密钥，已被 gitignore）

常用参数：

| 场景 | 加什么 |
| --- | --- |
| 只用 Edge 在线音色，不要离线 TTS | `-SkipModels` |
| 国内访问 huggingface 很慢 | `-Mirror`（改走 hf-mirror.com） |
| 重装一遍 | `-Force` |
| 不想装 LiveKit（已有自己的服务） | `-SkipLiveKit` |

> 只想要文字对话：跳过这一步，第 4 步照常能启动。

### 第 4 步：启动

```bat
dsh-pet\scripts\app.cmd
```

首次启动会自动创建数据目录 `%USERPROFILE%\.dsh\dsh-pet`，并从旧的 DSH 数据目录复制一份配置（如果有）。
想换数据位置就设环境变量 `DSH_PET_HOME` 再启动，或在设置里「路径 / 关于」页切换。

### 第 5 步：填 API Key（不做就没法对话）

右键宠物 → **打开设置** → **模型** 标签：

1. 选「DeepSeek（默认）」
2. `API Key` 填你的 key
3. 点 **测试连接**，应显示「连接成功」
4. 点右下角 **保存设置**

Key 只写进本机 `companion-secrets.json`（ACL 仅当前用户），**不回显、不进仓库、不传给第三方**。

### 第 6 步：开语音

1. 右键 → **打开设置** → **语音** 标签 → 选音色（如 `zh-CN-XiaoxiaoNeural`）→ 保存
2. 右键 → **语音对话（常开）**，菜单右侧出现 `✓` 表示已开
3. 对着麦克风说 **「小鱼」**（唤醒词，可在语音页改），再说你要说的话

首次开语音会拉起 LiveKit + Python Agent，冷启动约 2–4 秒；空闲 5 分钟会自动回收，下次说话会再拉起。

---

## 日常怎么用

### 右键菜单

| 菜单项 | 作用 |
| --- | --- |
| **打开设置** | 打开设置中心（所有配置都在这里） |
| **对话** `T` | 文字聊天；鼠标悬停在宠物上按 `T` 也行 |
| **碎碎念** | 立刻让它说一句（不受自动周期开关影响） |
| **语音对话（常开）** | 开/关语音；`✓` = 已开 |
| **显示语音对话框** | 宠物右侧展开实时字幕气泡（你说的话 + 它的回复）；`✓` = 已开 |
| **情感 / 心情…** | 直接跳到设置的情感页 |
| **查看余额** | 手动查一次当前服务商余额 |
| **回到初始位置** | 把宠物挪回配置的角落 |
| **重载配置** | 改完 `main-config.jsonc` 后重新读 |

### 设置中心（九个标签）

| 标签 | 能改什么 |
| --- | --- |
| **模型** | 多服务商（DeepSeek/OpenAI 兼容）、Base URL、模型名、API Key、温度、测试连接 |
| **语音** | 引擎（Edge 在线 / MeloTTS 离线）、音色、语速、音调、音量、识别语言、唤醒词、空闲秒数、低延迟模式、试听 |
| **对话** | 记忆目录、携带轮数、token 预算、压缩触发比例、保留轮数、压缩提醒间隔、全文归档上限、BM25 检索条数、压缩统计与「立即压缩」 |
| **情感** | 好感/信任/熟悉/精力、当前心情、情节与事实、成长日志、启用开关、重置成长 |
| **陪伴** | 用量与费用面板、每日上限、主动关心（默认关）、专注模式、提醒日程、回忆录导出 |
| **宠物** | 每只宠物的名称、大小、位置、显示位置、语音与人设覆盖 |
| **显示** | 桌宠显示方式（web/desktop/both/none）、字体、物理参数 |
| **LiveKit** | 内置/外部服务、端口、房间名、启动与停止语音服务 |
| **路径 / 关于** | 数据目录（可切换）、打开文件夹、版本信息 |

### 隐私相关的三个开关

- **专注模式**（陪伴页）：关掉主动关心；可同时立即关闭语音
- **情感养成**（情感页）：整体关闭后不再记录关系状态
- **语音情绪**：只从转写文本判断情绪，不分析声纹、不保存音频

---

## 语音对话

| 行为 | 说明 |
| --- | --- |
| 唤醒 | 空闲超过 `唤醒空闲秒数`（默认 10 秒）后，要说唤醒词「小鱼」才进入对话 |
| 打断 | 它说话时直接开口即可打断（本地 VAD 判定，不等云端超时） |
| 字幕 | 右键「显示语音对话框」在宠物右侧展开，实时显示双方文本 |
| 低延迟模式 | 默认开：更积极的 VAD/断句、回复上限 80 tokens、启动预热识别模型；说长句容易被截断，可在语音页关掉 |
| 关闭 | 右键「语音对话（常开）」取消 `✓`；LiveKit 与 Python 进程随后退出 |

**两种音色引擎**：

- **Edge（默认）**：微软在线音色，自然、零占用，但需要联网
- **MeloTTS（离线）**：本机合成，断网可用，音色平一些；Edge 失败时会自动回退到它

---

## 记忆、上下文压缩与归档

文字与语音**共用同一份记忆**，不会聊两套。

- `conversations/memory.json`：最近对话全文 + 上下文摘要，文本宿主是唯一写者（语音通过本机 HTTP 读写，避免两边抢文件）
- 每次拼上下文按 token 预算来：默认预算 `6000`、达到 `75%` 触发压缩、最近 `6` 轮（1 轮 = 1 问 1 答）始终保留原文
- 旧对话被压成滚动摘要（`context.summary`）；压缩失败会退回抽取式摘要，**不中断对话**
- 原文不会因为压缩被删除：超过 `archiveMaxMessages`（默认 2000 条）的部分移到 `conversations/archive/`，只追加、可导出
- 还会用本地 BM25 从旧消息里捞相关片段（`retrievalTopK`，默认 3；设 0 关闭）
- 不同宠物各自分桶，上下文互不串

这些都能在**设置 → 对话**里调，也能看到压缩次数与「立即压缩」。

---

## 情感养成与陪伴功能

**四个数值**：好感、信任、熟悉、精力（各 0–100）+ 当前心情（开心/平静/害羞/低落/生气/疲惫）。

- 每轮对话根据你的话做启发式更新（夸奖加好感、吐槽减信任……），数值有夹紧，不会一夜满好感
- 数值影响：称呼与措辞、动画选择、语音韵律（开心快一点、低落慢一点）
- **完全本地**：状态存在 `conversations/emotion.json`，可见、可关、可一键重置

**陪伴功能**（都在设置 → 陪伴）：

| 功能 | 说明 |
| --- | --- |
| 用量与费用 | 文本真实 token、语音按字符估算；可设每日上限与提醒 |
| 主动关心 | **默认关**；开了也要过专注模式/安静时段/每日次数/最小间隔四道闸门 |
| 专注模式 | 一键静音主动消息，可同时关语音 |
| 提醒 / 日程 | 到点弹气泡，存 `conversations/reminders.json` |
| 回忆录 | 导出对话 + 关系 + 事实 + 情节 + 成长日志为 Markdown |
| 气泡快捷回复 | 桌面气泡上「继续 / 换话题 / 记下来」 |

---

## 数据、备份与隐私

全部数据都在 **`%USERPROFILE%\.dsh\dsh-pet`**（可用 `DSH_PET_HOME` 改）：

| 文件 / 目录 | 内容 | 敏感 |
| --- | --- | --- |
| `main-config.jsonc` | 桌宠配置（大小、位置、动画池…） | 否 |
| `companion.json` | 伴侣配置（模型/语音/情感开关） | 否 |
| `companion-secrets.json` | **API Key**（ACL 仅当前用户） | **是** |
| `conversations/memory.json` | 文本+语音共用对话与摘要 | **是** |
| `conversations/emotion.json` | 好感/信任/心情/情节/事实 | **是** |
| `conversations/archive/` | 超限的旧原话（JSONL） | **是** |
| `conversations/voice-transcript.jsonl` | 语音对话文本记录 | **是** |
| `conversations/usage.jsonl` | 用量与费用 | 否 |
| `conversations/reminders.json` | 提醒/日程 | 否 |
| `livekit-keys.json`、`livekit.yaml` | 本机 LiveKit 密钥（自动生成） | **是** |
| `logs.txt` | 运行日志（含对话片段） | **是** |

- **备份 / 迁移**：整个目录拷走即可；换机器后设 `DSH_PET_HOME` 指过去。
- **重置对话但留配置**：删 `conversations/` 目录。
- **完全重置**：删整个 `dsh-pet` 目录，下次启动重新生成。
- **截图/分享前注意**：情感页与对话页会显示真实对话，别直接截屏发出去。
- **语音音频不落盘**，只留转写文本；不采集声纹。

---

## 常见问题

| 现象 | 处理 |
| --- | --- |
| 双击 `app.cmd` 闪退 | 先手动跑 `node scripts/start-app.mjs` 看报错；多半是没执行 `pnpm run bundle` 或没装 Electron |
| 右键没有「语音对话」 | 菜单里没有该项说明宿主没拿到语音模块；确认 `dsh-pet\scripts\app.cmd` 启动的是**本仓库**版本 |
| 开语音后一直「启动中」 | 看 `%USERPROFILE%\.dsh\dsh-pet\logs.txt`；常见原因：Python 3.12 没装、`bootstrap.ps1` 没跑完、7880 端口被占 |
| 叫「小鱼」没反应 | 麦克风权限（Windows 设置 → 隐私 → 麦克风 → 允许桌面应用）；或唤醒词改过；或已在对话中没有触发唤醒 |
| 有字幕但没声音 | Edge TTS 需要联网；断网时在语音页把引擎切成 **MeloTTS** |
| 对话报 401 / 404 | Key 无效或模型名不对；当前默认 `deepseek-flash`，可选 `deepseek-v4-pro` |
| 内存占用高 | 语音关闭后 LiveKit/Agent 会退出；空闲 5 分钟也会自动回收。仍高就看是不是开了多只宠物或多会话 |
| 设置页打不开/白屏 | 端口被占；关掉占用进程或改 LiveKit 端口后重启应用 |
| 中文乱码 | 终端字体问题，不影响运行；日志文件是 UTF-8 |

---

## 卸载

```bat
:: 1. 先退出应用（托盘图标 → 退出）
:: 2. 删代码
rmdir /s /q dsh-pet-companion

:: 3. 删数据（配置、对话、密钥都在这里）
rmdir /s /q "%USERPROFILE%\.dsh\dsh-pet"
```

`~/.dsh/electron/` 是多个 DSH 组件共用的运行时缓存，**不用删**。

---

## 方式 B：只当 DSH 插件

如果你只是想在 DSH 里多一只桌宠，不需要语音和情感养成，用这个方式，**不用装 Python、不用下模型**。

装法取决于你在用哪个 DSH：

### 🪟 桌面应用（Electron 版）

直接在应用内「插件管理」页的安装框里填 `dsh-pet`，不用开终端；需要在终端里操作插件时，用桌面应用自带的那份 CLI。

### 🌐 `dsh web`

> 以下命令都在你的**命令行终端**（PowerShell / CMD 等）中运行。前提是 DSH 环境已就绪：

```sh
# ① 前置要求：确认 Node.js 已安装
node -v

# ② 安装 DSH 启动器与 pnpm（已装可跳过；装完请重新打开终端）
npm install -g @deepseek-ai/dsh pnpm
dsh --version   # 验证 dsh 命令可用

# ③ 安装本插件（web 模式用 --profile web）
dsh plugin --profile web add dsh-pet
```

装完**重开桌面应用**（`dsh web` 用户则重启 `dsh web`）才生效——运行中的进程持有内存里的旧插件。宠物出现在界面右上角（默认配置角落，可在设置页修改）。

> **兼容性**：本插件当前在 dsh **`0.2.1-rc.2`** 下开发并测试（`dsh --version` 可查看你的版本）。建议使用相同版本；其他版本如遇问题欢迎反馈。

### 从源码安装（clone 本仓库后）

`lib/` 构建产物不入库，clone 后需要先构建再安装：

```sh
# ① clone 本仓库，进入插件目录
git clone https://github.com/PC2005-cloud/dsh-pet.git
cd dsh-pet/dsh-pet

# ② 安装依赖
npm install

# ③ 构建（完整 lib：tsdown → lib + 桌面共享核心 + 类型声明）
npm run build       # 必须手动跑一次（克隆后 npm install 不再自动构建）

# ④ 安装到 DSH（file: 指向**插件目录**——上面 cd 进去的那一层，用构建好的 lib）
#    --profile 填实际在用的那个：dsh web → web；
#    桌面应用（Electron 版）改用应用内「插件管理」安装，见上方快速开始
dsh plugin --profile web add file:D:/path/to/dsh-pet/dsh-pet
```

> 注：`npm run build`（即 `scripts/prepare.js`）才产出**完整可安装**的 lib——除 tsdown 构建外还构建桌面共享核心（`shared-core.js`）、生成类型声明并收敛发布 `files` 清单；裸 `tsdown` 构建会缺桌面运行时与类型。发布与打包（`npm publish` / `npm pack`）时由 `prepack` 自动调用它，克隆仓库后需手动跑一次。

### 安装后你会看到什么

默认配置是 `display: "both"`（浏览器与桌面都显示），所以重开 DSH 之后会依次出现两处，不必手动开：

1. **浏览器端先出现。** 宠物落在界面右上角（默认角落，设置页可改），此时桌面上还是空的。
2. **宿主自动补桌面运行时。** 本机没有 Electron 时，插件会自己下载一份（落在 `~/.dsh/electron`，同一版本只下一次；默认走 npmmirror 镜像）。进度直接打在 DSH 的控制台里，形如：

   ```
   [dsh-pet] Electron not found, downloading to <用户目录>/.dsh/electron/electron.exe ...
   [dsh-pet] Electron not found, downloading v43.3.0 (win32-x64) ...
   [dsh-pet] downloading 42.3MB / 104.1MB
   [dsh-pet] download complete (37.5s), extracting to <用户目录>/.dsh/electron ...
   ```

   这一步在**后台**进行，浏览器里的宠物照常可用；要等多久取决于网速（几十秒到几分钟），期间不用管它。
3. **桌面端随后出现。** 解压完自动拉起桌面 Helper，同一只宠物以透明窗形式落到桌面上——**此时屏幕上一共两只**：浏览器里一只、桌面上那只，共用同一份配置与同一套动画。
4. **想只留一只。** 两条路都行，改完即时生效：
   - **设置页**：选中该宠物 →「显示位置」下拉框 → 仅浏览器 / 仅桌面 / 两者都显示 / 都不显示；
   - **宠物右键**：菜单里的「显示位置」子菜单 → 仅网页 / 仅桌面 / 两者 / 都不（不用回设置页）。

> 已经装过 Electron（或设了 `DSH_PET_ELECTRON_PATH` 指向现成可执行文件）时，第 2 步会跳过，桌面端几乎立刻出现。下载失败**只影响桌面模式**：控制台会给出提示，浏览器里的宠物不受影响；网络受限时可以设 `DSH_PET_ELECTRON_MIRROR` 换镜像、`DSH_PET_ELECTRON_VERSION` 指定版本，重启后再试。

## 插件功能

- **纯粹的桌宠**：不做天气、监控等无关功能，不碰 DSH 内核；可选能力只有下面这些（余额 / 碎碎念 / 对话 / 工作状态 / 系统通知）
- **动画链**：每个动画（含待机）播完即按权重选下一个（默认 idle 10 / turn 5 / move 5 + 分类权重，`config.jsonc` 可调），首尾相接
- **事件动画**：余额 / 碎碎念 / 工作状态按档位触发专属动画；档位支持候选数组——触发时档内随机、循环播放自动轮换，避免连播同一段
- **多开**：同时显示多个宠物，各自独立大小与位置（设置页「桌宠配置」添加/删除）
- **屏幕漫游**：朝朝向方向行走，先探测空间、不走出屏幕（多屏按各屏边界判定；设置页「锁定在当前屏幕」开启后只在当前所在那块屏内走）
- **点击 / 拖拽 / 甩抛**：点击有回应动画并 Q 弹挤压；拖拽过阻尼弹簧跟手，甩出即抛物线飞行、屏幕边缘反弹、落地摩擦停稳并 Q 弹一下；温柔放下原地停住；两端同一套纯函数物理与挤压曲线（`dsh-pet/src/shared/physics.ts`）
- **右键菜单**：「动作 → 分类 → 具体动画」任意点播（移动类动画点播会真实行走一段）；工具项——浏览器端：碎碎念 / 对话 / 回到初始位置；桌面端：+ 打开网站、查看余额（余额启用时显示）、重载配置（改完配置文件直接右键重载全部桌面宠物，不必回设置页点保存）
- **「打开网站」按宿主自动分派**：宠物宿主是 **DSH 桌面应用**时，该项自动变成「打开 DeepSeek Harness」——用应用自注册的 `dsh://open` 协议把桌面应用主窗口唤到前台（已运行则前置、未运行则拉起）；宿主是 `dsh web` / 独立模式时，仍是系统默认浏览器打开站点
- **朝向与落地**：全部动画可镜像（可朝左 / 朝右）；脚底线统一，宠物始终站在地面上
- **流畅切换**：双缓冲交叉淡入，切换无空白帧
- **余额展示**：按已用百分比分档播余额动画 + 头顶联想气泡（10 秒自动消失）；DeepSeek 显示账户余额，OpenCode Zen Go 与 Command Code 显示最紧迫的一个额度窗口；**未登记余额接口的服务商改为弹文字说明**（不静默）；按宠物独立开关
- **碎碎念与对话**：碎碎念按周期自动生成一句（说话动画 + 气泡，也可手动触发）；对话在右键弹输入框与宠物聊天，还能附一张图（上传 / 拖拽 / 粘贴 / 截屏），记忆持久化（浏览器 / 桌面共享同一份）
- **工作状态联动**：监听 DSH 会话事件，切「思考 / 工作 / 整理 / 等待 / 成功 / 出错」档位动画 + 常驻气泡；目标多轮任务只在真正收尾轮庆祝
- **系统通知**：窗口失焦时弹系统 toast（对话完成 / 生成失败 / 输出截断 / 权限申请 / 用户选择）
- **桌面模式（可选）**：每只宠物开一个独立透明置顶局部小窗，与浏览器严格同行为、共用同一份素材与纯逻辑（见下节）
- **pet pack（额外宠物种类）**：`pet/` 下建 `种类名-config.json` + `种类名-animation/` 即新增独立动画池与素材的全新种类，多实例共享素材（见 [CONFIG.md](CONFIG.md) 的「方式四」）
- **自定义动画**：往 `main-animation/webm/` 放 VP9-Alpha 的 `.webm` 即为新动画，优先于包内素材
- **无障碍**：支持 `prefers-reduced-motion`（减少动效时跳过 Q 弹挤压与淡入切换）

## 🔌 对外接口（供其他插件调用）

桌宠不只自己玩，也**对外开放两条调用通道**，让别的插件或脚本能驱动它、读它的状态。

- **能做什么**：让它说一句指定的话、播一段指定动画、与它对话；读它当前说的话、工作状态、系统通知与余额
- **为什么开放**：桌宠不该只是个摆设——比如一个「女仆」插件巡检验完想说句话，就能让桌宠当它的「实体」开口；也方便任何人基于它做二次开发
- **通道一 · HTTP**：挂在 DSH 自己的 Web 服务上（前缀 `/dsh-pet-7340`，只监听本机、无鉴权），跨进程、脚本可直接调。动作类接口只回 `{ok}`，数据统一从 `GET /state` 读
- **通道二 · Cordis 服务**：客户端半侧在 DSH web 页面内注册，同页客户端插件用 `ctx.get('petApi7340')` 直接取，零网络、零端口；只在该页面实例内有效，方法与返回见 [`CORDIS.md`](CORDIS.md)

相关文件（HTTP 与 Cordis 各一套）：

- [`API.md`](API.md) —— HTTP 接口一览（每个接口一句话，功能预览）
- [`openapi.yaml`](openapi.yaml) —— 完整契约（OpenAPI 3.1，可直接导入 Swagger UI / Postman）
- [`CORDIS-API.md`](CORDIS-API.md) —— Cordis 服务一览（每个成员一句话，功能预览）
- [`CORDIS.md`](CORDIS.md) —— 对外 Cordis 服务（客户端半侧，页面内 `ctx.get('petApi7340')`，不走网络）
- [`tools/api-tester.html`](tools/api-tester.html) —— HTTP 侧示例：桌宠控制台，扮演第三方消费方，可直观试用（`node tools/api-tester.cjs` 启动）
- [`tools/cordis-probe`](tools/cordis-probe/README.md) —— Cordis 侧示例：扮演同页客户端插件，用 `ctx.get()` 消费服务

扩展做出来后欢迎分享：统一收录在 [PC2005-cloud/petE](https://github.com/PC2005-cloud/petE)——本项目的扩展收录仓库，每个扩展占一个目录、元信息写在 `plugin.json`，列表由流水线生成。想把自己的加进去，按仓库里的 `CONTRIBUTING.md` 提 PR 即可。安装：`dsh plugin --profile web add "github:PC2005-cloud/petE#path:/<扩展目录>"`。收录不代表对功能或安全性的审核，安装前请自行阅读代码。

## 兼容性

- **伴侣模式（本分支新增）**：只在 **Windows 10/11 x64** 上验证过；语音栈依赖 `livekit-server.exe` 与 Windows 路径推导脚本，Linux/macOS 未适配
- **操作系统**：Windows / Linux / macOS 三端均可运行——浏览器 overlay 与桌面模式（Electron 透明置顶窗）行为完全一致；Electron 按平台自动探测/下载（`electron.exe` / `Electron.app` / linux 单文件），无需手动安装
- **无头 / 无桌面环境**：支持 Linux headless 等无图形会话——桌面模式自动检测显示环境（Linux 无 `DISPLAY` / `WAYLAND_DISPLAY` 时判定无显示、跳过桌面窗口，仅日志告警），浏览器 overlay 不受影响
- **浏览器**：浏览器 overlay 兼容 **Chromium 内核（Chrome / Edge 等）与 Firefox**——透明动画依赖 VP9-Alpha webm，三者均已实测透明确认；**不支持 Safari**（macOS 不认 webm alpha，透明渲染为黑底）——macOS 用 `.mov` 素材（GitHub Release `assets-mov`），下载放入即可（见「②.5 Safari/HEVC 兼容素材」）
- **多显示器**：支持多屏环境——跨屏漫游/抛掷以各屏工作区为界，异构缩放（各屏 DPI 不同）、任务栏条带、屏幕之间空洞均正确判定（横屏 / 竖屏 / 上下叠放皆可）；设置页「锁定在当前屏幕」可让宠物（抛掷与漫游）只在当前所在那块屏内活动

## 🪟 桌面模式（可选，脱离浏览器）

插件内建**双模式**：安装后默认会拉起**独立透明置顶小窗**——为每只桌面宠物各开一个局部窗口（跟随宠物移动，**不铺满屏幕**），与浏览器 overlay 严格同行为、功能完全对齐：

- **依赖**：首次启动自动探测/下载 Electron（`~/.dsh/electron/`，也可 `cd dsh-pet && npm run ensure:electron` 手动触发）；缺失时仅日志告警，不影响浏览器形态
- **开关 = 每只宠物的必填字段 `display`**：`web` = 仅浏览器 / `desktop` = 仅桌面 / `both` = 两者 / `none` = 都不显示；桌面模式渲染 display 含 desktop 的**全部**宠物（多开同屏，与浏览器一致），设置页「桌宠配置」编辑即时生效
- 桌面端数据走独立进程管道，不依赖 DSH 的 HTTP 路由，不受 web 访问闸门影响
- 本地调试：`cd dsh-pet && npm run start:desktop -- http://127.0.0.1:3080/dsh-pet-7340/config`（无宿主时自动回落 HTTP 路径）

## 🧍 独立运行（完全不打开 DSH）

连 DSH 都不用开：插件的宿主半边跑在伪 ctx 上，由一个本机 HTTP 服务接管路由（**路由表仍是插件那一份**）。

```sh
npm install -g dsh-pet        # 必须 npm 装；dsh plugin add 装进 profile，bin 不在 PATH 上
dsh-pet-standalone            # http://127.0.0.1:3080/dsh-pet-7340/（占用则顺延）
dsh-pet-standalone --check    # 只体检
dsh-pet-standalone --port 3100

npm run build && npm run standalone   # 仓库里（先构建）
```

- **能用**：动画链、点击/拖拽/甩抛、右键菜单、多开、自定义动画与表情包、pet pack。
- **不可用**：余额、碎碎念、对话、系统通知——返回带 `reason` 的结构化失败（见 [`API.md`](API.md)）。
- **配置**：与 DSH 同一份（`$DSH_HOME/dsh-pet/main-config.jsonc` → 包内默认）。
- **只显示 `display` 含 `desktop`/`both` 的实例**；端口默认 3080；`Ctrl+C` 或 `POST /shutdown` 退出。
- **与 DSH 内运行可同时开**，但共用 `%APPDATA%\dsh-pet-electron-helper`，可能互相踩缓存（仅告警）。

## ⚙️ 余额展示（Balance）

按 `eventsRefreshSec.balance`（秒）周期拉取当前服务商的余额/用量数据，每次刷新按档位触发一次余额动画，并在宠物头顶弹出**联想气泡**（随宠物大小等比缩放，10 秒自动消失）：

- **DeepSeek 官方（`deepseek-official`）**：气泡显示账户余额（如 `余额 ¥8.79`）；余额按 ¥20 满额折算成已用百分比，分 6 档播放动画（钱袋满溢 → 金袋叮当 → 钱袋如常 → 数金皱眉 → 袋空如洗 → 分文不剩）
- **OpenCode Zen Go（`opencode-go`）**：气泡显示 5h/周/月 三个额度窗口中最先告急的一个（如 `周额度已用 88%` / `2.5 天重置`），同样按已用百分比分档
- **Command Code（`commandcode`，含 GOAT 等套餐）**：气泡显示 5h/周/月 三个额度窗口中最先告急的一个（与 opencode 同一口径：剩余额度最少者，通常先报 5h）；套餐无窗口限制时只报月度窗
- **暂不支持的服务商**：未登记余额接口的服务商**不播档位动画，改为弹一句文字说明**——第一行「当前服务商暂不支持余额查询」，第二行报出当前 provider id（便于自查）；缺凭证 / 抓取失败同理（原因写在第二行）。自动轮询只在**原因变化**时弹一次（不反复打扰），手动 `/balance` 或桌面右键「查看余额」则每次都会弹
- **按宠物开关**：`pets[i].balanceEnabled`（必填布尔）控制该宠物是否触发余额动画/显示气泡
- **所需凭据**：对应 provider 的 API key（`deepseek-official` → `DEEPSEEK_API_KEY`；`opencode-go` → `OPENCODE_GO_API_KEY`；`commandcode` → `COMMANDCODE_API_KEY`），在 DSH 凭据中配置后启用；未匹配的服务商不触发动画，改为弹上面的文字说明气泡

## ⚙️ 碎碎念与对话

- **碎碎念**：`pets[i].whisperEnabled` 开启后，按 `eventsRefreshSec.whisper`（秒，默认 300）周期自动生成一句——每只宠物独立周期、独立文案；触发时随机抽 `events.whisper` 动画 + 头顶说话气泡（10 秒消失）。默认开启
- **手动触发**：右键菜单「碎碎念」随时来一句——不受 `whisperEnabled` 门控（该字段只关自动周期轮询）
- **对话**：右键菜单「对话」或 `/chat` 命令打开输入框，与宠物聊天——回复走碎碎念同款展示（说话动画 + 气泡）；记忆持久化在 `$DSH_HOME/dsh-pet/memory.json`，浏览器与桌面共享同一份；多宠物时先用 `/pet` 选择对话目标
- **带图对话**：输入框下方两枚按钮——上传图片、截取当前屏幕；也可以把图**拖到宠物身上**，或直接 `Ctrl+V` 粘贴截图。图片只跟随这一轮请求，**不进记忆、不进气泡**；原图 ≤640 KiB 且长边 ≤2048 时原样发送，超限会缩到长边 2048 并按质量阶梯压成 JPEG（对应 `POST /chat` 的可选 `attachment`，见 [API.md](API.md)）
- **打开对话的快捷键**：鼠标停在某只宠物上按 `T`（右键菜单「对话」右侧有同样的提示）。桌面端要求窗口已聚焦——透明窗用 `showInactive` 显示、默认不抢焦点，先点一下宠物即可
- **截屏的边界**：只在点击/粘贴/拖拽那一瞬抓一帧，随即停流；桌面端取「宠物所在那块屏」，不建长连接、不落盘。图片与用户在 DSH 里贴图走同一个附件存储（内容寻址、同图去重）

## ⚙️ 工作状态联动（Work Status）

`pets[i].workStatusEnabled` 开启后，宠物跟随 DSH 会话活动切「思考 / 工作 / 整理 / 等待 / 成功 / 出错」六档动画 + 头顶气泡：非终态动画循环播、气泡常驻；成功 / 出错播一遍、气泡 10 秒自动收起。

- **档位动画**：`animations.events.workStatus` 数组，索引即档位（勿在中间插入新档，只可追加末尾）
- **气泡文案**：`workStatusTexts` 每档可配多句随机，任务详情（todo）优先
- **档位候选数组**：任意档位槽位可写 `string | string[]`——数组 = 档内随机抽 1，循环播放自动轮换、避免连播同一段（余额 / 碎碎念档位同样适用）

## ⚙️ 配置（大小 / 位置 / 多开）

设置页可改大小、位置、边距、显示位置、余额开关、多开与物理参数；配置文件则可以任意自由配置（动画池、播放权重、事件动画、刷新周期……）。

三种配置途径与「pet pack 额外宠物种类」的完整说明见 **[CONFIG.md](CONFIG.md)**。

## 从零生成你自己的宠物

AI 提示词 → 绿幕视频 → 透明动画 → 插件，换角色、换动作、换风格，全流程可复现。

完整步骤见 **[MAKE-YOUR-OWN-PET.md](MAKE-YOUR-OWN-PET.md)**（提示词配方、素材链、Safari 兼容、发布）。

## 项目结构

只列代码与发布相关目录；素材链的 video / scripts / step / pr 见 [MAKE-YOUR-OWN-PET.md](MAKE-YOUR-OWN-PET.md) 的 ② 章节（gitignore 的本地目录不列）：

```
├── README.md  MAKE-YOUR-OWN-PET.md  CONFIG.md  API.md  CORDIS.md  openapi.yaml   # 说明 / 宠物制作指南 / 配置 / HTTP 接口 / Cordis 服务 / OpenAPI 规范
├── NOTICE.md          # 第三方组件、模型与字体授权
├── PLAN-companion-voice.md  # 伴侣模式的实施计划（决策记录 / 阶段 / 验收清单）
├── prompts/           # ① 动画生成提示词配方（绿幕规范 + 按秒分解）
├── assets/            # 仓库展示用截图（本地运行截图不入库，见 .gitignore）
├── tools/             # 开发工具：API 调试页、cordis-probe mock 服务商、DPI 探针
├── scripts/doctor.mjs # 发布前自检：密钥扫描 / 误入库 / .gitignore 覆盖 / 大文件阈值
├── .github/workflows/ # CI：日常 ci.yml（TS 测试 + Python 测试）、HEVC 素材转码、桌面应用发版
├── voice/             # 语音栈（本分支新增）
│   ├── agent/         #   Python Agent：SenseVoice STT / Edge·MeloTTS / 记忆 / 情感 / 唤醒门
│   ├── tests/         #   pytest 单测（text_split / wake_gate / prosody / emotion）
│   ├── dev/           #   本机令牌服务 + 浏览器联调页 + 端到端检查脚本
│   └── scripts/       #   bootstrap（下载模型与二进制 + 建 venv）/ dev / start / stop / status
├── dsh-pet/           # ③ 插件（可独立 npm 发布）
│   ├── src/
│   │   ├── host/       # 宿主半侧：配置 / 路由 / 余额 / 工作状态 / 陪伴模块
│   │   ├── client/     # 浏览器半侧：宠物渲染 / 动画链 / 设置页
│   │   ├── app/        # 伴侣模式：设置中心 / 语音编排 / 路由（本分支新增）
│   │   ├── shared/     # 双端共用纯逻辑（物理 / 菜单 / 取数）
│   │   └── standalone/ # 独立模式 CLI（不依赖 DSH 直接跑桌宠）
│   ├── docs/           # 使用说明 / 技术路线 / 精简审查
│   ├── lib/            # 构建产物（pnpm run bundle 生成，不入库）
│   ├── runtime/        # 桌面模式运行壳（Electron 透明窗）+ 隐藏语音窗
│   ├── assets/         # webm 动画 / preview GIF / 字体 / 图标 / config.jsonc 默认配置
│   └── scripts/        # 构建、发布与开发脚本（app.cmd 一键启动伴侣应用）
└── LICENSE             # MIT
```

## 💬 反馈与发版节奏

> 本仓库是**伴侣模式的开发分支**：语音、情感、独立应用相关的问题提到本仓库 issue；
> 纯插件 / 素材链 / 动画配方的问题属于上游，请提到 [上游仓库](https://github.com/PC2005-cloud/dsh-pet/issues)。

欢迎提 issue 与 PR——bug、体验问题随时反馈。**新功能请先开 issue** 说明使用场景，由维护者判断是否实现、以及放在插件本体还是作为第三方扩展，不要在确认前直接提交实现 PR。与桌宠本身关系不大、或实现特别复杂的功能，通常不会进本体，而是通过现有接口由第三方扩展实现。动手前也请先翻一眼 [提交记录](https://github.com/PC2005-cloud/dsh-pet/commits/main)，确认不是已经修掉的同款问题（有些问题可能已经在 `main` 上修好了，只是还没发版）。

- **小修不单独发版**：不影响使用的小 bug 与优化会**累计**到下一个版本一起发，避免版本更迭过于频繁。所以「`main` 上已经修了」不等于「你装的这版已经包含」——`latest` 没更新时，以 `main` 的提交记录为准。
- **想立刻用上未发布的修复**：按上面的「从源码安装」把插件指向本地仓库即可；注意**宿主半侧**的代码改动要**重开 DSH** 才生效（浏览器半侧刷新页面即可）。
- **报 bug 时请带上**：插件版本、`dsh` 版本、操作系统、复现步骤（有日志或截图更好）。

## 许可

- 代码：MIT
- 素材（动画/提示词/源视频）：允许开源使用，**禁止商用**
- **二次创作（二创）约定**：基于本项目的衍生 / 改版 / 换皮作品，在 **GitHub 仓库、产品官网等公开渠道**上须附上原作者 GitHub 地址：<https://github.com/PC2005-cloud/dsh-pet>
- **形象出处**：宠物形象为社区二创的 DeepSeek「大肥鱼」（鲸鱼娘），**非 DeepSeek 官方形象**；原型「溟月」出自 B 站 [@上善无形](https://space.bilibili.com/4456176)，DeepSeek 版（女仆鲸鱼娘）设计出自 B 站 [@ZipZipPipe](https://space.bilibili.com/4168597)
- **形象授权**：[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hans)（署名 · 非商业 · 相同方式共享），[声明原文](https://www.bilibili.com/opus/1247156596114456581)：「大肥鱼是遵守CC BY-NC-SA 4.0协议的形象，不可以以任何形式商业化。若您非常喜爱该形象，希望其拥有实体，您可以自行定制。」
