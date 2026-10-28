/**
 * LiveKit JWT 工具（零依赖，只用 node:crypto）
 *
 * 作用：用 livekit.yaml 里的 API key/secret 签发两类令牌
 *   - join  ：浏览器/桌宠进场用（限制房间、身份、发布/订阅权限、有效期）
 *   - admin ：服务端管理用（建房/列房/删房，仅本机脚本使用）
 *
 * 设计要点：
 *   1. 不引入 livekit-server-sdk —— 本机只签 JWT，HS256 手写 40 行就够，少一个依赖面
 *   2. 密钥只从 livekit.yaml 读，绝不出现在浏览器代码里
 *   3. 令牌默认 1 小时、nbf 回拨 10 秒（容忍本机时钟抖动）
 *
 * 用法：
 *   node tools/jwt.mjs join --room pet-room --identity me-1234 [--name 小明] [--ttl 3600]
 *   node tools/jwt.mjs admin [--ttl 600]
 */
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** 默认配置文件：<livekit>/tools/../livekit.yaml */
export function defaultConfigPath() {
  return resolve(process.env.LIVEKIT_CONFIG ?? join(HERE, '..', 'livekit.yaml'));
}

/**
 * 极简 keys 块解析（只认 livekit.yaml 里 keys: 下两空格缩进的 `key: secret`）。
 * 不引入 YAML 库：本文件只服务本仓库这一份配置，结构固定。
 */
export function loadKeys(configPath = defaultConfigPath()) {
  let text;
  try {
    text = readFileSync(configPath, 'utf8');
  } catch (error) {
    throw new Error(`读不到 LiveKit 配置：${configPath}（${error.message}）`);
  }
  const keys = {};
  let inKeys = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    if (/^keys:\s*$/.test(line)) {
      inKeys = true;
      continue;
    }
    if (!inKeys) continue;
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const m = /^\s{2}([A-Za-z0-9]+):\s*(\S+)\s*$/.exec(line);
    if (m) {
      keys[m[1]] = m[2];
      continue;
    }
    if (!line.startsWith(' ')) break; // 离开 keys 块
  }
  const entries = Object.entries(keys);
  if (entries.length === 0) {
    throw new Error(`配置里没有可用的 keys（${configPath}）：需要 keys: 下两空格缩进的 "APIKey: Secret"`);
  }
  const [apiKey, apiSecret] = entries[0];
  return { apiKey, apiSecret, keys };
}

const b64url = (value) => Buffer.from(value).toString('base64url');

function sign(header, payload, secret) {
  const data = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${signature}`;
}

const nowSec = () => Math.floor(Date.now() / 1000);

/**
 * 签一张进场令牌。
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string} opts.apiSecret
 * @param {string} opts.room        房间名（必填，令牌只对这一个房间有效）
 * @param {string} opts.identity    参与者唯一 id（同一房间内不能重复）
 * @param {string} [opts.name]      显示名
 * @param {number} [opts.ttlSec]    有效期秒数，默认 3600
 * @param {boolean} [opts.canPublish]
 * @param {boolean} [opts.canSubscribe]
 */
export function mintJoinToken({
  apiKey,
  apiSecret,
  room,
  identity,
  name,
  ttlSec = 3600,
  canPublish = true,
  canSubscribe = true,
}) {
  if (!room || !identity) throw new Error('join 令牌需要 room 与 identity');
  const now = nowSec();
  const payload = {
    iss: apiKey,
    sub: identity,
    ...(name ? { name } : {}),
    nbf: now - 10,
    exp: now + ttlSec,
    jti: randomUUID(),
    video: {
      room,
      roomJoin: true,
      canPublish,
      canSubscribe,
      canPublishData: true,
      hidden: false,
    },
  };
  return sign({ alg: 'HS256', typ: 'JWT' }, payload, apiSecret);
}

/**
 * 签一张管理令牌（只给本机脚本用，不要发给浏览器）。
 * @param {object} opts
 * @param {number} [opts.ttlSec] 默认 600
 */
export function mintAdminToken({ apiKey, apiSecret, ttlSec = 600 }) {
  const now = nowSec();
  const payload = {
    iss: apiKey,
    sub: apiKey,
    nbf: now - 10,
    exp: now + ttlSec,
    jti: randomUUID(),
    video: { roomList: true, roomCreate: true, roomAdmin: true },
  };
  return sign({ alg: 'HS256', typ: 'JWT' }, payload, apiSecret);
}

/** 不解码校验签名，只把 payload 摊开给人看（调试/断言用） */
export function decodePayload(token) {
  const part = token.split('.')[1];
  if (!part) throw new Error('不是合法 JWT');
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

// ---- CLI ----
function runCli(argv) {
  const [command, ...rest] = argv;
  const opts = {};
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i].startsWith('--')) {
      const key = rest[i].slice(2);
      const value = rest[i + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`参数 --${key} 缺少值`);
      opts[key] = value;
      i += 1;
    }
  }
  const { apiKey, apiSecret } = loadKeys(opts.config);
  if (command === 'join') {
    const token = mintJoinToken({
      apiKey,
      apiSecret,
      room: opts.room,
      identity: opts.identity,
      name: opts.name,
      ttlSec: opts.ttl ? Number(opts.ttl) : 3600,
    });
    process.stdout.write(token + '\n');
    return;
  }
  if (command === 'admin') {
    process.stdout.write(mintAdminToken({ apiKey, apiSecret, ttlSec: opts.ttl ? Number(opts.ttl) : 600 }) + '\n');
    return;
  }
  throw new Error('用法：node tools/jwt.mjs <join|admin> [...参数]');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`jwt.mjs: ${error.message}\n`);
    process.exit(1);
  }
}
