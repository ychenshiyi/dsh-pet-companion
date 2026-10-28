/**
 * 情感养成 v1：关系状态 + 情节/事实记忆 + 轻量反思。
 *
 * 只落一个 JSON（默认跟 memory.json 同目录），不引入向量库；文本与语音共用。
 * 原则：数值透明、可重置、可关闭；不做付费加速/成瘾机制。
 * @module dsh-pet/src/host/plugin/emotion
 */
import { readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export type Mood = 'happy' | 'calm' | 'shy' | 'sad' | 'angry' | 'tired';

export interface Episode {
  ts: number;
  summary: string;
  emotion: Mood;
  weight: number;
}

export interface Fact {
  ts: number;
  text: string;
  confidence: number;
}

export interface EmotionState {
  affection: number;
  trust: number;
  familiarity: number;
  energy: number;
  mood: Mood;
  /** 最近一次用户情绪（语音/文本转写后的情感判断）。 */
  userMood: Mood;
  turns: number;
  episodes: Episode[];
  facts: Fact[];
  insights: string[];
  updatedAt: number;
}

export interface EmotionFile {
  [entry: string]: { [petId: string]: EmotionState };
}

const MAX_EPISODES = 120;
const MAX_FACTS = 60;
const MAX_INSIGHTS = 40;

export function defaultEmotion(): EmotionState {
  return {
    affection: 20,
    trust: 15,
    familiarity: 10,
    energy: 80,
    mood: 'calm',
    userMood: 'calm',
    turns: 0,
    episodes: [],
    facts: [],
    insights: [],
    updatedAt: 0,
  };
}

const clamp = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));

const POSITIVE = ['喜欢', '爱', '谢谢', '开心', '高兴', '可爱', '厉害', '棒', '好耶', '抱抱', '亲亲', '想你', '辛苦了'];
const NEGATIVE = ['讨厌', '滚', '烦', '生气', '难过', '伤心', '哭', '累', '分手', '别烦', '闭嘴', '失望'];
const ANGER = ['滚', '烦', '生气', '闭嘴', '讨厌你'];

function countHits(text: string, words: readonly string[]): number {
  let hits = 0;
  for (const word of words) if (text.includes(word)) hits += 1;
  return hits;
}

function moodOf(state: EmotionState, positive: number, negative: number): Mood {
  if (state.energy <= 20) return 'tired';
  if (negative > 0) return 'sad';
  if (state.affection >= 70 && state.trust >= 55) return 'happy';
  if (state.affection >= 45 && state.trust < 35) return 'shy';
  if (positive > 0) return 'happy';
  return 'calm';
}

function extractFacts(text: string): string[] {
  const found: string[] = [];
  const patterns: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
    [/我(?:最)?喜欢([^，。！？!?\s]{1,20})/u, (m) => `喜欢${m[1]}`],
    [/我(?:不喜欢|讨厌)([^，。！？!?\s]{1,20})/u, (m) => `不喜欢${m[1]}`],
    [/我(?:叫|名字是)([^，。！？!?\s]{1,12})/u, (m) => `名字是${m[1]}`],
    [/我的?生日是?([0-9]{1,2}月[0-9]{1,2}日?|[^，。！？!?\s]{1,16})/u, (m) => `生日是${m[1]}`],
    [/我(?:住在|家在)([^，。！？!?\s]{1,20})/u, (m) => `住在${m[1]}`],
  ];
  for (const [re, format] of patterns) {
    const match = text.match(re);
    if (match) found.push(format(match));
  }
  return found;
}

function summarize(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > 80 ? `${clean.slice(0, 78)}…` : clean;
}

