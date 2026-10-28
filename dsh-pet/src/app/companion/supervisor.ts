/**
 * 语音运行时的进程编排：按需拉起 LiveKit 与 Python Agent，空闲自动回收。
 *
 * 只负责子进程生命周期、密钥/配置生成、健康检查与 join token；不碰 UI。
 * 进程路径通过环境变量注入（开发与打包各一套），缺失时 status() 给出可读原因。
 * @module dsh-pet/src/app/companion/supervisor
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { writePrivateJson } from '../../standalone/ai-storage.ts';
import type { CompanionSettings, CompanionStore, ProviderSettings } from './config.ts';

const IDLE_MS = 5 * 60 * 1000;
const HEALTH_TIMEOUT_MS = 15_000;

interface LiveKitKeys {
  apiKey: string;
  apiSecret: string;
}

export interface SupervisorStatus {
  running: boolean;
  livekit: 'stopped' | 'starting' | 'running' | 'error';
  agent: 'stopped' | 'starting' | 'running' | 'error';
  port: number | null;
  room: string;
  phase: string;
  error?: string;
  idleStopsAt?: string;
  logTail: string[];
}

export interface RuntimePaths {
  livekitBin?: string;
  python?: string;
  agentRoot?: string;
}

function envPath(name: string): string | undefined {
  const value = process.env[name];
  return value && existsSync(value) ? value : undefined;
}

function randomKey(): string {
  return 'API' + randomBytes(8).toString('hex');
}

function randomSecret(): string {
  return randomBytes(32).toString('base64url');
}

function safeEndpoint(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

/** 进程编排器。方法都是同步状态机 + Promise，供路由与 Electron 主进程共用。 */
export class VoiceSupervisor {
  private readonly store: CompanionStore;
  private readonly log: (message: string) => void;
  private readonly paths: RuntimePaths;
  private livekit?: ChildProcess;
  private agent?: ChildProcess;
  private keys?: LiveKitKeys;
  private port: number | null = null;
  private phase = 'idle';
  private error = '';
  private idleTimer?: ReturnType<typeof setTimeout>;
  private logTail: string[] = [];
  private readonly onAutoStop?: () => void;

  constructor(store: CompanionStore, log: (message: string) => void, onAutoStop?: () => void) {
    this.store = store;
    this.log = log;
    this.onAutoStop = onAutoStop;
    this.paths = {
      livekitBin: envPath('DSH_PET_LIVEKIT_BIN'),
      python: envPath('DSH_PET_PYTHON'),
      agentRoot: envPath('DSH_PET_AGENT_ROOT'),
    };
  }

  private append(line: string): void {
    const text = line.trim();
    if (!text) return;
    this.logTail.push(text);
    if (this.logTail.length > 60) this.logTail.shift();
  }

  private settings(): CompanionSettings {
    return this.store.current();
  }

  private loadKeys(): LiveKitKeys {
    if (this.keys) return this.keys;
    const file = join(this.store.paths.petHome, 'livekit-keys.json');
    if (existsSync(file)) {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as LiveKitKeys;
      if (parsed.apiKey && parsed.apiSecret) {
        this.keys = parsed;
        return parsed;
      }
    }
    const keys = { apiKey: randomKey(), apiSecret: randomSecret() };
    writePrivateJson(file, keys);
    this.keys = keys;
    return keys;
  }

  private writeLivekitConfig(port: number, keys: LiveKitKeys): string {
    const file = join(this.store.paths.petHome, 'livekit.yaml');
    const text = `# 由 dsh-pet 伴侣自动生成（语音关闭后进程退出）\nport: ${port}\nrtc:\n  tcp_port: ${port + 1}\n  udp_port: ${port + 2}\n  use_external_ip: false\nroom:\n  auto_create: true\n  empty_timeout: 60\n  departure_timeout: 20\nlogging:\n  level: info\n  json: false\nkeys:\n  ${keys.apiKey}: ${keys.apiSecret}\n`;
    writeFileSync(file, text, { encoding: 'utf8', mode: 0o600 });
    return file;
  }

