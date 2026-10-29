/**
 * 伴侣设置中心的数据模型：模型服务商、语音、对话与 LiveKit 的本机配置。
 *
 * 密钥单独存 `companion-secrets.json`（ACL 仅当前用户），公开视图只回 hasKey；
 * `companion.json` 只放非敏感配置。写入一律原子替换。
 * @module dsh-pet/src/app/companion/config
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

import { writePrivateJson } from '../../standalone/ai-storage.ts';

/** 设置中心用到的路径。 */
export interface CompanionPaths {
  petHome: string;
  configFile: string;
  secretsFile: string;
  logsFile: string;
}

const ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const ROOM_RE = /^[A-Za-z0-9_-]{1,64}$/;

function safeUrl(value: string): boolean {
  if (!value) return true;
  try {
    const url = new URL(value);
    return (
      ['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

const providerSchema = z.object({
  id: z.string().regex(ID_RE),
  name: z.string().trim().min(1).max(64),
  protocol: z.enum(['openai-compatible', 'anthropic']),
  baseUrl: z.string().max(2048).refine(safeUrl),
  model: z.string().trim().max(200),
  temperature: z.number().min(0).max(2),
  maxTokens: z.number().int().min(64).max(8192),
  enabled: z.boolean(),
  /** 仅入参：空/缺省表示保留已保存密钥。 */
  apiKey: z.string().max(4096).optional(),
  clearKey: z.boolean().optional(),
});

const voiceSchema = z.object({
  engine: z.enum(['edge', 'melo']),
  voice: z.string().max(200),
  rate: z.string().max(16),
  pitch: z.string().max(16),
  volume: z.string().max(16),
  sttLanguage: z.string().max(16),
  /** 超过空闲秒数后，下一句需要包含唤醒词才进入对话。 */
  wakeWord: z.string().trim().min(1).max(16).optional().default('小鱼'),
  wakeIdleSeconds: z.number().int().min(3).max(120).optional().default(10),
  /** 语音对话代表哪只宠物（多宠物音色/人设）。 */
  activePetId: z.string().max(64).optional().default('main'),
  activePetName: z.string().max(64).optional().default('小鱼'),
  /** 低延迟模式：更积极的 VAD/端点、更短回复、启动预热 STT。 */
  lowLatency: z.boolean().optional().default(true),
});

const chatSchema = z.object({
  memoryDir: z.string().max(1024),
  rounds: z.number().int().min(0).max(50),
  /** 上下文 token 预算；超出后压缩旧对话。 */
  contextBudgetTokens: z.number().int().min(1500).max(32000).optional().default(6000),
  /** 达到预算的该比例时触发压缩。 */
  contextCompressAt: z.number().min(0.5).max(0.95).optional().default(0.75),
  /** 对话窗口始终保留的最近轮数（1 轮 = 1 问 1 答）。 */
  contextKeepRecentTurns: z.number().int().min(2).max(20).optional().default(6),
  /** 每累计多少次压缩提醒一次；0 = 关闭。 */
  contextRemindEvery: z.number().int().min(0).max(100).optional().default(5),
  /** memory.json 单只宠物最多保留多少条原文，超出移到 archive。 */
  archiveMaxMessages: z.number().int().min(100).max(20000).optional().default(2000),
  /** P3：BM25 检索旧对话。 */
  retrievalEnabled: z.boolean().optional().default(true),
  retrievalTopK: z.number().int().min(0).max(10).optional().default(3),
  retrievalMaxChars: z.number().int().min(200).max(4000).optional().default(1200),
});

const livekitSchema = z.object({
  mode: z.enum(['disabled', 'embedded', 'external']),
  port: z.number().int().min(1).max(65535),
  room: z.string().regex(ROOM_RE),
  url: z.string().max(2048).refine(safeUrl),
});

const emotionSchema = z.object({
  enabled: z.boolean(),
  /** 主动关心：P6 只留开关，默认关。 */
  proactive: z.boolean(),
});

const usageSchema = z.object({
  dailyLimit: z.number().int().min(0).max(10_000_000).optional().default(0),
  warnPercent: z.number().int().min(50).max(100).optional().default(80),
  /** 每 1k token 估算价格（元）；0 = 不估算。 */
  pricePer1k: z.number().min(0).max(1000).optional().default(0),
});

const proactiveSchema = z.object({
  enabled: z.boolean().optional().default(false),
  quietStart: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional()
    .default('23:00'),
  quietEnd: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional()
    .default('08:00'),
  dailyLimit: z.number().int().min(0).max(100).optional().default(2),
  minIntervalMinutes: z.number().int().min(5).max(1440).optional().default(120),
});

const focusSchema = z.object({
  enabled: z.boolean().optional().default(false),
  muteVoice: z.boolean().optional().default(false),
});

const petOverrideSchema = z.object({
  voice: z.string().max(200).optional(),
  persona: z.string().max(4000).optional(),
});

export const companionInputSchema = z
  .object({
    activeProviderId: z.string().regex(ID_RE),
    providers: z.array(providerSchema).min(1).max(8),
    voice: voiceSchema,
    chat: chatSchema,
    livekit: livekitSchema,
    emotion: emotionSchema.optional().default({ enabled: true, proactive: false }),
    usage: usageSchema.optional().default({ dailyLimit: 0, warnPercent: 80, pricePer1k: 0 }),
    proactive: proactiveSchema.optional(),
    focus: focusSchema.optional(),
    pets: z.record(z.string(), petOverrideSchema).optional().default({}),
  })
  .strict();

export type CompanionInput = z.infer<typeof companionInputSchema>;
export type ProviderSettings = Omit<z.infer<typeof providerSchema>, 'apiKey' | 'clearKey'> & { apiKey: string };
export type VoiceSettings = z.infer<typeof voiceSchema>;
export type ChatSettings = z.infer<typeof chatSchema>;
export type LivekitSettings = z.infer<typeof livekitSchema>;
export type EmotionSettings = z.infer<typeof emotionSchema>;
export type UsageSettings = z.infer<typeof usageSchema>;
export type ProactiveSettings = z.infer<typeof proactiveSchema>;
export type FocusSettings = z.infer<typeof focusSchema>;
export type PetOverride = z.infer<typeof petOverrideSchema>;

export interface CompanionSettings {
  version: 1;
  activeProviderId: string;
  providers: ProviderSettings[];
  voice: VoiceSettings;
  chat: ChatSettings;
  livekit: LivekitSettings;
  emotion: EmotionSettings;
  usage: UsageSettings;
  proactive: ProactiveSettings;
  focus: FocusSettings;
  pets: Record<string, PetOverride>;
}

export interface CompanionPublic {
  version: 1;
  activeProviderId: string;
  providers: Array<Omit<ProviderSettings, 'apiKey'> & { hasKey: boolean }>;
  voice: VoiceSettings;
  chat: ChatSettings;
  livekit: LivekitSettings;
  emotion: EmotionSettings;
  usage: UsageSettings;
  proactive: ProactiveSettings;
  focus: FocusSettings;
  pets: Record<string, PetOverride>;
  paths: CompanionPaths;
}

interface Secrets {
  version: 1;
  providerKeys: Record<string, string>;
}

function defaultSettings(petHome: string): CompanionSettings {
  return {
    version: 1,
    activeProviderId: 'deepseek',
    providers: [
      {
        id: 'deepseek',
        name: 'DeepSeek（默认）',
        protocol: 'openai-compatible',
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat',
        temperature: 0.7,
        maxTokens: 1024,
        enabled: true,
        apiKey: '',
      },
    ],
    voice: {
      engine: 'edge',
      voice: 'zh-CN-XiaoxiaoNeural',
      rate: '+0%',
      pitch: '+0Hz',
      volume: '+0%',
      sttLanguage: 'zh',
      wakeWord: '小鱼',
      wakeIdleSeconds: 10,
      activePetId: 'main',
      activePetName: '小鱼',
      lowLatency: true,
    },
    chat: {
      memoryDir: join(petHome, 'conversations'),
      rounds: 10,
      contextBudgetTokens: 6000,
      contextCompressAt: 0.75,
      contextKeepRecentTurns: 6,
      contextRemindEvery: 5,
      archiveMaxMessages: 2000,
      retrievalEnabled: true,
      retrievalTopK: 3,
      retrievalMaxChars: 1200,
    },
    livekit: { mode: 'embedded', port: 7880, room: 'pet-room', url: 'ws://127.0.0.1:7880' },
    emotion: { enabled: true, proactive: false },
    usage: { dailyLimit: 0, warnPercent: 80, pricePer1k: 0 },
    proactive: { enabled: false, quietStart: '23:00', quietEnd: '08:00', dailyLimit: 2, minIntervalMinutes: 120 },
    focus: { enabled: false, muteVoice: false },
    pets: {},
  };
}

function readJson(path: string): unknown | undefined {
  if (!existsSync(path)) return undefined;
  const text = readFileSync(path, 'utf8');
  if (text.length > 256 * 1024) throw new Error('配置文件过大');
  return JSON.parse(text) as unknown;
}

function ensureShape(value: unknown): CompanionSettings {
  const raw = value as Partial<CompanionSettings> | undefined;
  if (!raw || raw.version !== 1) throw new Error('不支持的配置版本');
  return raw as CompanionSettings;
}

/** 设置存储：读、公开视图、保存（含密钥合并与 legacy AI 同步素材）。 */
export interface CompanionStore {
  readonly paths: CompanionPaths;
  current(): CompanionSettings;
  publicView(): CompanionPublic;
  save(input: unknown): CompanionSettings;
  providerKey(id: string): string;
  activeProvider(): ProviderSettings | undefined;
}

export function createCompanionStore(petHome: string): CompanionStore {
  const paths: CompanionPaths = {
    petHome,
    configFile: join(petHome, 'companion.json'),
    secretsFile: join(petHome, 'companion-secrets.json'),
    logsFile: join(petHome, 'logs.txt'),
  };
  const fallback = defaultSettings(petHome);
  let settings: CompanionSettings = fallback;
  let secrets: Secrets = { version: 1, providerKeys: {} };

  try {
    const loaded = readJson(paths.configFile);
    if (loaded !== undefined) settings = ensureShape(loaded);
  } catch {
    settings = fallback;
  }
  try {
    const loaded = readJson(paths.secretsFile);
    if (loaded && typeof loaded === 'object' && (loaded as Secrets).version === 1) {
      secrets = loaded as Secrets;
    }
  } catch {
    secrets = { version: 1, providerKeys: {} };
  }
  // 密钥只在 secrets 文件里；内存中的 providers 补回 key 供 AI 同步使用。
  settings = {
    ...fallback,
    ...settings,
    voice: { ...fallback.voice, ...(settings.voice ?? {}) },
    emotion: { ...fallback.emotion, ...(settings.emotion ?? {}) },
    usage: { ...fallback.usage, ...(settings.usage ?? {}) },
    proactive: { ...fallback.proactive, ...(settings.proactive ?? {}) },
    focus: { ...fallback.focus, ...(settings.focus ?? {}) },
    pets: { ...fallback.pets, ...(settings.pets ?? {}) },
    providers: settings.providers.map((provider) => ({
      ...provider,
      apiKey: secrets.providerKeys[provider.id] ?? provider.apiKey ?? '',
    })),
  };

  const active = (): ProviderSettings | undefined =>
    settings.providers.find((provider) => provider.id === settings.activeProviderId);

  return {
    paths,
    current: () => settings,
    providerKey: (id) => secrets.providerKeys[id] ?? '',
    activeProvider: active,
    publicView() {
      return {
        version: 1,
        activeProviderId: settings.activeProviderId,
        providers: settings.providers.map(({ apiKey: _apiKey, ...rest }) => ({
          ...rest,
          hasKey: Boolean(secrets.providerKeys[rest.id]),
        })),
        voice: settings.voice,
        chat: settings.chat,
        livekit: settings.livekit,
        emotion: settings.emotion,
        usage: settings.usage,
        proactive: settings.proactive,
        focus: settings.focus,
        pets: settings.pets,
        paths,
      };
    },
    save(input) {
      const parsed = companionInputSchema.parse(input);
      if (new Set(parsed.providers.map((p) => p.id)).size !== parsed.providers.length) {
        throw new Error('服务商 id 不能重复');
      }
      if (!parsed.providers.some((p) => p.id === parsed.activeProviderId)) {
        throw new Error('当前服务商不存在');
      }
      const nextKeys = { ...secrets.providerKeys };
      const providers: ProviderSettings[] = parsed.providers.map((provider) => {
        const { apiKey, clearKey, ...rest } = provider;
        if (clearKey) delete nextKeys[provider.id];
        else if (apiKey && apiKey.trim()) nextKeys[provider.id] = apiKey.trim();
        const key = nextKeys[provider.id] ?? '';
        if (rest.enabled && (!rest.baseUrl || !rest.model || !key)) {
          throw new Error(`「${rest.name}」启用前需要 Base URL、模型与 API Key`);
        }
        return { ...rest, apiKey: key };
      });
      const next: CompanionSettings = {
        version: 1,
        activeProviderId: parsed.activeProviderId,
        providers,
        voice: parsed.voice,
        chat: parsed.chat,
        livekit: parsed.livekit,
        emotion: parsed.emotion,
        usage: parsed.usage,
        proactive: parsed.proactive ?? { ...fallback.proactive },
        focus: parsed.focus ?? { ...fallback.focus },
        pets: parsed.pets,
      };
      writePrivateJson(paths.configFile, {
        ...next,
        // 非敏感配置文件里绝不落密钥；密钥只在 companion-secrets.json
        providers: next.providers.map(({ apiKey: _apiKey, ...rest }) => rest),
      });
      secrets = { version: 1, providerKeys: nextKeys };
      writePrivateJson(paths.secretsFile, secrets);
      settings = next;
      return next;
    },
  };
}
