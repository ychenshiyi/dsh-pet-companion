/**
 * 对话与记忆：读写记忆文件、串行化对话队列、维护活跃宠物并生成碎碎念与回复。
 *
 * 不拼人设（人设归配置），不发网络请求（归 ./chat、./whisper）。
 * 依赖由 apply 显式传入（见输入类型），模块内不读全局、不建单例。
 * @module dsh-pet/src/host/plugin/chat-memory
 */
import { dirname, join } from 'node:path';
import { generateChat, type ChatMemoryMessage } from '../chat.ts';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { composeSystemPrompt, petPersona } from '../persona.ts';
import { findPetInstance, readAllConfig, removeRoundsByTs } from '../config.ts';
import type { PetImageRef } from '../image-attachment.ts';
import { limitPool, pickMeme, readMemePool } from '../memes.ts';
import { generateWhisper } from '../whisper.ts';
import { configuredModel } from '../model-selection.ts';
import { createEmotionStore, emotionPrompt, moodAnim, type EmotionState } from './emotion.ts';
import { readRuntimePolicy } from './policy.ts';
import { archiveOverflow, readArchive } from './archive.ts';
import { bm25Search, retrievalBlock } from './retrieval.ts';
import {
  applyCompression,
  contextStateOf,
  estimateMessages,
  estimateTokens,
  shouldRemind,
  summaryBlock,
  type MemoryBucket,
} from './summary.ts';
import { createUsageStore } from './usage.ts';
import type { HostSetup } from './setup.ts';
import type { HostContext } from './context.ts';

/** 对话与记忆的输入：装配期对象与更早的工厂。 */
export type ChatMemoryInput = {
  /** 宿主上下文（apply 收到的那一个）。 */
  ctx: HostContext;
} & Pick<HostSetup, 'configPaths'> &
  Pick<HostSetup, 'log'> &
  Pick<HostSetup, 'memeDirsFor'> &
  Pick<HostSetup, 'state'> &
  Pick<HostSetup, 'userRoot'>;

/**
 * 创建对话与记忆。
 */
