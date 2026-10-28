/**
 * 用量账本：JSONL 追加，文本/语音共用；只记 token 数，不记正文。
 *
 * 面板与配额提醒都从这里读；文件由 app 主进程通过 DSH_PET_USAGE_FILE 指定。
 */
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface UsageEvent {
  ts: number;
  petId: string;
  surface: 'text' | 'voice';
  inputTokens: number;
  outputTokens: number;
  model?: string;
}

export interface UsageSummary {
  today: { input: number; output: number; calls: number };
  total: { input: number; output: number; calls: number };
  bySurface: Record<'text' | 'voice', { input: number; output: number; calls: number }>;
  days: Array<{ day: string; input: number; output: number; calls: number }>;
}

const dayKey = (ts: number): string => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export interface UsageStore {
  readonly file: string;
  record(event: UsageEvent): Promise<void>;
  summary(days?: number): Promise<UsageSummary>;
}

export function createUsageStore(file: string): UsageStore {
  const empty = () => ({ input: 0, output: 0, calls: 0 });
  return {
    file,
    async record(event) {
      await mkdir(dirname(file), { recursive: true });
      await appendFile(file, JSON.stringify(event) + '\n', 'utf8');
    },
    async summary(days = 7) {
      const today = dayKey(Date.now());
      const summary: UsageSummary = {
        today: empty(),
        total: empty(),
        bySurface: { text: empty(), voice: empty() },
        days: [],
      };
      let raw: string;
      try {
        raw = await readFile(file, 'utf8');
      } catch {
        return summary;
      }
      const buckets = new Map<string, { input: number; output: number; calls: number }>();
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        let event: UsageEvent;
        try {
          event = JSON.parse(line) as UsageEvent;
        } catch {
          continue;
        }
        if (!Number.isFinite(event.ts)) continue;
        const input = Math.max(0, Number(event.inputTokens) || 0);
        const output = Math.max(0, Number(event.outputTokens) || 0);
        const surface = event.surface === 'voice' ? 'voice' : 'text';
        const day = dayKey(event.ts);
        const bucket = buckets.get(day) ?? empty();
        bucket.input += input;
        bucket.output += output;
        bucket.calls += 1;
        buckets.set(day, bucket);
        summary.total.input += input;
        summary.total.output += output;
        summary.total.calls += 1;
        summary.bySurface[surface].input += input;
        summary.bySurface[surface].output += output;
        summary.bySurface[surface].calls += 1;
        if (day === today) {
          summary.today.input += input;
          summary.today.output += output;
          summary.today.calls += 1;
        }
      }
      summary.days = [...buckets.entries()]
        .sort((a, b) => b[0].localeCompare(a[0]))
        .slice(0, Math.max(1, days))
        .map(([day, value]) => ({ day, ...value }));
      return summary;
    },
  };
}
