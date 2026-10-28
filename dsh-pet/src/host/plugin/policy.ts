/** 运行时策略：从 companion.json 读主动关心 / 专注模式 / 配额；不缓存，改设置下一拍生效。 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ProactivePolicy {
  enabled: boolean;
  quietStart: string;
  quietEnd: string;
  dailyLimit: number;
  minIntervalMinutes: number;
}

export interface RuntimePolicy {
  proactive: ProactivePolicy;
  focus: { enabled: boolean; muteVoice: boolean };
  usage: { dailyLimit: number; warnPercent: number };
}

const DEFAULTS: RuntimePolicy = {
  proactive: {
    enabled: false,
    quietStart: '23:00',
    quietEnd: '08:00',
    dailyLimit: 2,
    minIntervalMinutes: 120,
  },
  focus: { enabled: false, muteVoice: false },
  usage: { dailyLimit: 0, warnPercent: 80 },
};

export function readRuntimePolicy(petHome: string): RuntimePolicy {
  const file = join(petHome, 'companion.json');
  if (!existsSync(file)) return DEFAULTS;
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    const proactive = (raw.proactive ?? {}) as Record<string, unknown>;
    const focus = (raw.focus ?? {}) as Record<string, unknown>;
    const usage = (raw.usage ?? {}) as Record<string, unknown>;
    return {
      proactive: {
        enabled: proactive.enabled === true,
        quietStart: String(proactive.quietStart ?? DEFAULTS.proactive.quietStart),
        quietEnd: String(proactive.quietEnd ?? DEFAULTS.proactive.quietEnd),
        dailyLimit: Math.max(0, Number(proactive.dailyLimit ?? DEFAULTS.proactive.dailyLimit) || 0),
        minIntervalMinutes: Math.max(
          5,
          Number(proactive.minIntervalMinutes ?? DEFAULTS.proactive.minIntervalMinutes) || 120,
        ),
      },
      focus: {
        enabled: focus.enabled === true,
        muteVoice: focus.muteVoice === true,
      },
      usage: {
        dailyLimit: Math.max(0, Number(usage.dailyLimit ?? 0) || 0),
        warnPercent: Math.min(100, Math.max(50, Number(usage.warnPercent ?? 80) || 80)),
      },
    };
  } catch {
    return DEFAULTS;
  }
}

const minutesOf = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
};

/** 安静时段（支持跨午夜）；start == end 视为全天不安静。 */
export function isQuietNow(now: Date, quietStart: string, quietEnd: string): boolean {
  const start = minutesOf(quietStart);
  const end = minutesOf(quietEnd);
  const current = now.getHours() * 60 + now.getMinutes();
  if (start === end) return false;
  return start < end ? current >= start && current < end : current >= start || current < end;
}
