import assert from 'node:assert/strict';
import test from 'node:test';

import { isQuietNow, readRuntimePolicy } from './policy.ts';

test('安静时段支持跨午夜', () => {
  assert.equal(isQuietNow(new Date('2026-10-28T23:30:00'), '23:00', '08:00'), true);
  assert.equal(isQuietNow(new Date('2026-10-28T07:30:00'), '23:00', '08:00'), true);
  assert.equal(isQuietNow(new Date('2026-10-28T12:00:00'), '23:00', '08:00'), false);
  assert.equal(isQuietNow(new Date('2026-10-28T12:00:00'), '12:00', '12:00'), false);
});

test('缺配置时主动关心默认关闭', () => {
  const policy = readRuntimePolicy('Z:/definitely-missing-dsh-pet-home');
  assert.equal(policy.proactive.enabled, false);
  assert.equal(policy.focus.enabled, false);
});
