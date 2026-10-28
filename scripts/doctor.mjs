#!/usr/bin/env node
/**
 * doctor.mjs —— 上传/发布前的自检：确认没有把密钥、模型、二进制带进版本库。
 *
 * 只读检查，不改任何文件。任何一项不通过就以非 0 退出，适合挂在 pre-push 或 CI 里。
 *
 *   node scripts/doctor.mjs              # 检查仓库
 *   node scripts/doctor.mjs --all        # 连 ../data 运行数据一起看
 *
 * 检查项：
 *   1. 跟踪文件里有没有密钥模式（sk-、API key/secret、私钥、GitHub token…）
 *   2. 有没有把"本该被忽略"的文件误提交（模型、venv、exe、livekit.yaml、.env、logs）
 *   3. .gitignore 是否确实覆盖了这些路径（用 git check-ignore 验证，而不是看文本）
 *   4. 仓库里单个文件是否超过 GitHub 的 100MB 硬限制
 *
 * @module dsh-pet-companion/scripts/doctor
 */
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

const RED = '\u001b[31m';
const GREEN = '\u001b[32m';
const YELLOW = '\u001b[33m';
const DIM = '\u001b[2m';
const RESET = '\u001b[0m';

let failures = 0;
let warnings = 0;

function ok(message) {
  console.log(`${GREEN}✓${RESET} ${message}`);
}

function warn(message, detail) {
  warnings += 1;
  console.log(`${YELLOW}!${RESET} ${message}`);
  if (detail) console.log(`  ${DIM}${detail}${RESET}`);
}

function fail(message, detail) {
  failures += 1;
  console.log(`${RED}✗${RESET} ${message}`);
  if (detail) console.log(`  ${DIM}${detail}${RESET}`);
}

function git(args, options = {}) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
    ...options,
  });
}

