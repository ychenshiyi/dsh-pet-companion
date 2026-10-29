import assert from 'node:assert/strict';
import test from 'node:test';

import { bm25Search, retrievalBlock } from './retrieval.ts';
import type { ChatMemoryMessage } from '../chat.ts';

const docs: ChatMemoryMessage[] = [
  { role: 'user', content: '我叫小明，我的生日是五月一日', ts: 1 },
  { role: 'user', content: '今天下班后去吃了火锅', ts: 2 },
  { role: 'assistant', content: '主人喜欢猫', ts: 3 },
  { role: 'user', content: '明天要去公司开会', ts: 4 },
];

test('BM25 能找回相关旧对话', () => {
  const hits = bm25Search(docs, '小明生日是什么时候', 2);
  assert.ok(hits.length >= 1);
  assert.match(hits[0].message.content, /小明|生日/);
});

test('BM25 查询为空/无命中时返回空', () => {
  assert.deepEqual(bm25Search(docs, '', 3), []);
  assert.deepEqual(bm25Search(docs, '量子力学', 3), []);
});

test('检索块带来源角色且限制长度', () => {
  const block = retrievalBlock(bm25Search(docs, '火锅', 3), 200);
  assert.match(block, /可能相关的旧对话/);
  assert.match(block, /火锅/);
  assert.ok(block.length <= 220);
});
