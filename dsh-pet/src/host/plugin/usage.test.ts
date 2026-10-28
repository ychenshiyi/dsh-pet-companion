import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createUsageStore } from './usage.ts';

test('用量账本按今日/端/调用聚合', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-usage-'));
  try {
    const store = createUsageStore(join(dir, 'usage.jsonl'));
    await store.record({ ts: Date.now(), petId: 'main', surface: 'text', inputTokens: 100, outputTokens: 20 });
    await store.record({ ts: Date.now(), petId: 'main', surface: 'voice', inputTokens: 30, outputTokens: 10 });
    const summary = await store.summary(1);
    assert.equal(summary.today.input, 130);
    assert.equal(summary.today.output, 30);
    assert.equal(summary.today.calls, 2);
    assert.equal(summary.bySurface.text.input, 100);
    assert.equal(summary.bySurface.voice.output, 10);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