/** 只在文本内容里找的模式；宁可误报也不要漏报。 */
const SECRET_PATTERNS = [
  { name: 'OpenAI/DeepSeek 风格 API key', re: /\bsk-[A-Za-z0-9_-]{20,}/ },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{30,}/ },
  { name: '私钥块', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'LiveKit apiSecret 字段', re: /["']?apiSecret["']?\s*[:=]\s*["'][^"']{16,}/ },
  { name: 'LiveKit keys 段（yaml/yml）', re: /^\s*API[A-Za-z0-9]{8,}\s*:\s*\S{16,}/m },
  { name: 'Bearer 长令牌', re: /\bBearer\s+[A-Za-z0-9._-]{30,}/ },
];

/** 不该被跟踪的路径（正则匹配仓库相对路径）。 */
const FORBIDDEN_TRACKED = [
  { name: '语音模型目录', re: /^voice\/models\// },
  { name: 'Python venv', re: /^voice\/\.venv/ },
  { name: 'LiveKit 服务端二进制', re: /^voice\/livekit_[^/]*windows[^/]*\// },
  { name: 'LiveKit 服务端配置（含密钥）', re: /(^|\/)livekit\.yaml$/ },
  { name: '本地 .env', re: /(^|\/)\.env$/ },
  { name: '运行日志', re: /(^|\/)logs?\// },
  { name: 'node_modules', re: /(^|\/)node_modules\// },
  { name: '构建产物 lib/', re: /^dsh-pet\/lib\// },
];

/** 应该被 git 忽略、因此本地存在也不该出现在 status 里的路径。 */
const SHOULD_IGNORE = [
  'voice/models/sense-voice/model.int8.onnx',
  'voice/.venv/pyvenv.cfg',
  'voice/livekit.yaml',
  'voice/agent/.env',
  'voice/logs/agent.out.log',
  'dsh-pet/node_modules/.modules.yaml',
  'dsh-pet/lib/index.js',
];

function listTracked() {
  return git(['ls-files', '-z']).split('\0').filter(Boolean);
}

function isBinary(buffer) {
  // 前 8KB 里出现 NUL 就当二进制，避免对 png/webm 白跑正则
  return buffer.subarray(0, 8192).includes(0);
}

function checkSecrets(tracked) {
  console.log('\n── 1. 跟踪文件里的密钥 ─────────────────────────────');
  let scanned = 0;
  let hits = 0;
  for (const file of tracked) {
    const abs = join(repoRoot, file);
    if (!existsSync(abs)) continue;
    let size = 0;
    try {
      size = statSync(abs).size;
    } catch {
      continue;
    }
    if (size > 2 * 1024 * 1024) continue; // 大文件单独在 §4 检查
    let buffer;
    try {
      buffer = execFileSync('git', ['show', `HEAD:${file}`], { cwd: repoRoot, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      continue; // 还没提交的新文件，跳过；§2/§3 仍会覆盖
    }
    if (isBinary(buffer)) continue;
    scanned += 1;
    const text = buffer.toString('utf8');
    for (const pattern of SECRET_PATTERNS) {
      const match = pattern.re.exec(text);
      if (!match) continue;
      const snippet = match[0].slice(0, 12).replace(/\s+/g, ' ');
      fail(`${file}：疑似 ${pattern.name}`, `命中片段 “${snippet}…”`);
      hits += 1;
    }
  }
  if (hits === 0) ok(`已扫描 ${scanned} 个文本文件，未发现密钥模式`);
}

function checkForbidden(tracked) {
  console.log('\n── 2. 不该入库的文件 ───────────────────────────────');
  let hits = 0;
  for (const file of tracked) {
    for (const rule of FORBIDDEN_TRACKED) {
      if (rule.re.test(file)) {
        fail(`${file}：${rule.name} 被跟踪了`, '从索引移除：git rm -r --cached <路径>，并确认 .gitignore 已覆盖');
        hits += 1;
      }
    }
  }
  if (hits === 0) ok('模型 / venv / 二进制 / livekit.yaml / .env / logs 均未被跟踪');
}

function checkIgnoreRules() {
  console.log('\n── 3. .gitignore 覆盖 ─────────────────────────────');
  const missing = [];
  for (const path of SHOULD_IGNORE) {
    try {
      git(['check-ignore', '-q', path]);
    } catch {
      missing.push(path);
    }
  }
  if (missing.length === 0) {
    ok(`${SHOULD_IGNORE.length} 条敏感/大体积路径全部被忽略`);
  } else {
    for (const path of missing) fail(`${path} 没有被 .gitignore 覆盖`, '补规则后再提交，否则可能误入库');
  }
}

function checkSizes(tracked) {
  console.log('\n── 4. 大文件（GitHub 单文件 100MB 硬限制）──────────');
  const big = [];
  for (const file of tracked) {
    const abs = join(repoRoot, file);
    try {
      const { size } = statSync(abs);
      if (size > 20 * 1024 * 1024) big.push({ file, mb: size / 1024 / 1024 });
    } catch {
      /* 文件已删除但仍在索引，忽略 */
    }
  }
  if (big.length === 0) {
    ok('没有超过 20MB 的跟踪文件');
    return;
  }
  for (const { file, mb } of big) {
    const message = `${file}（${mb.toFixed(1)} MB）`;
    if (mb > 100) fail(message, '超过 100MB 会被 GitHub 直接拒绝，改用 Releases 或 Git LFS');
    else warn(message, '接近 GitHub 建议上限，考虑压缩或改走 Releases');
  }
}

function checkWorkingTree() {
  console.log('\n── 5. 工作区状态 ─────────────────────────────────');
  const dirty = git(['status', '--porcelain']).trim();
  if (!dirty) {
    ok('工作区干净');
    return;
  }
  const lines = dirty.split('\n');
  warn(`有 ${lines.length} 项未提交改动`, lines.slice(0, 5).join(' / '));
}

function checkDataDir() {
  const dataDir = resolve(repoRoot, '..', 'data');
  console.log('\n── 6. 运行数据（--all）────────────────────────────');
  if (!existsSync(dataDir)) {
    ok('没有 ../data 目录');
    return;
  }
  const sensitive = ['companion-secrets.json', 'livekit-keys.json', 'standalone-ai.json', 'livekit.yaml'];
  for (const name of sensitive) {
    const abs = join(dataDir, 'dsh-pet', name);
    if (existsSync(abs)) {
      warn(`运行数据里有明文密钥：data/dsh-pet/${name}`, '只在本地保留；截图/打包前先确认已排除');
    }
  }
  const logs = join(dataDir, 'dsh-pet', 'logs.txt');
  if (existsSync(logs)) {
    warn('运行数据里有 logs.txt', '日志常含 key 片段与完整对话：公开截图前建议清空');
  }
}

// ── 主流程 ───────────────────────────────────────────────────────────────
console.log(`仓库：${repoRoot}`);

let tracked;
try {
  tracked = listTracked();
} catch {
  fail('当前目录不是 git 仓库（或没有 git）');
  process.exit(1);
}
console.log(`跟踪文件：${tracked.length} 个`);

checkSecrets(tracked);
checkForbidden(tracked);
checkIgnoreRules();
checkSizes(tracked);
checkWorkingTree();
if (process.argv.includes('--all')) checkDataDir();

console.log('');
if (failures > 0) {
  console.log(`${RED}✗ ${failures} 项不通过${warnings ? `，${warnings} 项提醒` : ''}。修完再提交。${RESET}`);
  process.exit(1);
}
console.log(`${GREEN}✓ 全部通过${warnings ? `（${warnings} 项提醒，见上）` : ''}${RESET}`);
