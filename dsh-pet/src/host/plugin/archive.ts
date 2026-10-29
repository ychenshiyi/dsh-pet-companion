/**
 * 全文归档：memory.json 只保留最近 N 条原文，超出的旧消息移动到 archive/*.jsonl。
 *
 * 归档只追加、不参与 prompt；上下文摘要仍由 memory.context 维护。这样磁盘不会无限膨胀，
 * 同时旧原话仍可导出/检索。
 *
 * @module dsh-pet/src/host/plugin/archive
 */
import { appendFile, mkdir, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { ChatMemoryMessage } from '../chat.ts';
import type { MemoryBucket } from './summary.ts';

export interface ArchiveTarget {
  /** 归档根目录，例如 conversations/archive。 */
  readonly dir: string;
  /** 单只宠物在 memory.json 里最多保留多少条。 */
  readonly maxMessages: number;
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80) || 'main';
}

export function archivePath(dir: string, entry: string, petId: string): string {
  return join(dir, safeName(entry), safeName(petId) + '.jsonl');
}

/**
 * 把超出上限的旧消息移动到归档文件，返回是否发生了移动。
 * 不写 memory.json：调用方在同一个串行队列里写。
 */
export async function archiveOverflow(
  entry: string,
  petId: string,
  bucket: MemoryBucket,
  target: ArchiveTarget,
): Promise<{ removed: number; file?: string }> {
  const max = Math.max(100, Math.floor(target.maxMessages));
  const overflow = bucket.messages.length - max;
  if (overflow <= 0) return { removed: 0 };
  const moved = bucket.messages.splice(0, overflow);
  const file = archivePath(target.dir, entry, petId);
  await mkdir(join(target.dir, safeName(entry)), { recursive: true });
  const now = Date.now();
  const lines = moved.map((message) => JSON.stringify({ ...message, petId, entry, archivedAt: now }));
  await appendFile(file, lines.join('\n') + '\n', 'utf8');
  // 前缀被移走后，摘要的前缀长度也要同步缩短；summary 本身仍然覆盖这些旧内容。
  if (bucket.context) {
    bucket.context.summarizedCount = Math.max(0, bucket.context.summarizedCount - moved.length);
  }
  return { removed: moved.length, file };
}

/** 读取某只宠物的全部归档消息（旧→新）。坏行跳过，不影响对话。 */
export async function readArchive(dir: string, entry: string, petId: string): Promise<ChatMemoryMessage[]> {
  let raw: string;
  try {
    raw = await readFile(archivePath(dir, entry, petId), 'utf8');
  } catch {
    return [];
  }
  const messages: ChatMemoryMessage[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line) as { role?: unknown; content?: unknown; ts?: unknown };
      if (
        (value.role === 'user' || value.role === 'assistant') &&
        typeof value.content === 'string' &&
        Number.isFinite(Number(value.ts))
      ) {
        messages.push({ role: value.role, content: value.content, ts: Number(value.ts) });
      }
    } catch {
      /* 跳过坏行 */
    }
  }
  return messages;
}

/** 设置页/诊断：列出归档目录；不存在返回空。 */
export async function listArchiveFiles(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir, { recursive: true })).filter((name) => name.endsWith('.jsonl'));
  } catch {
    return [];
  }
}