export function createChatMemory(deps: ChatMemoryInput) {
  const { ctx, configPaths, log, memeDirsFor, state, userRoot } = deps;
  // 命令「当前桌宠」（/pet 选择、/chat 使用）：全局单值不分会话；进程内内存，重启回默认第一只
  let activePetId = '';

  // 碎碎念周期调度的「上次生成时刻」（按宠物）：调度拍据此判断到没到点。
  // 生成结果直接写 S，多端共享同一句由 S 天然保证，不需要第二份缓存。
  const lastWhisperAt = new Map<string, number>();

  // 对话记忆文件（唯一读写方 = 本进程；浏览器/桌面两端都只是客户端 → 同一实例天然共享同一份记忆）。
  // 结构双层：{ <种类桶 assetRoot ?? petId>: { <实例 id>: { messages: ChatMemoryMessage[] } } }
  // 路径可由伴侣设置（chat.memoryDir）通过 DSH_PET_MEMORY_FILE 指定；默认仍在数据根。
  const memoryPath = process.env.DSH_PET_MEMORY_FILE || join(userRoot, 'memory.json');

  // 情感养成 v1：与 memory.json 同目录；设置页可通过环境变量关闭。
  const emotionPath = process.env.DSH_PET_EMOTION_FILE || join(userRoot, 'emotion.json');
  const emotion = createEmotionStore(emotionPath);
  const emotionEnabled = process.env.DSH_PET_EMOTION_ENABLED !== '0';
  const usage = createUsageStore(process.env.DSH_PET_USAGE_FILE || join(userRoot, 'usage.jsonl'));

  // 对话写操作串行队列：read-modify-write 排队执行，防两端同时对话时交错写盘
  let chatQueue: Promise<void> = Promise.resolve();

  /** 读记忆文件：不存在 → 空；解析失败/根不是对象 → 记日志 + 空记忆（不备份、不改写源文件） */
  const readMemory = async (): Promise<Record<string, Record<string, MemoryBucket>>> => {
    let raw: string;
    try {
      raw = await readFile(memoryPath, 'utf8');
    } catch {
      return {}; // 文件不存在 = 尚无记忆
    }
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
      return parsed as Record<string, Record<string, MemoryBucket>>;
    } catch (e) {
      log.error(
        `dsh-pet: 记忆文件无法解析（对话将从头开始）：${memoryPath}（${e instanceof Error ? e.message : String(e)}）`,
      );
      return {};
    }
  };

  const writeMemory = async (mem: Record<string, Record<string, MemoryBucket>>): Promise<void> => {
    await mkdir(userRoot, { recursive: true });
    await writeFile(memoryPath, JSON.stringify(mem, null, 2), 'utf8');
  };

  const archiveDir = process.env.DSH_PET_ARCHIVE_DIR || join(dirname(memoryPath), 'archive');
  const archiveMax = (): number => Math.max(100, Number(process.env.DSH_PET_ARCHIVE_MAX_MESSAGES) || 2000);
  /** 把超出上限的旧原话移到 archive；摘要/当前上下文不变。 */
  const archiveIfNeeded = async (entry: string, petId: string, bucket: MemoryBucket): Promise<void> => {
    const result = await archiveOverflow(entry, petId, bucket, {
      dir: archiveDir,
      maxMessages: archiveMax(),
    });
    if (result.removed > 0) {
      log.info(`[dsh-pet] 全文归档 pet=${petId} 移出 ${result.removed} 条 → ${result.file}`);
    }
  };

  /** 把一次读写封进串行队列（同进程内防交错），返回 fn 的结果 */
  const withMemoryLock = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chatQueue.then(fn, fn);
    chatQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  /** 某宠物的最终人设 system：实例级 `pets[].whisperPrompt` 优先，没写回落到所属条目的那份。
   *  拼装在 ./persona（纯函数）：人设正文 + 名字声明 + 一行时间背景，时间每次现算。
   *  收 `findPetInstance` 的命中结果而不是 (petId, cfg)：调用方都已解析过，再查只会多一处
   *  「查不到就兜底 main」的不可达分支。 */
  const petSystemPrompt = (found: { conf: Record<string, unknown>; pet: Record<string, unknown> }): string =>
    composeSystemPrompt({
      prompt: petPersona(found.conf, found.pet),
      name: String(found.pet.name ?? ''),
      id: String(found.pet.id ?? ''),
      now: new Date(),
    });

  /** 对话记忆轮数（1 轮 = 1 问 1 答）：该宠物所属条目的 chatMemoryRounds（合并器已填默认）。
   *  收已解析的条目配置：调用方都已拿到 `findPetInstance` 的结果。 */
  const memoryRounds = (conf: Record<string, unknown>): number => {
    const v = Number(conf.chatMemoryRounds);
    return Number.isFinite(v) && v >= 0 ? Math.floor(v) : 5;
  };
  // 上下文参数来自 app 设置（环境变量由设置页保存时写入），没设置时回落到条目配置/内置默认。
  const envNumber = (name: string): number | undefined => {
    const value = Number(process.env[name]);
    return Number.isFinite(value) ? value : undefined;
  };
  const configNumber = (conf: Record<string, unknown>, key: string, fallback: number): number => {
    const value = Number(conf[key]);
    return Number.isFinite(value) ? value : fallback;
  };
  const contextBudget = (conf: Record<string, unknown>): number =>
    Math.max(1500, envNumber('DSH_PET_CONTEXT_BUDGET') ?? configNumber(conf, 'contextBudgetTokens', 6000));
  const contextKeep = (conf: Record<string, unknown>): number =>
    Math.max(2, envNumber('DSH_PET_CONTEXT_KEEP') ?? configNumber(conf, 'contextKeepRecentTurns', 6));
  const contextCompressAt = (conf: Record<string, unknown>): number => {
    const value = envNumber('DSH_PET_CONTEXT_COMPRESS_AT') ?? configNumber(conf, 'contextCompressAt', 0.75);
    return Math.min(0.95, Math.max(0.5, value));
  };
  const contextRemindEvery = (conf: Record<string, unknown>): number =>
    Math.max(0, envNumber('DSH_PET_CONTEXT_REMIND_EVERY') ?? configNumber(conf, 'contextRemindEvery', 5));
  const retrievalEnabled = (conf: Record<string, unknown>): boolean =>
    process.env.DSH_PET_RETRIEVAL_ENABLED !== '0' && conf.retrievalEnabled !== false;
  const retrievalTopK = (conf: Record<string, unknown>): number =>
    Math.max(0, envNumber('DSH_PET_RETRIEVAL_TOPK') ?? configNumber(conf, 'retrievalTopK', 3));
  const retrievalMaxChars = (conf: Record<string, unknown>): number =>
    Math.max(200, envNumber('DSH_PET_RETRIEVAL_MAXCHARS') ?? configNumber(conf, 'retrievalMaxChars', 1200));
  /** 生成并返回某宠物的一句碎碎念（周期调度与菜单手动触发共用）：人设取它自己的 whisperPrompt，
   *  没写回落到所属条目；成功写进 S 的 pets.<id>.say——碎碎念 / 命令气泡 / 对话回复在前端是同一条
   *  展示链路，所以共用一个叶子。配图开关开启时从表情包池随机抽 1 张。
   *  失败带回真实 reason（含 unknown-pet），成功带回生成的文本——调用方不必再拉一拍 /state。 */
  const publishWhisper = async (
    petId: string,
  ): Promise<
    | { ok: true; text: string; image?: string }
    | { ok: false; reason: 'provider-missing' | 'generate-error' | 'unknown-pet'; message?: string }
  > => {
    const cfg = readAllConfig(configPaths);
    const found = findPetInstance(cfg, petId);
    // 宠物可能在「校验那次读」与这里之间被删（配置随时会变，两次读之间就是窗口）：
    // 明确失败、不生成不写 S——写下去就是一只已不存在宠物的幽灵叶子（常驻到进程重启）。
    if (!found) return { ok: false, reason: 'unknown-pet', message: '没有这只桌宠：' + petId };
    const system = petSystemPrompt(found);
    const withEmotion = emotionEnabled
      ? `${system}\n\n${emotionPrompt(await emotion.read(found.entry, petId))}`
      : system;
    // 配图：开关关闭 / 池为空 / 池内图片全缺失 → 纯文本（不报错，只是没有图）
    const meme =
      found.conf.whisperImageEnabled === true
        ? pickMeme(readMemePool(found.conf.memes, memeDirsFor(found.entry)))
        : undefined;
    // 模型：条目配置的 whisperModel 优先（留空 = 不指定）；生成侧失败会回落到当前对话的模型重试一次
    const result = await generateWhisper(ctx, withEmotion, meme, configuredModel(found.conf, 'whisperModel'));
    if (!result.ok) {
      // 失败不写 S：静默跳过 + warn，不伪造文案、不弹错误气泡
      log.warn(
        '[dsh-pet] 碎碎念生成失败 pet=' +
          petId +
          ' reason=' +
          result.reason +
          (result.message ? ' ' + result.message : ''),
      );
      // 真实 reason 原样带回：路由若把失败硬编码成 generate-error，独立模式下已算出的
      // provider-missing 就会在边界被吞掉（API.md 描述的降级 reason 正是它）。
      return result;
    }
    state.writePet(petId, 'say', result.image ? { text: result.text, image: result.image } : { text: result.text });
    // 成功也留一行：否则 logs.txt 里「没触发」与「触发了并且成功」无法区分。
    log.info(
      `[dsh-pet] 碎碎念生成成功 pet=${petId}，${result.text.length} 字` +
        (result.image ? `，配图=${result.image}` : ''),
    );
    // 文本随返回值带出，且与刚写进叶子的是同一个变量：两条出口给同一份文本，不是一个真相两个版本
    return { ok: true, text: result.text, ...(result.image ? { image: result.image } : {}) };
  };

  /**
   * 把一段旧对话压成摘要。优先 LLM；失败时退回抽取式摘要（仍保留关键原话，绝不丢上下文）。
   * 只给纯文本（不带表情包池/图片），避免摘要被 [图:] 等协议污染。
   */
  const summarizeOld = async (
    previous: string,
    messages: readonly ChatMemoryMessage[],
  ): Promise<string | undefined> => {
    if (messages.length === 0) return previous.trim() || undefined;
    const transcript = messages
      .map((message) => `${message.role === 'user' ? '主人' : '桌宠'}：${message.content}`)
      .join('\n')
      .slice(-12_000);
    const prompt = [
      '请把下面这段旧对话压缩成一段长期记忆摘要，供以后继续聊天时参考。',
      '要求：',
      '1. 保留称呼、关系变化、喜好/厌恶、承诺、约定、日期、未完成的话题、重要情绪转折。',
      '2. 不要编造；不确定的信息宁可不写。',
      '3. 用第三人称，300–800 字，不要 Markdown 标题。',
      previous.trim() ? `\n【已有摘要】\n${previous.trim()}` : '',
      `\n【旧对话】\n${transcript}`,
    ].join('\n');
    const result = await generateChat({
      ctx,
      system: '你负责整理桌宠与主人的长期记忆，只输出摘要正文。',
      history: [],
      userText: prompt,
      pool: [],
    });
    const text = result.ok ? result.text.trim() : '';
    if (text) return text.slice(0, 4000);
    const fallback = extractiveSummary(previous, messages);
    log.warn(
      '[dsh-pet] 上下文压缩改用抽取式摘要' +
        (result.ok ? '（模型无文本）' : `（${result.reason}${result.message ? '：' + result.message : ''}）`),
    );
    return fallback;
  };

  /** 模型压缩失败时的兜底：保留用户原话里较有信息量的句子，过滤语气词/短句。 */
  const extractiveSummary = (previous: string, messages: readonly ChatMemoryMessage[]): string => {
    const users = messages
      .filter((message) => message.role === 'user')
      .map((message) => message.content.replace(/\s+/g, ' ').trim())
      .filter((line) => line.length >= 6)
      .filter(
        (line) =>
          !/^(嗯+|哦+|啊+|好|好的|对|对的|是|是的|行|可以|没事|没什么|知道了|哈哈+|呵+|在吗|你好)[。！？!?，,、\s]*$/.test(
            line,
          ),
      );
    const seen = new Set<string>();
    const unique = users.filter((line) => {
      const key = line.slice(0, 40);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const keywords =
      /我|喜欢|讨厌|想要|记住|答应|约|明天|今天|昨天|工作|游戏|名字|生日|不要|别|害怕|开心|难过|生气|计划|准备|以后/;
    const picked = unique
      .map((line, index) => ({ line, index, score: line.length + (keywords.test(line) ? 40 : 0) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 24)
      .sort((a, b) => a.index - b.index)
      .map(({ line }) => (line.length > 120 ? line.slice(0, 120) + '…' : line));
    const body = picked.length > 0 ? picked.join('；') : '（这段旧对话以短句/语气词为主）';
    return [previous.trim(), '用户说过：' + body].filter(Boolean).join('\n').slice(0, 4000);
  };

  /** 与某只宠物对话：截取最近记忆 → 生成回复 → 写入记忆 → 写进 S 的 pets.<id>.say。
   *  供 POST /chat 与 /chat 命令共用（锁内读写，防两端交错写盘）；成功带回回复文本。 */
  const chatWithPet = async (
    petId: string,
    text: string,
    image?: PetImageRef,
  ): Promise<
    | { ok: true; text: string; image?: string }
    | { ok: false; reason: 'provider-missing' | 'generate-error' | 'unknown-pet'; message?: string }
  > =>
    withMemoryLock(async () => {
      const cfg = readAllConfig(configPaths);
      const found = findPetInstance(cfg, petId);
      // 宠物在「校验那次读」与这里之间被删了——本函数还要先排 withMemoryLock 的串行队列，
      // 窗口可能是秒级，所以这一支真会命中。明确失败：不生成、不写记忆也不写叶子，
      // 否则会在 memory.json 里永久留下一个已删宠物的分桶，外加一只幽灵叶子。
      if (!found) return { ok: false, reason: 'unknown-pet', message: '没有这只桌宠：' + petId };
      const budget = contextBudget(found.conf);
      const keep = contextKeep(found.conf);
      const compressAt = contextCompressAt(found.conf);
      const remindEvery = contextRemindEvery(found.conf);
      // 人设：实例级 whisperPrompt 优先，没写回落所属条目（与碎碎念同一拼装）
      const system = petSystemPrompt(found);
      // 关系状态只进提示词，不改历史；关闭情感时完全跳过。
      const systemWithEmotion = emotionEnabled
        ? `${system}\n\n${emotionPrompt(await emotion.read(found.entry, petId))}`
        : system;
      // 配图：开关关闭 → 空池（指令与解析都不介入）；目录链按所属条目取。
      // 张数上限（chatImageLimit，0 = 不限制）：整张清单每条消息都要附，截断后费用上限可控。
      const pool =
        found.conf.chatImageEnabled === true
          ? limitPool(readMemePool(found.conf.memes, memeDirsFor(found.entry)), Number(found.conf.chatImageLimit))
          : [];
      const mem = await readMemory();
      // 坏结构（数组/标量）按空桶重建；messages 不是数组的条目按新会话处理，避免 push 到坏对象上崩溃
      const bucket =
        mem[found.entry] && typeof mem[found.entry] === 'object' && !Array.isArray(mem[found.entry])
          ? mem[found.entry]
          : (mem[found.entry] = {});
      const existing = bucket[petId];
      if (existing !== undefined && (!existing || !Array.isArray(existing.messages))) {
        log.error(`[dsh-pet] 记忆结构异常（messages 不是数组）pet=${petId}，按新会话处理：${memoryPath}`);
      }
      const entry = existing && Array.isArray(existing.messages) ? existing : (bucket[petId] = { messages: [] });
      const all = entry.messages;
      let contextState = contextStateOf(entry);
      const recentCount = Math.min(all.length, keep * 2);
      const oldEnd = Math.max(0, all.length - recentCount);
      let summarizedCount = Math.min(contextState.summarizedCount, oldEnd);
      let summary = contextState.summary;
      const promptTokens =
        estimateTokens(systemWithEmotion) +
        estimateTokens(summary) +
        estimateMessages(all.slice(summarizedCount)) +
        estimateTokens(text);
      if (promptTokens > budget * compressAt && oldEnd > summarizedCount) {
        const old = all.slice(summarizedCount, oldEnd);
        const nextSummary = await summarizeOld(summary, old);
        if (nextSummary) {
          const saved = estimateTokens(summary) + estimateMessages(old) - estimateTokens(nextSummary);
          contextState = applyCompression(contextState, nextSummary, oldEnd, saved);
          summary = nextSummary;
          summarizedCount = oldEnd;
          log.info(
            `[dsh-pet] 上下文已压缩 pet=${petId} 旧消息=${old.length} 压缩次数=${contextState.compressions} 约省=${Math.round(saved)} tokens`,
          );
        }
      }
      let list = all.slice(summarizedCount);
      const afterTokens =
        estimateTokens(systemWithEmotion) + estimateTokens(summary) + estimateMessages(list) + estimateTokens(text);
      if (afterTokens > budget) {
        // 压缩失败或摘要仍超预算：退回最近窗口，至少保证这次请求不爆
        list = all.slice(Math.max(0, all.length - recentCount));
        log.warn(`[dsh-pet] 上下文仍超预算（${afterTokens}/${budget}），本次仅用最近 ${list.length} 条 pet=${petId}`);
      }
      let retrieval = '';
      if (retrievalEnabled(found.conf) && retrievalTopK(found.conf) > 0 && text.trim().length >= 2) {
        const archived = await readArchive(archiveDir, found.entry, petId);
        const oldRaw = all.slice(0, Math.max(0, all.length - recentCount));
        const hits = bm25Search([...archived, ...oldRaw], text, retrievalTopK(found.conf));
        const block = retrievalBlock(hits, retrievalMaxChars(found.conf));
        if (block) {
          const withRetrieval =
            estimateTokens(systemWithEmotion) +
            estimateTokens(summary) +
            estimateMessages(list) +
            estimateTokens(block) +
            estimateTokens(text);
          if (withRetrieval <= budget) retrieval = block;
          else log.info(`[dsh-pet] 旧对话检索跳过：会超预算（${withRetrieval}/${budget}）pet=${petId}`);
        }
      }
      const systemWithContext = [systemWithEmotion, summary.trim() ? summaryBlock(summary) : '', retrieval]
        .filter(Boolean)
        .join('\n\n');
      let reminderNote = '';
      if (shouldRemind(contextState, remindEvery)) {
        contextState.remindedAt = contextState.compressions;
        reminderNote = `\n\n（我们已经聊了很久，上下文已压缩 ${contextState.compressions} 次。要不要导出回忆录，或者开个新话题？）`;
      }
      // 图片只记尺寸与字节数（不记 base64）：模型不支持读图时 dsh-llm 会把它投影成占位文本，靠这行日志定位
      if (image !== undefined) {
        log.info(
          `[dsh-pet] 对话附带图片 pet=${petId}，${image.width}x${image.height}，${image.bytes} 字节` +
            '（模型不支持读图时内核会以占位文本代替）',
        );
      }
      // 模型：条目配置的 chatModel 优先（留空 = 不指定）；生成侧失败会回落到当前对话的模型重试一次
      // 流式气泡：LLM 增量直接写 say，前端 1s 轮询会看到文字逐步变长；限流避免写爆 state。
      let lastStreamAt = 0;
      const generated = await generateChat({
        ctx,
        system: systemWithContext,
        history: list,
        userText: text,
        pool,
        preferred: configuredModel(found.conf, 'chatModel'),
        image,
        onDelta: (partial) => {
          const now = Date.now();
          if (now - lastStreamAt < 120) return;
          lastStreamAt = now;
          state.writePet(petId, 'say', { text: partial, anim: false });
        },
      });
      if (!generated.ok) return generated;
      const now = Date.now();
      // 用量账本：优先用模型返回的真实 token；缺失时按字符估算（面板会标“估算”）
      const inputTokens =
        generated.usage?.input ?? Math.ceil((systemWithEmotion.length + text.length + list.length * 20) / 4);
      const outputTokens = generated.usage?.output ?? Math.ceil(generated.text.length / 4);
      await usage.record({
        ts: now,
        petId,
        surface: 'text',
        inputTokens,
        outputTokens,
      });
      const policy = readRuntimePolicy(userRoot);
      let replyText = generated.text;
      if (policy.usage.dailyLimit > 0) {
        const summary = await usage.summary(1);
        const used = summary.today.input + summary.today.output;
        const warnAt = Math.round((policy.usage.dailyLimit * policy.usage.warnPercent) / 100);
        if (used >= policy.usage.dailyLimit) {
          replyText += `\n\n（今日用量已达上限：${used}/${policy.usage.dailyLimit} tokens）`;
        } else if (used >= warnAt) {
          replyText += `\n\n（今日用量已到 ${policy.usage.warnPercent}%：${used}/${policy.usage.dailyLimit} tokens）`;
        }
      }
      replyText += reminderNote;
      // 图信息只存不送：记忆要能还原「这一轮带过图、配过哪张」（聊天记录存档），
      // 但历史回放一律只带正文——否则每轮都会把旧图重发一遍给模型。
      entry.context = contextState;
      entry.messages.push({ role: 'user', content: text, ts: now, ...(image ? { image } : {}) });
      entry.messages.push({
        role: 'assistant',
        content: generated.text,
        ts: now,
        ...(generated.image ? { meme: generated.image } : {}),
      });
      await archiveIfNeeded(found.entry, petId, entry);
      await writeMemory(mem);
      if (emotionEnabled) {
        const before = await emotion.read(found.entry, petId);
        const next = await emotion.apply(found.entry, petId, text, replyText);
        if (next.mood !== before.mood) {
          const anim = moodAnim(next.mood);
          if (anim) state.writePet(petId, 'anim', { name: anim });
        }
        log.info(`[dsh-pet] 情感更新 pet=${petId} mood=${next.mood} affection=${next.affection} trust=${next.trust}`);
      }
      // 回复写进 S（与碎碎念同一个叶子：前端本来就是同一条展示链路）
      state.writePet(petId, 'say', generated.image ? { text: replyText, image: generated.image } : { text: replyText });
      // 同一份文本随返回值带出（叶子照写，不是二选一）
      return { ok: true as const, text: replyText, ...(generated.image ? { image: generated.image } : {}) };
    });

  /** 删除某只宠物的对话记忆：`ts` 缺省 = 清空全部，给了 ts = 只删命中的轮（一轮两条共享 ts，成对删）。
   *  与对话共用同一条串行队列——删除不会插进一次回复的读-改-写中间，也不会被它覆盖写回。
   *  删空的宠物连叶子与空条目一起摘掉：否则 memory.json 里会永久堆着空对象，看不出这里曾有历史。 */
  const deleteHistory = async (
    petId: string,
    ts?: readonly number[],
  ): Promise<{ ok: true; removed: number } | { ok: false; reason: 'unknown-pet'; message: string }> =>
    withMemoryLock(async () => {
      const cfg = readAllConfig(configPaths);
      const found = findPetInstance(cfg, petId);
      // 与对话同一支：宠物随时可能被删，明确失败，不在文件里留没人消费的分桶
      if (!found) return { ok: false as const, reason: 'unknown-pet' as const, message: '没有这只桌宠：' + petId };
      const mem = await readMemory();
      const byPet = mem[found.entry];
      const before = byPet?.[petId]?.messages;
      const list = Array.isArray(before) ? before : [];
      const kept = ts === undefined ? [] : removeRoundsByTs(list, ts).messages;
      const removed = list.length - kept.length;
      if (removed > 0) {
        const leaf = byPet?.[petId];
        if (kept.length > 0 && leaf !== undefined) {
          leaf.messages = kept;
          // 摘要可能包含刚被删掉的轮次：删除后重置压缩状态，避免摘要与原文不一致。
          delete leaf.context;
        } else if (byPet !== undefined) {
          // 清空（或本来就只剩坏数据）：摘掉宠物叶子；条目空了连条目一起摘
          delete byPet[petId];
          if (Object.keys(byPet).length === 0) delete mem[found.entry];
        }
        await writeMemory(mem);
      }
      // 只记数量与动作，不打正文（记忆内容是用户隐私）
      log.info(`[dsh-pet] 删除对话记忆 pet=${petId}，removed=${removed}` + (ts === undefined ? '（清空）' : ''));
      return { ok: true as const, removed };
    });

  /** 情感状态：GET /emotion 用；找不到宠物明确失败。 */
  const getEmotion = async (
    petId: string,
  ): Promise<
    { ok: true; state: EmotionState; enabled: boolean } | { ok: false; reason: 'unknown-pet'; message: string }
  > => {
    const cfg = readAllConfig(configPaths);
    const found = findPetInstance(cfg, petId);
    if (!found) return { ok: false as const, reason: 'unknown-pet' as const, message: '没有这只桌宠：' + petId };
    return { ok: true as const, state: await emotion.read(found.entry, petId), enabled: emotionEnabled };
  };

  /** 重置情感状态（设置页「重置成长」）。 */
  const resetEmotion = async (
    petId: string,
  ): Promise<{ ok: true; state: EmotionState } | { ok: false; reason: 'unknown-pet'; message: string }> => {
    const cfg = readAllConfig(configPaths);
    const found = findPetInstance(cfg, petId);
    if (!found) return { ok: false as const, reason: 'unknown-pet' as const, message: '没有这只桌宠：' + petId };
    const next = await emotion.reset(found.entry, petId);
    log.info(`[dsh-pet] 情感重置 pet=${petId}`);
    return { ok: true as const, state: next };
  };

  /** 外部读取上下文统计（设置页 / 语音启动时检查），不压缩、不改文件。 */
  const getContext = async (
    petId: string,
  ): Promise<
    | {
        ok: true;
        compressions: number;
        summarizedCount: number;
        summary: string;
        messages: number;
        tokens: number;
        budget: number;
        keepRecentTurns: number;
      }
    | { ok: false; reason: 'unknown-pet'; message: string }
  > => {
    const cfg = readAllConfig(configPaths);
    const found = findPetInstance(cfg, petId);
    if (!found) return { ok: false, reason: 'unknown-pet', message: '没有这只桌宠：' + petId };
    const mem = await readMemory();
    const entry = mem[found.entry]?.[petId];
    const contextState = contextStateOf(entry ?? { messages: [] });
    const messages = entry?.messages?.length ?? 0;
    const tokens =
      estimateTokens(contextState.summary) +
      estimateMessages((entry?.messages ?? []).slice(contextState.summarizedCount));
    return {
      ok: true,
      compressions: contextState.compressions,
      summarizedCount: contextState.summarizedCount,
      summary: contextState.summary,
      messages,
      tokens,
      budget: contextBudget(found.conf),
      keepRecentTurns: contextKeep(found.conf),
    };
  };

  /** 立即压缩：供设置页「立即压缩」与语音启动时调用；没有可压缩内容时不做事。 */
  const compressContext = async (
    petId: string,
  ): Promise<
    | { ok: true; compressed: boolean; compressions: number; summarizedCount: number; summary: string }
    | { ok: false; reason: 'unknown-pet' | 'summarize-failed'; message?: string }
  > =>
    withMemoryLock(async () => {
      const cfg = readAllConfig(configPaths);
      const found = findPetInstance(cfg, petId);
      if (!found) return { ok: false as const, reason: 'unknown-pet' as const, message: '没有这只桌宠：' + petId };
      const mem = await readMemory();
      const bucket =
        mem[found.entry] && typeof mem[found.entry] === 'object' && !Array.isArray(mem[found.entry])
          ? mem[found.entry]
          : (mem[found.entry] = {});
      const entry = bucket[petId] ?? (bucket[petId] = { messages: [] });
      const all = entry.messages;
      const keep = contextKeep(found.conf);
      const oldEnd = Math.max(0, all.length - keep * 2);
      let contextState = contextStateOf(entry);
      const summarizedCount = Math.min(contextState.summarizedCount, oldEnd);
      if (oldEnd <= summarizedCount) {
        return {
          ok: true as const,
          compressed: false,
          compressions: contextState.compressions,
          summarizedCount,
          summary: contextState.summary,
        };
      }
      const nextSummary = await summarizeOld(contextState.summary, all.slice(summarizedCount, oldEnd));
      if (!nextSummary) return { ok: false as const, reason: 'summarize-failed' as const };
      const saved =
        estimateTokens(contextState.summary) +
        estimateMessages(all.slice(summarizedCount, oldEnd)) -
        estimateTokens(nextSummary);
      contextState = applyCompression(contextState, nextSummary, oldEnd, saved);
      entry.context = contextState;
      await writeMemory(mem);
      log.info(
        `[dsh-pet] 手动压缩上下文 pet=${petId} 旧消息=${oldEnd - summarizedCount} 压缩次数=${contextState.compressions}`,
      );
      return {
        ok: true as const,
        compressed: true,
        compressions: contextState.compressions,
        summarizedCount: contextState.summarizedCount,
        summary: contextState.summary,
      };
    });

  /** 供语音/外部渠道追加消息：宿主是唯一写者，避免 Python 直接改写 memory.json。 */
  const appendMessage = async (
    petId: string,
    role: 'user' | 'assistant',
    content: string,
  ): Promise<{ ok: true } | { ok: false; reason: 'unknown-pet' | 'bad-request'; message: string }> =>
    withMemoryLock(async () => {
      const text = content.trim();
      if (!text || text.length > 8000) {
        return { ok: false as const, reason: 'bad-request' as const, message: '消息为空或过长' };
      }
      const cfg = readAllConfig(configPaths);
      const found = findPetInstance(cfg, petId);
      if (!found) return { ok: false as const, reason: 'unknown-pet' as const, message: '没有这只桌宠：' + petId };
      const mem = await readMemory();
      const bucket =
        mem[found.entry] && typeof mem[found.entry] === 'object' && !Array.isArray(mem[found.entry])
          ? mem[found.entry]
          : (mem[found.entry] = {});
      const entry = bucket[petId] ?? (bucket[petId] = { messages: [] });
      entry.messages.push({ role, content: text, ts: Date.now() });
      await archiveIfNeeded(found.entry, petId, entry);
      await writeMemory(mem);
      return { ok: true as const };
    });

  /** 语音启动/外部渠道读上下文：摘要 + 最近若干条原文，不直接读 memory.json。 */
  const readContextForVoice = async (
    petId: string,
  ): Promise<
    | {
        ok: true;
        summary: string;
        messages: ChatMemoryMessage[];
        compressions: number;
        summarizedCount: number;
      }
    | { ok: false; reason: 'unknown-pet'; message: string }
  > => {
    const cfg = readAllConfig(configPaths);
    const found = findPetInstance(cfg, petId);
    if (!found) return { ok: false, reason: 'unknown-pet', message: '没有这只桌宠：' + petId };
    const mem = await readMemory();
    const entry = mem[found.entry]?.[petId];
    const state = contextStateOf(entry ?? { messages: [] });
    const keep = contextKeep(found.conf);
    const messages = (entry?.messages ?? []).slice(state.summarizedCount).slice(-keep * 2);
    return {
      ok: true,
      summary: state.summary,
      messages,
      compressions: state.compressions,
      summarizedCount: state.summarizedCount,
    };
  };

  /** 当前活跃宠物 id（会话事件写入，余额与碎念读取）。 */
  const getActivePetId = (): string => activePetId;

  /** 改写当前活跃宠物 id。 */
  const setActivePetId = (id: string): void => {
    activePetId = id;
  };
  return {
    lastWhisperAt,
    memoryPath,
    readMemory,
    memoryRounds,
    publishWhisper,
    chatWithPet,
    deleteHistory,
    getContext,
    compressContext,
    appendMessage,
    readContextForVoice,
    getEmotion,
    resetEmotion,
    emotionPath,
    usage,
    getActivePetId,
    setActivePetId,
  };
}
/** 对话与记忆的产出（供下游工厂按需 Pick）。 */
export type ChatMemory = ReturnType<typeof createChatMemory>;
