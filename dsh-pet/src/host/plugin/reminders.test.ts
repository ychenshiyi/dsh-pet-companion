import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createReminderStore } from './reminders.ts';

test('提醒：添加、到点取出、删除', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-reminder-'));
  try {
    const store = createReminderStore(join(dir, 'reminders.json'));
    const due = await store.add('喝水', Date.now() + 1000, 'main');
    assert.equal((await store.list()).length, 1);
    assert.deepEqual(await store.takeDue(Date.now()), []);
    const taken = await store.takeDue(Date.now() + 2000);
    assert.equal(taken.length, 1);
    assert.equal(taken[0].text, '喝水');
    assert.equal((await store.list()).length, 0);
    assert.equal(await store.remove(due.id), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
