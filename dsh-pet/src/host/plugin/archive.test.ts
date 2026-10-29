import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { archiveOverflow, readArchive } from './archive.ts';
import type { ChatMemoryMessage } from '../chat.ts';

function messages(count: number): ChatMemoryMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `消息 ${i}`,
    ts: 1000 + i,
  }));
}

test('全文超过上限时移入归档，摘要前缀同步缩短', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-archive-'));
  try {
    const bucket = { messages: messages(105), context: { summary: '旧摘要', summarizedCount: 50 } as never };
    const result = await archiveOverflow('main', 'main', bucket, { dir, maxMessages: 100 });
    assert.equal(result.removed, 5);
    assert.equal(bucket.messages.length, 100);
    assert.equal((bucket.context as { summarizedCount: number }).summarizedCount, 45);
    const archived = await readArchive(dir, 'main', 'main');
    assert.equal(archived.length, 5);
    assert.equal(archived[0].content, '消息 0');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('未超上限不归档', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-archive-'));
  try {
    const bucket = { messages: messages(3) };
    const result = await archiveOverflow('main', 'main', bucket, { dir, maxMessages: 100 });
    assert.equal(result.removed, 0);
    assert.equal(bucket.messages.length, 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
