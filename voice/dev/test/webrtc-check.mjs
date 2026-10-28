/**
 * 双浏览器端到端验证（无头 Chrome，使用假麦克风）
 *
 * 验证目标：
 *   1. 两个“人”能同时进同一个房间（信令 + JWT 正常）
 *   2. A 发布麦克风后，B 能订阅到远端音频轨道（SFU 转发正常）
 *   3. B 侧能测到非零音量（媒体真的在流动，而不是只建了轨道）
 *   4. A 静音后 B 能看到麦克风状态变化（状态同步正常）
 *
 * 运行前提：LiveKit（7880）与联调服务（7890）都已启动。
 * 用法：node dev/test/webrtc-check.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = dirname(fileURLToPath(import.meta.url));
const ARTIFACTS = join(HERE, 'artifacts');
const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:7890/';
const CHROME =
  process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 用独立房间名，避免被自动分派的语音 Agent 干扰人数断言
const ROOM = process.env.ROOM ?? `lk-test-${Date.now().toString(36)}`;
const checks = [];
function check(label, pass, detail = '') {
  checks.push({ label, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
}

const snapshot = (page) => page.evaluate(() => window.__lkTest.snapshot());

async function joinRoom(page, identity, publish) {
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.fill('#room', ROOM);
  await page.fill('#identity', identity);
  if (!publish) await page.uncheck('#publish');
  await page.click('#join');
  await page.waitForFunction(() => window.__lkTest?.snapshot().connected === 'connected', null, { timeout: 20000 });
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
    '--disable-dev-shm-usage',
  ],
});

const ctxA = await browser.newContext({ permissions: ['microphone'] });
const ctxB = await browser.newContext({ permissions: ['microphone'] });
const pageA = await ctxA.newPage();
const pageB = await ctxB.newPage();

for (const [name, page] of [
  ['A', pageA],
  ['B', pageB],
]) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log(`[${name} console] ${msg.text()}`);
  });
  page.on('pageerror', (err) => console.log(`[${name} pageerror] ${err.message}`));
}

try {
  await joinRoom(pageA, 'alice', true);
  check('A 加入房间并发布麦克风', true);

  await joinRoom(pageB, 'bob', false);
  check('B 以仅接收模式加入房间', true);

  await pageB.waitForFunction(
    () => {
      const s = window.__lkTest.snapshot();
      return s.participantCount === 2 && s.remoteAudioTracks.length > 0;
    },
    null,
    { timeout: 25000 },
  );
  check('B 看到 2 个参与者并订阅到远端音频', true);

  // 假麦克风是周期提示音，给几拍时间抓峰值
  let peak = 0;
  let last = null;
  for (let i = 0; i < 40; i += 1) {
    last = await snapshot(pageB);
    for (const v of Object.values(last.remoteVolumes)) peak = Math.max(peak, Number(v) || 0);
    if (peak > 0) break;
    await sleep(250);
  }
  check('B 侧远端音量 > 0（媒体在流动）', peak > 0, `峰值 ${peak}%`);

  const mediaDetail = await pageB.evaluate(() => {
    const audio = [...document.querySelectorAll('#audio-sink audio')];
    return audio.map((el) => ({
      hasStream: Boolean(el.srcObject),
      paused: el.paused,
      tracks: el.srcObject
        ? el.srcObject.getTracks().map((t) => ({ kind: t.kind, readyState: t.readyState, muted: t.muted }))
        : [],
    }));
  });
  const liveTrack = mediaDetail.some((item) => item.tracks.some((t) => t.kind === 'audio' && t.readyState === 'live'));
  check('远端音频元素持有 live 轨道', liveTrack, JSON.stringify(mediaDetail));

  const snapA = await (async () => {
    await pageA.waitForFunction(() => window.__lkTest.snapshot().participantCount === 2, null, {
      timeout: 15000,
    });
    return snapshot(pageA);
  })();
  const snapB = await snapshot(pageB);
  check('A 也看到 2 个参与者', snapA.participantCount === 2, `A=${snapA.participantCount}`);

  // 静音状态同步
  await pageA.click('#mute');
  await sleep(1500);
  const afterMute = await snapshot(pageB);
  const bobSeesMuted = afterMute.participants.some((p) => p.identity === 'alice' && p.mic === false);
  check('静音状态同步到 B', bobSeesMuted, JSON.stringify(afterMute.participants));

  await pageA.click('#mute');
  await sleep(1200);
  const afterUnmute = await snapshot(pageB);
  check(
    '取消静音后状态恢复',
    afterUnmute.participants.some((p) => p.identity === 'alice' && p.mic === true),
  );

  await pageA.screenshot({ path: join(ARTIFACTS, 'page-a-publisher.png'), fullPage: true });
  await pageB.screenshot({ path: join(ARTIFACTS, 'page-b-listener.png'), fullPage: true });

  await writeFile(
    join(ARTIFACTS, 'report.json'),
    JSON.stringify({ when: new Date().toISOString(), checks, snapA, snapB, mediaDetail }, null, 2),
    'utf8',
  );
} catch (error) {
  check('执行过程中出现异常', false, error?.message ?? String(error));
  for (const [name, page] of [
    ['A', pageA],
    ['B', pageB],
  ]) {
    try {
      await page.screenshot({ path: join(ARTIFACTS, `failure-${name}.png`), fullPage: true });
    } catch {}
  }
} finally {
  await browser.close();
}

const failed = checks.filter((c) => !c.pass);
console.log(`\n结果：${checks.length - failed.length}/${checks.length} 通过` + (failed.length ? '，存在失败项' : ' ✔'));
process.exit(failed.length ? 1 : 0);
