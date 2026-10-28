/**
 * 本机联调服务（只监听 127.0.0.1:7890）
 *
 * 职责：
 *   1. 静态托管 dev/public（联调页 + 本地化的 livekit-client UMD）
 *   2. POST /token —— 用 livekit.yaml 的密钥签一张**短时效、限房间**的进场令牌
 *   3. GET /health —— 自身与 LiveKit 的存活状态
 *
 * 安全边界：
 *   - 只绑 127.0.0.1：局域网/公网都碰不到这个签发口
 *   - 校验 Origin（防本机其它网页 CSRF 偷令牌）
 *   - 房间名/身份白名单字符、请求体上限 4KB、令牌 TTL 上限 2 小时
 *   - API secret 永远不出现在响应里
 *
 * 用法：node dev/server.mjs   （或 npm start）
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadKeys, mintJoinToken } from '../tools/jwt.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(HERE, 'public');
const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT ?? 7890);
const LIVEKIT_WS = process.env.LIVEKIT_WS ?? 'ws://127.0.0.1:7880';
const LIVEKIT_HTTP = LIVEKIT_WS.replace(/^ws/, 'http');
const MAX_BODY = 4096;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "media-src 'self' blob:",
  `connect-src 'self' ${LIVEKIT_WS} ${LIVEKIT_HTTP}`,
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const { apiKey } = loadKeys();
const allowedOrigins = new Set([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`]);

const startedAt = Date.now();
const log = (...args) => console.log(new Date().toISOString(), ...args);

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
}

function sendText(res, status, text) {
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(text);
}

function readBody(req, limit) {
  return new Promise((accept, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => accept(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const ROOM_RE = /^[A-Za-z0-9_-]{1,64}$/;

async function handleToken(req, res) {
  const origin = req.headers.origin;
  if (origin !== undefined && !allowedOrigins.has(origin)) {
    sendJson(res, 403, { error: '来源不受信任' });
    return;
  }
  if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
    sendJson(res, 415, { error: '请用 application/json' });
    return;
  }
  let input;
  try {
    input = JSON.parse((await readBody(req, MAX_BODY)) || '{}');
  } catch {
    sendJson(res, 400, { error: '请求体不是合法 JSON' });
    return;
  }
  const room = String(input.room ?? '').trim();
  const identity = String(input.identity ?? '').trim();
  const name = String(input.name ?? '').trim().slice(0, 64);
  const ttl = Number(input.ttlSec ?? 3600);

  if (!ROOM_RE.test(room)) {
    sendJson(res, 400, { error: '房间名只允许字母/数字/下划线/短横线，1-64 字符' });
    return;
  }
  if (!ROOM_RE.test(identity)) {
    sendJson(res, 400, { error: '身份只允许字母/数字/下划线/短横线，1-64 字符' });
    return;
  }
  if (!Number.isInteger(ttl) || ttl < 60 || ttl > 7200) {
    sendJson(res, 400, { error: 'ttlSec 需为 60-7200 的整数' });
    return;
  }

  const { apiSecret } = loadKeys();
  const token = mintJoinToken({ apiKey, apiSecret, room, identity, name: name || undefined, ttlSec: ttl });
  log(`token  room=${room} identity=${identity} ttl=${ttl}s`);
  sendJson(res, 200, { url: LIVEKIT_WS, token, room, identity });
}

async function handleStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = resolve(join(PUBLIC_DIR, rel));
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + sep)) {
    sendText(res, 403, '禁止访问');
    return;
  }
  let info;
  try {
    info = await stat(file);
  } catch {
    sendText(res, 404, '404 Not Found');
    return;
  }
  if (!info.isFile()) {
    sendText(res, 404, '404 Not Found');
    return;
  }
  const body = await readFile(file);
  res.writeHead(200, {
    'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'content-length': body.length,
    'cache-control': 'no-store',
    'content-security-policy': CSP,
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}

async function livekitHealth() {
  try {
    const res = await fetch(`${LIVEKIT_HTTP}/`, { signal: AbortSignal.timeout(2000) });
    return res.status === 200;
  } catch {
    return false;
  }
}

const server = createServer(async (req, res) => {
  const method = req.method ?? 'GET';
  let pathname;
  try {
    pathname = new URL(req.url ?? '/', `http://${HOST}:${PORT}`).pathname;
  } catch {
    sendText(res, 400, 'bad url');
    return;
  }
  try {
    if (pathname === '/health') {
      const up = await livekitHealth();
      sendJson(res, 200, {
        ok: up,
        livekit: LIVEKIT_WS,
        uptimeSec: Math.round((Date.now() - startedAt) / 1000),
      });
      return;
    }
    if (pathname === '/token') {
      if (method !== 'POST') {
        sendJson(res, 405, { error: '仅支持 POST' });
        return;
      }
      await handleToken(req, res);
      return;
    }
    if (method !== 'GET' && method !== 'HEAD') {
      sendText(res, 405, 'Method Not Allowed');
      return;
    }
    await handleStatic(req, res, pathname);
  } catch (error) {
    log('请求失败', error?.message ?? error);
    if (!res.headersSent) sendJson(res, 500, { error: '本机服务内部错误' });
    else res.end();
  }
});

server.listen(PORT, HOST, async () => {
  log(`联调服务已启动: http://${HOST}:${PORT}/`);
  log(`LiveKit 信令: ${LIVEKIT_WS}  (健康: ${(await livekitHealth()) ? 'OK' : '不可达'})`);
  log(`API key: ${apiKey.slice(0, 6)}…（secret 只在内存中使用）`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    log('收到退出信号，关闭联调服务');
    server.close(() => process.exit(0));
  });
}
