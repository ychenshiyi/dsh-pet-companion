# 项目精简审查

> 2026-10-28 · 基于当前 `002dshlivekit` 工作区实测
> 目标：在不动「独立运行 + 语音对话 + 情感记忆」主链路的前提下，减少重复与体积。

## 体积现状（实测）

| 项                                  | 约                 | 说明                                                                     |
| ----------------------------------- | ------------------ | ------------------------------------------------------------------------ |
| `dsh-pet-repo/dsh-pet/assets`       | 125 MB             | 106 个 webm + 表情包/字体，桌宠本体必需                                  |
| `dsh-pet-repo/dsh-pet/node_modules` | 250 MB             | 仅开发/构建，发布不应带                                                  |
| `dsh-pet/`（npm 包副本）            | 已删除（-63.5 MB） | 与 repo 源重复，保留 `dsh-pet-repo/dsh-pet` 一份                         |
| `voice/models`                      | 570 MB → 411 MB    | 删除 159 MB 的 `melo-tts.tar.bz2` 后；含 SenseVoice 239 MB + Melo 170 MB |
| `dsh-pet-repo/dsh-pet/src`          | 2.2 MB             | 代码本身很小                                                             |

## 已完成

- 删除 `voice/models/melo-tts.tar.bz2`（159 MB，解压后无用）
- 移除未实现的 `custom` TTS 引擎枚举（UI 早已不提供）
- 测试并发改为 4，消除全量跑测时 408/413 偶发
- 默认 TTS 改为 Edge `zh-CN-XiaoxiaoNeural`，Melo 只做离线兜底（音色更自然）

## 建议的精简（按收益/风险排序）

### 1. 只保留一份包（已完成，-63.5 MB）

已删除 `dsh-pet/` 快照，只保留 `dsh-pet-repo/dsh-pet` 源码；发布从源码构建。

### 2. 语音模型按需下载，不入库/不随包（省 170–411 MB，中风险）

- SenseVoice 239 MB 是 STT 必需；Melo 170 MB 只是离线兜底
- 安装包只带下载器/校验和；首启或设置页按需下载
- 同时把 `models/` 加进 `.gitignore`，避免仓库膨胀

### 3. 情感逻辑去重（省约 200 行 + 修竞态，中风险）

现在同一套启发式写了两份：

- `src/host/plugin/emotion.ts`（文本/宿主）
- `voice/agent/emotion.py`（语音/Agent）

两份规则容易漂移；语音侧直接写 `emotion.json` 还与宿主存在极小概率并发覆盖。
建议：Agent 通过本机 HTTP 调宿主 `/dsh-pet-7340/emotion/apply`（带令牌），记忆也走 `/chat` 同一套接口；
Python 只保留「读状态注入提示词」，删除 `emotion.py` 的启发式与写盘。

### 4. 合并两套设置页（省一套页面/测试，中风险）

`/standalone-ai/` 是旧设置页，`/companion/` 是新设置中心；两者都维护 provider/key/测试连接。
建议：保留 `/companion/`，把旧页做成 302 跳转，删除 `standalone/settings-page.ts` 与对应测试。

### 5. PTT（已完成：直接移除）

用户确认不需要按住说话，已删除 PTT 悬浮窗/设置页按钮/接口，改为「语音常开 + 空闲唤醒词」。
少一个置顶窗口，也少一套麦克风状态机。

### 6. 单一日志出口（去重复行，低风险）

`logs.txt` 偶发每行重复，是应用 console 包装与宿主 logger 叠加。建议只保留一个文件 logger，
宿主用 `ctx.logger` 直接复用。

### 7. 发布裁剪（省 100 MB+，低风险）

- `electron-builder` 的 files 排除 `src/`、`node_modules` 开发依赖、测试、`*.map`
- 只保留 `lib/`、`runtime/`、`assets/`、`package.json`
- 模型与 Python venv 走运行时目录/首次下载，不打进 asar

## 不建议精简

- LiveKit：57 MB server 换来 AEC/重连/打断/设备切换，目前值得
- 106 个 webm：桌宠的核心体验，删了就不是这个产品
- 密钥与配置分离（`companion.json` / `companion-secrets.json`）：安全边界，不能合并
- 文本/语音共用 `memory.json` / `emotion.json`：这是「同一只宠物」的基础

## 下一步建议顺序

1. 模型按需下载 + 发布裁剪（收益最大）
2. 删 `dsh-pet/` 副本 / 改为产物
3. Agent 情感走 HTTP，删 Python 启发式
4. 旧设置页跳转/删除
5. 日志单出口、旧设置页删除
