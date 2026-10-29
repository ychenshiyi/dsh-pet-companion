/**
 * 对话上下文压缩的纯逻辑：不读写文件、不调用模型，只算 token/摘要元数据。
 *
 * 约定：`messages` 永远是全文归档；`context.summary` 只保存被压缩掉的旧对话摘要，
 * `summarizedCount` 指向 messages 中已进入摘要的前缀长度。这样文本与语音共用同一份
 * memory.json，也能各自按同一套规则拼 prompt。
 *
 * @module dsh-pet/src/host/plugin/summary
 */
import type { ChatMemoryMessage } from '../chat.ts';

export interface ContextState {
  /** 旧对话的滚动摘要；空串 = 还没压缩过。 */
  summary: string;
  /** messages 中前多少条已经进入 summary（前缀长度）。 */
  summarizedCount: number;
  /** 累计压缩次数；达到提醒阈值时提醒。 */
  compressions: number;
  /** 最近一次压缩时间。 */
  lastCompressedAt: number;
  /** 约省下的 token 数（估算）。 */
  tokensSaved: number;
  /** 上一次「压缩次数提醒」对应的 compressions，防止每轮重复提醒。 */
  remindedAt: number;
}

export interface MemoryBucket {
  messages: ChatMemoryMessage[];
  context?: ContextState;
}

export function defaultContextState(): ContextState {
  return {
    summary: '',
    summarizedCount: 0,
    compressions: 0,
    lastCompressedAt: 0,
    tokensSaved: 0,
    remindedAt: 0,
  };
}

export function contextStateOf(bucket: MemoryBucket): ContextState {
  const raw = bucket.context;
  if (!raw || typeof raw !== 'object') return defaultContextState();
  return {
    summary: typeof raw.summary === 'string' ? raw.summary : '',
    summarizedCount: Number.isFinite(raw.summarizedCount) ? Math.max(0, Math.floor(raw.summarizedCount)) : 0,
    compressions: Number.isFinite(raw.compressions) ? Math.max(0, Math.floor(raw.compressions)) : 0,
    lastCompressedAt: Number.isFinite(raw.lastCompressedAt) ? raw.lastCompressedAt : 0,
    tokensSaved: Number.isFinite(raw.tokensSaved) ? Math.max(0, raw.tokensSaved) : 0,
    remindedAt: Number.isFinite(raw.remindedAt) ? Math.max(0, raw.remindedAt) : 0,
  };
}

/** 粗估 token：中文按 1.5 字/token，英文按 4 字符/token；不追求 tokenizer 精度，只用于预算。 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  let other = 0;
  for (const char of text) {
    if (/[\u3400-\u9fff\uf900-\ufaff]/.test(char)) cjk += 1;
    else other += 1;
  }
  return Math.ceil(cjk / 1.5 + other / 4);
}

/** 把消息数组估算成 token。 */
export function estimateMessages(messages: readonly ChatMemoryMessage[]): number {
  return messages.reduce((sum, message) => sum + estimateTokens(message.content), 0);
}

/** prompt 里可读的摘要块；没有摘要返回空串。 */
export function summaryBlock(summary: string): string {
  const clean = summary.trim();
  if (!clean) return '';
  return `【长期对话摘要】\n${clean}`;
}

/** 压缩后更新元数据；不碰 messages。 */
export function applyCompression(
  state: ContextState,
  summary: string,
  summarizedCount: number,
  savedTokens: number,
  now = Date.now(),
): ContextState {
  return {
    ...state,
    summary,
    summarizedCount: Math.max(0, summarizedCount),
    compressions: state.compressions + 1,
    lastCompressedAt: now,
    tokensSaved: state.tokensSaved + Math.max(0, Math.round(savedTokens)),
  };
}

/** 是否该提醒：达到阈值且这次压缩数还没提醒过。 */
export function shouldRemind(state: ContextState, every: number): boolean {
  if (every <= 0) return false;
  return state.compressions >= every && state.remindedAt < state.compressions;
}
