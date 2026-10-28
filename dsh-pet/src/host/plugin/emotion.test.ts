import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEmotionTurn, decayEmotion, defaultEmotion, emotionPrompt, moodAnim } from './emotion.ts';

test('正向对话提升好感/信任并进入开心', () => {
  const next = applyEmotionTurn(defaultEmotion(), '谢谢你，今天很开心，我很喜欢你', '我也开心');
  assert.equal(next.mood, 'happy');
  assert.ok(next.affection > 20);
  assert.ok(next.trust > 15);
  assert.equal(next.episodes.length, 1);
  assert.equal(moodAnim('happy'), '点击回应-开心跃动');
});

test('负向对话降低好感并进入低落/生气', () => {
  const sad = applyEmotionTurn(defaultEmotion(), '今天很难过，想哭', '抱抱');
  assert.equal(sad.mood, 'sad');
  assert.ok(sad.affection < 20);
  const angry = applyEmotionTurn(defaultEmotion(), '你好烦，闭嘴', '……');
  assert.equal(angry.mood, 'angry');
});

test('从自述里抽取事实并去重', () => {
  const once = applyEmotionTurn(defaultEmotion(), '我叫小明，我的生日是5月1日', '记住啦');
  assert.deepEqual(once.facts.map((fact) => fact.text).sort(), ['名字是小明', '生日是5月1日'].sort());
  const twice = applyEmotionTurn(once, '我叫小明', '嗯');
  assert.equal(twice.facts.filter((fact) => fact.text === '名字是小明').length, 1);
});

test('关系提示词包含数值、心情与事实，且可关闭', () => {
  const state = applyEmotionTurn(defaultEmotion(), '我喜欢猫', '喵');
  const prompt = emotionPrompt(state);
  assert.match(prompt, /好感 \d+\/100/);
  assert.match(prompt, /心情/);
  assert.match(prompt, /喜欢猫/);
});

test('记忆衰减：旧情节权重与低置信事实被淘汰', () => {
  const now = Date.now();
  const old = {
    ...defaultEmotion(),
    updatedAt: now - 90 * 86_400_000,
    episodes: [{ ts: now - 90 * 86_400_000, summary: '旧事', emotion: 'calm' as const, weight: 1 }],
    facts: [{ ts: now - 90 * 86_400_000, text: '旧事实', confidence: 0.5 }],
  };
  const decayed = decayEmotion(old, now);
  assert.equal(decayed.episodes.length, 0);
  assert.equal(decayed.facts.length, 0);
});
