/**
 * LiveKit 端到端校验（不依赖浏览器）
 *
 * 依次验证：
 *   1. 信令端口健康检查 GET / → 200
 *   2. 用 admin 令牌 CreateRoom（证明 key/secret 与鉴权链路正确）
 *   3. ListRooms 能看到刚建的房
 *   4. 用 join 令牌的 payload 校验房间/身份/权限/有效期字段
 *   5. DeleteRoom 清理
 *
 * 用法：node tools/verify.mjs
 * 退出码：0 = 全过；1 = 任一环节失败
 */
import { mintAdminToken, mintJoinToken, loadKeys, decodePayload } from './jwt.mjs';

const BASE = process.env.LIVEKIT_URL ?? 'http://127.0.0.1:7880';

function ok(label, detail = '') {
  console.log(`PASS  ${label}${detail ? '  ' + detail : ''}`);
}
function fail(label, detail) {
  console.error(`FAIL  ${label}  ${detail}`);
  process.exitCode = 1;
}

async function call(path, token, body, timeoutMs = 5000) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

const room = `lk-verify-${Date.now().toString(36)}`;
const { apiKey, apiSecret } = loadKeys();

console.log(`配置：${apiKey.slice(0, 6)}… / ${BASE}`);
console.log(`房源：${room}`);

try {
  const health = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(5000) });
  health.status === 200
    ? ok('健康检查', `HTTP ${health.status}`)
    : fail('健康检查', `HTTP ${health.status}`);

  const adminToken = mintAdminToken({ apiKey, apiSecret });

  const created = await call('/twirp/livekit.RoomService/CreateRoom', adminToken, {
    name: room,
    empty_timeout: 60,
  });
  created.status === 200 && created.json?.name === room
    ? ok('CreateRoom', created.json.sid ?? '')
    : fail('CreateRoom', `HTTP ${created.status} ${JSON.stringify(created.json).slice(0, 200)}`);

  const listed = await call('/twirp/livekit.RoomService/ListRooms', adminToken, { names: [room] });
  const found = (listed.json?.rooms ?? []).find((item) => item.name === room);
  listed.status === 200 && found
    ? ok('ListRooms', `${found.num_participants ?? 0} 人`)
    : fail('ListRooms', `HTTP ${listed.status} ${JSON.stringify(listed.json).slice(0, 200)}`);

  const join = mintJoinToken({
    apiKey,
    apiSecret,
    room,
    identity: 'verify-bot',
    name: '验证机器人',
    ttlSec: 120,
  });
  const claims = decodePayload(join);
  const grants = claims.video ?? {};
  const expOk = Number(claims.exp) > Math.floor(Date.now() / 1000);
  grants.room === room && grants.roomJoin === true && grants.canPublish === true && grants.canSubscribe === true && expOk
    ? ok('join 令牌', `identity=${claims.sub} room=${grants.room} exp=${new Date(claims.exp * 1000).toISOString()}`)
    : fail('join 令牌', JSON.stringify({ grants, expOk }));

  const deleted = await call('/twirp/livekit.RoomService/DeleteRoom', adminToken, { room });
  deleted.status === 200
    ? ok('DeleteRoom', '已清理')
    : fail('DeleteRoom', `HTTP ${deleted.status} ${JSON.stringify(deleted.json).slice(0, 200)}`);
} catch (error) {
  fail('执行异常', error?.message ?? String(error));
}

console.log(process.exitCode ? '\n结果：未通过' : '\n结果：全部通过 ✔');
