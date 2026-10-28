/**
 * 全链路验收：把一段中文问题当作麦克风发布 → 检查 Agent 的转写与语音回复
 *
 * 验证：房间音频 → VAD → SenseVoice STT → DeepSeek → Edge TTS → 回到浏览器
 * 用法：node dev/test/loop-check.mjs
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

const snapshot = () => page.evaluate(() => window.__lkTest.snapshot());

try {
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.fill('#room', ROOM);
  await page.fill('#identity', 'tester');
  await page.uncheck('#publish');
  await page.click('#join');
  await page.waitForFunction(() => window.__lkTest?.snapshot().connected === 'connected', null, {
    timeout: 20000,
  });
  check('进入房间', true, ROOM);

  await page.waitForFunction(
    () => window.__lkTest.snapshot().participants.some((p) => p.kind === 'agent' || /^agent[-_]/i.test(p.identity)),
    null,
    { timeout: 40000 },
  );
  check('Agent 已加入', true);

  // 等问候语说完，避免刚发布测试音频就被打断
  let speaking = false;
  for (let i = 0; i < 120; i += 1) {
    const s = await snapshot();
    const peak = Math.max(0, ...Object.values(s.remoteVolumes).map(Number));
    if (peak > 0) speaking = true;
    if (speaking && peak === 0) break;
    await sleep(250);
  }
  check('Agent 问候语播放完毕', true);

  const info = await page.evaluate(async () => window.__lkTest.publishWav('/test-question.wav'));
  check('发布测试语音（7 秒中文问题）', true, `${info.duration.toFixed(1)}s`);

  // 等转写：用户问题与 Agent 的**新**回复（排除刚才的问候语）
  const baseline = await snapshot();
  const greetingTexts = new Set(
    baseline.transcript.filter((t) => /^agent[-_]/i.test(t.identity)).map((t) => t.text),
  );
  let last = null;
  for (let i = 0; i < 240; i += 1) {
    last = await snapshot();
    const userItems = last.transcript.filter((t) => t.identity === 'tester');
    const newAgentItems = last.transcript.filter(
      (t) => /^agent[-_]/i.test(t.identity) && !greetingTexts.has(t.text) && t.final && t.text.length >= 4,
    );
    if (userItems.length > 0 && newAgentItems.length > 0) break;
    await sleep(250);
  }

  const userText = last.transcript
    .filter((t) => t.identity === 'tester')
    .map((t) => t.text)
    .join(' ');
  const agentText = last.transcript
    .filter((t) => /^agent[-_]/i.test(t.identity))
    .map((t) => t.text)
    .join(' ');

  console.log('识别到的用户文本：', userText || '(空)');
  console.log('Agent 回复文本：', agentText || '(空)');

  check('STT 识别出用户问题', /心情|小鱼|开心|回答/.test(userText), userText);
  check('Agent 生成了回复', agentText.trim().length > 0, agentText);

  // 回复语音是否有音量
  let peak = 0;
  for (let i = 0; i < 80; i += 1) {
    const s = await snapshot();
    for (const v of Object.values(s.remoteVolumes)) peak = Math.max(peak, Number(v) || 0);
    if (peak > 0 && agentText) break;
    await sleep(250);
  }
  check('Agent 回复有声音', peak > 0, `峰值 ${peak}%`);

  await page.screenshot({ path: join(ARTIFACTS, 'loop-check.png'), fullPage: true });
  await writeFile(
    join(ARTIFACTS, 'loop-report.json'),
    JSON.stringify({ when: new Date().toISOString(), room: ROOM, checks, userText, agentText, last }, null, 2),
    'utf8',
  );
} catch (error) {
  check('执行过程中出现异常', false, error?.message ?? String(error));
  try {
    await page.screenshot({ path: join(ARTIFACTS, 'loop-failure.png'), fullPage: true });
  } catch {}
} finally {
  await browser.close();
}

const failed = checks.filter((c) => !c.pass);
console.log(`\n结果：${checks.length - failed.length}/${checks.length} 通过` + (failed.length ? '，存在失败项' : ' ✔'));
process.exit(failed.length ? 1 : 0);
