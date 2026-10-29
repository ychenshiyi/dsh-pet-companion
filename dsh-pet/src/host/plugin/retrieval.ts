/**
 * 轻量旧对话检索：纯本地 BM25，不依赖 embedding/网络。
 *
 * 归档与 memory 的旧消息都可以作为文档；只把少数相关片段拼进 prompt，帮助找回
 * 摘要/最近窗口之外的细节。
 *
 * @module dsh-pet/src/host/plugin/retrieval
 */
import type { ChatMemoryMessage } from '../chat.ts';

export interface RetrievalHit {
  message: ChatMemoryMessage;
  score: number;
}

const STOPWORDS = new Set([
  '的',
  '了',
  '是',
  '在',
  '我',
  '你',
  '他',
  '她',
  '它',
  '和',
  '就',
  '都',
  '也',
  '很',
  '还',
  '有',
  '吗',
  '呢',
  '啊',
  '吧',
  '这',
  '那',
  '一个',
  '什么',
  '怎么',
  '为什么',
]);

function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const normalized = text.toLowerCase();
  // 英文/数字按词
  for (const word of normalized.match(/[a-z0-9_]+/g) ?? []) {
    if (!STOPWORDS.has(word) && word.length >= 2) tokens.push(word);
  }
  // 中文：单字 + 相邻二元组（不引入分词依赖，BM25 足够召回）
  for (const run of normalized.match(/[\u3400-\u9fff\uf900-\ufaff]+/g) ?? []) {
    for (let i = 0; i < run.length; i += 1) {
      const char = run[i];
      if (!STOPWORDS.has(char)) tokens.push(char);
      if (i + 1 < run.length) tokens.push(run.slice(i, i + 2));
    }
  }
  return tokens;
}

/**
 * BM25 排序。返回 score > 0 的 topK；文档太少/查询为空时返回空数组。
 */
export function bm25Search(messages: readonly ChatMemoryMessage[], query: string, topK = 3): RetrievalHit[] {
  const q = tokenize(query);
  if (q.length === 0 || messages.length === 0 || topK <= 0) return [];
  const docs = messages.map((message) => tokenize(message.content));
  const N = docs.length;
  const avgLen = docs.reduce((sum, tokens) => sum + tokens.length, 0) / Math.max(1, N);
  const df = new Map<string, number>();
  for (const tokens of docs) {
    for (const token of new Set(tokens)) df.set(token, (df.get(token) ?? 0) + 1);
  }
  const k1 = 1.2;
  const b = 0.75;
  const hits: RetrievalHit[] = [];
  for (let i = 0; i < docs.length; i += 1) {
    const tokens = docs[i];
    if (tokens.length === 0) continue;
    const tf = new Map<string, number>();
    for (const token of tokens) tf.set(token, (tf.get(token) ?? 0) + 1);
    let score = 0;
    for (const term of new Set(q)) {
      const freq = tf.get(term) ?? 0;
      if (freq === 0) continue;
      const n = df.get(term) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      const denom = freq + k1 * (1 - b + b * (tokens.length / Math.max(1, avgLen)));
      score += idf * ((freq * (k1 + 1)) / denom);
    }
    if (score > 0) hits.push({ message: messages[i], score });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, Math.floor(topK));
}

/** 把命中片段拼成 prompt 块；最多 maxChars 字符。 */
export function retrievalBlock(hits: readonly RetrievalHit[], maxChars = 1200): string {
  if (hits.length === 0) return '';
  const lines = hits.map((hit) => `${hit.message.role === 'user' ? '主人' : '桌宠'}：${hit.message.content}`);
  const text = lines.join('\n');
  return `【可能相关的旧对话】\n${text.slice(0, Math.max(200, maxChars))}`;
}