/** 一轮对话后的状态变化（纯函数，方便测试）。 */
export function applyEmotionTurn(state: EmotionState, userText: string, replyText: string): EmotionState {
  const text = userText.trim();
  const positive = countHits(text, POSITIVE);
  const negative = countHits(text, NEGATIVE);
  const angry = countHits(text, ANGER) > 0;
  const next: EmotionState = {
    ...state,
    affection: clamp(state.affection + (positive > 0 ? 2 : 0) - (negative > 0 ? 3 : 0)),
    trust: clamp(state.trust + (positive > 0 ? 1 : 0) - (negative > 0 ? 2 : 0)),
    familiarity: clamp(state.familiarity + 1),
    energy: clamp(state.energy - (negative > 0 ? 3 : 1)),
    turns: state.turns + 1,
    episodes: [...state.episodes],
    facts: [...state.facts],
    insights: [...state.insights],
    updatedAt: Date.now(),
  };
  if (angry) {
    next.affection = clamp(next.affection - 2);
  }
  next.mood = moodOf(next, positive, negative);
  if (angry) next.mood = 'angry';
  next.userMood = angry ? 'angry' : negative > 0 ? 'sad' : positive > 0 ? 'happy' : 'calm';

  const important = text.length >= 20 || positive > 0 || negative > 0 || /生日|名字|喜欢|讨厌|分手|工作|学校/.test(text);
  if (important && text) {
    next.episodes.push({
      ts: Date.now(),
      summary: summarize(text),
      emotion: next.mood,
      weight: positive + negative > 0 ? 2 : 1,
    });
    if (next.episodes.length > MAX_EPISODES) next.episodes.splice(0, next.episodes.length - MAX_EPISODES);
  }

  for (const fact of extractFacts(text)) {
    if (next.facts.some((item) => item.text === fact)) continue;
    next.facts.push({ ts: Date.now(), text: fact, confidence: 0.7 });
    if (next.facts.length > MAX_FACTS) next.facts.splice(0, next.facts.length - MAX_FACTS);
  }

  // 轻量反思：每 6 个情节或 12 轮记一条成长日志（不做 LLM 调用，v1 可解释）
  if (next.episodes.length > 0 && (next.episodes.length % 6 === 0 || next.turns % 12 === 0)) {
    const recent = next.episodes.slice(-6);
    const moodCount = new Map<Mood, number>();
    for (const episode of recent) moodCount.set(episode.emotion, (moodCount.get(episode.emotion) ?? 0) + 1);
    const topMood = [...moodCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'calm';
    const fact = next.facts.length > 0 ? next.facts[next.facts.length - 1]?.text : undefined;
    const insight = `最近${recent.length}段对话里，情绪多为「${topMood}」${fact ? `，还记得：${fact}` : ''}。`;
    if (!next.insights.includes(insight)) {
      next.insights.push(insight);
      if (next.insights.length > MAX_INSIGHTS) next.insights.splice(0, next.insights.length - MAX_INSIGHTS);
    }
  }

  // replyText 目前只用于触发/调试，不参与打分（防止宠物自己说自己开心就加好感）
  void replyText;
  return next;
}

/** 记忆衰减：旧情节权重与事实置信度按 30 天半衰期衰减，过低的丢弃；不删最近 1 天。 */
export function decayEmotion(state: EmotionState, now = Date.now()): EmotionState {
  const ageDays = Math.max(0, (now - (state.updatedAt || now)) / 86_400_000);
  if (ageDays < 1) return state;
  const factor = Math.exp(-ageDays / 30);
  return {
    ...state,
    episodes: state.episodes
      .map((episode) => ({ ...episode, weight: episode.weight * factor }))
      .filter((episode) => episode.weight >= 0.15)
      .slice(-MAX_EPISODES),
    facts: state.facts
      .map((fact) => ({ ...fact, confidence: fact.confidence * factor }))
      .filter((fact) => fact.confidence >= 0.2)
      .slice(-MAX_FACTS),
  };
}

/** 注入 system 的关系提示；关闭情感时由调用方跳过。 */
export function emotionPrompt(state: EmotionState): string {
  const moodLabel: Record<Mood, string> = {
    happy: '开心',
    calm: '平静',
    shy: '有点害羞',
    sad: '低落',
    angry: '有点生气',
    tired: '疲惫',
  };
  const facts = state.facts.slice(-5).map((fact) => fact.text);
  return [
    '【关系状态】',
    `好感 ${state.affection}/100，信任 ${state.trust}/100，熟悉 ${state.familiarity}/100，精力 ${state.energy}/100，当前心情：${moodLabel[state.mood]}。`,
    '请自然体现这层关系：熟悉度低时礼貌一点；好感/信任高时更亲近；心情低落或疲惫时不要强行活泼。',
    facts.length > 0 ? `【已知事实】${facts.join('；')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** 心情 → 已有动画名（不新增素材；找不到就不播）。 */
export function moodAnim(mood: Mood): string | undefined {
  const map: Record<Mood, string | undefined> = {
    happy: '点击回应-开心跃动',
    shy: '点击回应-害羞惊讶',
    angry: '点击回应-傲娇生气',
    sad: '碎碎念-发呆碎碎念',
    tired: '打瞌睡被惊醒',
    calm: undefined,
  };
  return map[mood];
}

export interface EmotionStore {
  readonly file: string;
  read(entry: string, petId: string): Promise<EmotionState>;
  write(entry: string, petId: string, state: EmotionState): Promise<void>;
  apply(entry: string, petId: string, userText: string, replyText: string): Promise<EmotionState>;
  reset(entry: string, petId: string): Promise<EmotionState>;
}

export function createEmotionStore(file: string): EmotionStore {
  let queue: Promise<void> = Promise.resolve();
  const withLock = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn);
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
  const readFileData = async (): Promise<EmotionFile> => {
    try {
      const raw = await readFile(file, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as EmotionFile) : {};
    } catch {
      return {};
    }
  };
  const writeFileData = async (data: EmotionFile): Promise<void> => {
    const temp = join(dirname(file), `.emotion.${process.pid}.${Date.now()}.tmp`);
    await writeFile(temp, JSON.stringify(data, null, 2), 'utf8');
    await rename(temp, file);
  };
  return {
    file,
    async read(entry, petId) {
      const data = await readFileData();
      return decayEmotion({ ...defaultEmotion(), ...(data[entry]?.[petId] ?? {}) });
    },
    async write(entry, petId, state) {
      await withLock(async () => {
        const data = await readFileData();
        (data[entry] ??= {})[petId] = state;
        await writeFileData(data);
      });
    },
    async apply(entry, petId, userText, replyText) {
      return withLock(async () => {
        const data = await readFileData();
        const current = decayEmotion({ ...defaultEmotion(), ...(data[entry]?.[petId] ?? {}) });
        const next = applyEmotionTurn(current, userText, replyText);
        (data[entry] ??= {})[petId] = next;
        await writeFileData(data);
        return next;
      });
    },
    async reset(entry, petId) {
      return withLock(async () => {
        const data = await readFileData();
        const next = defaultEmotion();
        (data[entry] ??= {})[petId] = next;
        await writeFileData(data);
        return next;
      });
    },
  };
}
