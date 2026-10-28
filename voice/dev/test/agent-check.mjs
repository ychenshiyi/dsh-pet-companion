/**
 * 语音 Agent 验收：进 pet-room → 等 Agent 自动加入 → 确认收到 Agent 的语音问候
 *
 * 只验证“房间 + 分派 + TTS 出声”这一段；STT/LLM 由 agent/smoke_test.py 覆盖。
 * 用法：node dev/test/agent-check.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = dirname(fileURLToPath(import.meta.url));
const ARTIFACTS = join(HERE, 'artifacts');
const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:7890/';
const ROOM = process.env.ROOM ?? 'pet-room';
const CHROME = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
function check(label, pass, detail = '') {
  checks.push({ label, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
}
const snapshot = (page) => page.evaluate(() => window.__lkTest.snapshot());

await mkdir(ARTIFACTS, { recursive: true });
const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
    '--no-sandbox',
  ],
});
const ctx = await browser.newContext({ permissions: ['microphone'] });
const page = await ctx.newPage();
page.on('console', (msg) => {
  if (msg.type() === 'error') console.log(`[console] ${msg.text()}`);
});
page.on('pageerror', (err) => console.log(`[pageerror] ${err.message}`));

try {
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.fill('#room', ROOM);
  await page.fill('#identity', 'tester');
  await page.click('#join');
  await page.waitForFunction(() => window.__lkTest?.snapshot().connected === 'connected', null, {
    timeout: 20000,
  });
  check('进入房间并连上 LiveKit', true, ROOM);

  await page.waitForFunction(
    () => window.__lkTest.snapshot().participants.some((p) => p.kind === 'agent' || /^agent[-_]/i.test(p.identity)),
    null,
    { timeout: 40000 },
  );
  const snap = await snapshot(page);
  const agent = snap.participants.find((p) => p.kind === 'agent' || /^agent[-_]/i.test(p.identity));
  check('语音 Agent 自动加入房间', Boolean(agent), agent ? agent.identity : '未发现');

  // 等待 Agent 的 TTS 问候音轨 + 非零音量（Edge TTS 合成较慢，给足时间）
  let peak = 0;
  let last = null;
  for (let i = 0; i < 160; i += 1) {
    last = await snapshot(page);
    for (const v of Object.values(last.remoteVolumes)) peak = Math.max(peak, Number(v) || 0);
    if (peak > 0 && last.remoteAudioTracks.length > 0) break;
    await sleep(250);
  }
  check('收到 Agent 的音频轨道', (last?.remoteAudioTracks.length ?? 0) > 0, JSON.stringify(last?.remoteAudioTracks));
  check('Agent 声音有音量（TTS 在说话）', peak > 0, `峰值 ${peak}%`);

  await page.screenshot({ path: join(ARTIFACTS, 'agent-greeting.png'), fullPage: true });
  await writeFile(
    join(ARTIFACTS, 'agent-report.json'),
    JSON.stringify({ when: new Date().toISOString(), room: ROOM, checks, last }, null, 2),
    'utf8',
  );
} catch (error) {
  check('执行过程中出现异常', false, error?.message ?? String(error));
  try {
    await page.screenshot({ path: join(ARTIFACTS, 'agent-failure.png'), fullPage: true });
  } catch {}
} finally {
  await browser.close();
}

const failed = checks.filter((c) => !c.pass);
console.log(`\n结果：${checks.length - failed.length}/${checks.length} 通过` + (failed.length ? '，存在失败项' : ' ✔'));
process.exit(failed.length ? 1 : 0);