  private async health(port: number): Promise<boolean> {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1500) });
      return res.status === 200;
    } catch {
      return false;
    }
  }

  private agentEnv(port: number, keys: LiveKitKeys): NodeJS.ProcessEnv {
    const settings = this.settings();
    const active: ProviderSettings | undefined =
      settings.providers.find((p) => p.id === settings.activeProviderId) ?? settings.providers[0];
    const key = active ? this.store.providerKey(active.id) : '';
    return {
      ...process.env,
      LIVEKIT_URL: `ws://127.0.0.1:${port}`,
      LIVEKIT_API_KEY: keys.apiKey,
      LIVEKIT_API_SECRET: keys.apiSecret,
      PET_NAME: settings.voice.activePetName,
      PET_ID: settings.voice.activePetId,
      PET_PERSONA: settings.pets[settings.voice.activePetId]?.persona || '',
      DEEPSEEK_API_KEY: key,
      DEEPSEEK_BASE_URL: active ? safeEndpoint(active.baseUrl) : 'https://api.deepseek.com/v1',
      DEEPSEEK_MODEL: active ? active.model : 'deepseek-chat',
      EDGE_TTS_VOICE: settings.pets[settings.voice.activePetId]?.voice || settings.voice.voice,
      EDGE_TTS_RATE: settings.voice.rate,
      EDGE_TTS_PITCH: settings.voice.pitch,
      EDGE_TTS_VOLUME: settings.voice.volume,
      TTS_ENGINE: settings.voice.engine === 'melo' ? 'melo' : 'edge',
      MELO_MODEL_DIR: join(this.paths.agentRoot ?? '', 'models', 'melo-tts'),
      STT_LANGUAGE: settings.voice.sttLanguage,
      WAKE_WORD: settings.voice.wakeWord,
      WAKE_IDLE_SECONDS: String(settings.voice.wakeIdleSeconds),
      AGENT_ROOM_PREFIX: settings.livekit.room,
      DSH_PET_MEMORY_FILE: join(settings.chat.memoryDir, 'memory.json'),
      DSH_PET_EMOTION_FILE: join(settings.chat.memoryDir, 'emotion.json'),
      DSH_PET_EMOTION_ENABLED: settings.emotion.enabled ? '1' : '0',
      DSH_PET_USAGE_FILE: join(settings.chat.memoryDir, 'usage.jsonl'),
      DSH_PET_MEMORY_ENTRY: 'main',
      DSH_PET_MEMORY_PET: 'main',
      DSH_PET_MEMORY_ROUNDS: String(settings.chat.rounds),
      PYTHONUNBUFFERED: '1',
    };
  }

  async ensureStarted(): Promise<SupervisorStatus> {
    if (this.phase === 'running') {
      this.touch();
      return this.status();
    }
    if (this.phase === 'starting') {
      return this.status();
    }
    this.phase = 'starting';
    this.error = '';
    this.logTail = [];
    try {
      const settings = this.settings();
      if (settings.livekit.mode === 'disabled') throw new Error('LiveKit 模式为「关闭」，请先在设置里选择内置或外部');
      const bin = this.paths.livekitBin;
      const python = this.paths.python;
      const agentRoot = this.paths.agentRoot;
      if (!bin) throw new Error('未找到 livekit-server.exe（设置 DSH_PET_LIVEKIT_BIN）');
      if (!python) throw new Error('未找到 Python（设置 DSH_PET_PYTHON）');
      if (!agentRoot) throw new Error('未找到 Agent 目录（设置 DSH_PET_AGENT_ROOT）');

      const port = settings.livekit.port;
      const keys = this.loadKeys();
      const config = this.writeLivekitConfig(port, keys);

      this.livekit = spawn(bin, ['--config', config], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      this.livekit.stdout?.on('data', (data: Buffer) => this.append(String(data)));
      this.livekit.stderr?.on('data', (data: Buffer) => this.append(String(data)));
      this.livekit.on('exit', () => {
        if (this.phase !== 'stopping') this.append('LiveKit 进程退出');
      });

      const started = Date.now();
      while (Date.now() - started < HEALTH_TIMEOUT_MS) {
        if (this.livekit.exitCode !== null) {
          throw new Error(`LiveKit 启动失败（退出码 ${this.livekit.exitCode}）：端口 ${port} 可能被占用`);
        }
        if (await this.health(port)) break;
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      if (!(await this.health(port))) throw new Error(`LiveKit 启动超时（端口 ${port}）`);
      this.port = port;
      this.phase = 'agent-starting';

      this.agent = spawn(python, ['-m', 'agent.pet_agent', 'dev'], {
        cwd: agentRoot,
        env: this.agentEnv(port, keys),
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      this.agent.stdout?.on('data', (data: Buffer) => this.append(String(data)));
      this.agent.stderr?.on('data', (data: Buffer) => this.append(String(data)));
      this.agent.on('exit', (code) => {
        if (this.phase !== 'stopping') this.append(`Agent 进程退出（${code ?? '?'}）`);
      });

      // 等注册完成（stdout 出现 registered worker），最多 25 秒
      const agentStarted = Date.now();
      while (Date.now() - agentStarted < 25_000) {
        if (this.logTail.some((line) => line.includes('registered worker'))) break;
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      this.phase = 'running';
      this.touch();
      mkdirSync(join(this.store.paths.petHome, 'logs'), { recursive: true });
      return this.status();
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      this.phase = 'error';
      await this.stop();
      this.error = String(this.error);
      return this.status();
    }
  }

  touch(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.phase !== 'running') return;
    this.idleTimer = setTimeout(() => {
      this.log('语音空闲 5 分钟，回收 LiveKit/Agent');
      void this.stop().then(() => this.onAutoStop?.());
    }, IDLE_MS);
    this.idleTimer.unref?.();
  }

  async stop(): Promise<SupervisorStatus> {
    this.phase = 'stopping';
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
    for (const child of [this.agent, this.livekit]) {
      if (!child || child.exitCode !== null) continue;
      try {
        child.kill();
      } catch {
        /* ignore */
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    this.agent = undefined;
    this.livekit = undefined;
    this.port = null;
    this.phase = 'idle';
    return this.status();
  }

  async restart(): Promise<SupervisorStatus> {
    await this.stop();
    return this.ensureStarted();
  }

  status(): SupervisorStatus {
    const settings = this.settings();
    const livekit: SupervisorStatus['livekit'] =
      this.phase === 'running' || this.phase === 'agent-starting'
        ? 'running'
        : this.phase === 'starting'
          ? 'starting'
          : this.phase === 'error'
            ? 'error'
            : 'stopped';
    const agent: SupervisorStatus['agent'] =
      this.phase === 'running'
        ? 'running'
        : this.phase === 'agent-starting'
          ? 'starting'
          : this.phase === 'error'
            ? 'error'
            : 'stopped';
    return {
      running: this.phase === 'running',
      livekit,
      agent,
      port: this.port,
      room: settings.livekit.room,
      phase: this.phase,
      error: this.error || undefined,
      idleStopsAt: this.idleTimer ? new Date(Date.now() + IDLE_MS).toISOString() : undefined,
      logTail: this.logTail.slice(-12),
    };
  }

  /** 签一张只对当前房间有效的 join 令牌。 */
  mintJoinToken(identity: string, room: string): { url: string; token: string; room: string } {
    if (!this.port) throw new Error('语音服务尚未启动');
    const keys = this.loadKeys();
    const now = Math.floor(Date.now() / 1000);
    const b64 = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');
    const header = b64({ alg: 'HS256', typ: 'JWT' });
    const payload = b64({
      iss: keys.apiKey,
      sub: identity,
      nbf: now - 10,
      exp: now + 3600,
      jti: randomUUID(),
      video: { room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true },
    });
    const data = `${header}.${payload}`;
    const signature = createHmac('sha256', keys.apiSecret).update(data).digest('base64url');
    return { url: `ws://127.0.0.1:${this.port}`, token: `${data}.${signature}`, room };
  }
}
