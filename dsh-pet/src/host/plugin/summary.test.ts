import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyCompression,
  contextStateOf,
  defaultContextState,
  estimateTokens,
  shouldRemind,
  summaryBlock,
} from './summary.ts';

test('上下文摘要与压缩计数正确更新', () => {
  const state = defaultContextState();
  const next = applyCompression(state, '主人喜欢猫。', 4, 120, 123);
  assert.equal(next.summary, '主人喜欢猫。');
  assert.equal(next.summarizedCount, 4);
  assert.equal(next.compressions, 1);
  assert.equal(next.tokensSaved, 120);
  assert.equal(next.lastCompressedAt, 123);
});

test('压缩次数达到阈值提醒，且同一计数只提醒一次', () => {
  const state = { ...defaultContextState(), compressions: 5 };
  assert.equal(shouldRemind(state, 5), true);
  assert.equal(shouldRemind({ ...state, remindedAt: 5 }, 5), false);
  assert.equal(shouldRemind(state, 0), false);
});

test('旧版桶没有 context 时返回默认值', () => {
  assert.deepEqual(contextStateOf({ messages: [] }), defaultContextState());
});

test('摘要块和 token 估算可用', () => {
  assert.match(summaryBlock('喜欢猫'), /长期对话摘要/);
  assert.equal(summaryBlock('  '), '');
  assert.ok(estimateTokens('你好世界') > 0);
});
