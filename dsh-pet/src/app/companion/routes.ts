/**
 * 设置中心的 HTTP 处理器：页面、静态资源、设置读写、连接测试与运行信息。
 *
 * 令牌校验由 router 的安全层完成（页面/静态资源公开读，settings/test/info 需要令牌）；
 * 本模块只做请求体限长、JSON 校验与调用存储/AI 服务。
 * @module dsh-pet/src/app/companion/routes
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { StandaloneAiService } from '../../standalone/ai-provider.ts';
import type { CompanionStore } from './config.ts';
import { companionPage, companionScript, companionStyle } from './page.ts';
import type { VoiceSupervisor } from './supervisor.ts';
import { EDGE_VOICES, MELO_VOICE, meloAvailable, renderPreview } from './voices.ts';

const MAX_BODY = 64 * 1024;

export interface CompanionInfo {
  version: string;
  port: number;
  pets: Array<{ id: string; name: string; display: string }>;
}

export interface CompanionHandlers {
  page: (req: IncomingMessage, res: ServerResponse) => void;
  script: (req: IncomingMessage, res: ServerResponse) => void;
  style: (req: IncomingMessage, res: ServerResponse) => void;
  settings: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  test: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  info: (req: IncomingMessage, res: ServerResponse) => void;
  runtime: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  voiceToken: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  voiceOpen: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  voiceClose: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  voicePage: (req: IncomingMessage, res: ServerResponse) => void;
  voiceScript: (req: IncomingMessage, res: ServerResponse) => void;
  voiceClient: (req: IncomingMessage, res: ServerResponse) => void;
  voices: (req: IncomingMessage, res: ServerResponse) => void;
  voicePreview: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  transcriptPage: (req: IncomingMessage, res: ServerResponse) => void;
  transcriptScript: (req: IncomingMessage, res: ServerResponse) => void;
  voiceTranscript: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
}

function sendAsset(res: ServerResponse, type: string, body: string): void {
  res.writeHead(200, {
    'content-type': `${type}; charset=utf-8`,
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((accept, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
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

export function createCompanionHandlers(deps: {
  store: CompanionStore;
  ai: StandaloneAiService;
  supervisor: VoiceSupervisor;
  voiceDir: string;
  openVoice: () => Promise<void>;
  closeVoice: () => Promise<void>;
  stopVoice: () => Promise<void>;
  runtime: { python?: string; agentRoot?: string; meloDir: string };
  readTranscript: () => Promise<Array<{ role: string; text: string; ts: number }>>;
  info: () => CompanionInfo;
}): CompanionHandlers {
  const { store, ai, supervisor, voiceDir, openVoice, closeVoice, stopVoice, runtime, readTranscript, info } = deps;

  const voiceAsset =
    (name: string, type: string) =>
    (_req: IncomingMessage, res: ServerResponse): void => {
      const file = join(voiceDir, name);
      if (!existsSync(file)) {
        sendJson(res, 404, { error: '语音资源缺失' });
        return;
      }
      sendAsset(res, type, readFileSync(file, 'utf8'));
    };

  async function syncLegacyAi(): Promise<void> {
    const provider = store.activeProvider();
    if (!provider) return;
    const key = store.providerKey(provider.id);
    const enabled = Boolean(provider.enabled && key && provider.baseUrl && provider.model);
    await ai.saveSettings({
      protocol: provider.protocol,
      baseUrl: provider.baseUrl,
      model: provider.model,
      apiKey: key,
      enabled,
      automaticWhispers: false,
      whisperIntervalSec: 300,
      maxTokens: provider.maxTokens,
      timeoutMs: 30_000,
    });
  }

  return {
    page(req, res) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendJson(res, 405, { error: '仅支持 GET' });
        return;
      }
      sendAsset(res, 'text/html', companionPage);
    },
    script(_req, res) {
      sendAsset(res, 'text/javascript', companionScript);
    },
    style(_req, res) {
      sendAsset(res, 'text/css', companionStyle);
    },
    info(req, res) {
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: '仅支持 GET' });
        return;
      }
      sendJson(res, 200, info());
    },
    async settings(req, res) {
      if (req.method === 'GET') {
        sendJson(res, 200, { ...store.publicView(), aiEnabled: ai.isReady() });
        return;
      }
      if (req.method !== 'PUT') {
        sendJson(res, 405, { error: '仅支持 GET / PUT' });
        return;
      }
      let body: unknown;
      try {
        body = JSON.parse((await readBody(req)) || '{}');
      } catch {
        sendJson(res, 400, { error: '请求体不是合法 JSON' });
        return;
      }
      try {
        const saved = store.save(body);
        process.env.DSH_PET_CONTEXT_BUDGET = String(saved.chat.contextBudgetTokens);
        process.env.DSH_PET_CONTEXT_KEEP = String(saved.chat.contextKeepRecentTurns);
        process.env.DSH_PET_CONTEXT_COMPRESS_AT = String(saved.chat.contextCompressAt);
        process.env.DSH_PET_CONTEXT_REMIND_EVERY = String(saved.chat.contextRemindEvery);
        process.env.DSH_PET_ARCHIVE_DIR = `${saved.chat.memoryDir}/archive`;
        process.env.DSH_PET_ARCHIVE_MAX_MESSAGES = String(saved.chat.archiveMaxMessages);
        process.env.DSH_PET_RETRIEVAL_ENABLED = saved.chat.retrievalEnabled ? '1' : '0';
        process.env.DSH_PET_RETRIEVAL_TOPK = String(saved.chat.retrievalTopK);
        process.env.DSH_PET_RETRIEVAL_MAXCHARS = String(saved.chat.retrievalMaxChars);
        // 专注模式 + 静音：保存后立即关闭语音，避免“开了专注还在说话”
        if (saved.focus.enabled && saved.focus.muteVoice) await closeVoice();
      } catch (error) {
        sendJson(res, 400, { error: error instanceof Error ? error.message : '设置无效' });
        return;
      }
      let aiError = '';
      try {
        await syncLegacyAi();
      } catch (error) {
        aiError = error instanceof Error ? error.message : '模型设置同步失败';
      }
      sendJson(res, 200, { ...store.publicView(), aiEnabled: ai.isReady(), aiError });
    },
    async test(req, res) {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: '仅支持 POST' });
        return;
      }
      let body: { providerId?: string; apiKey?: string } = {};
      try {
        body = JSON.parse((await readBody(req)) || '{}') as typeof body;
      } catch {
        sendJson(res, 400, { error: '请求体不是合法 JSON' });
        return;
      }
      const provider = store.current().providers.find((p) => p.id === body.providerId) ?? store.activeProvider();
      if (!provider) {
        sendJson(res, 400, { error: '找不到该服务商' });
        return;
      }
      const apiKey = body.apiKey?.trim() || store.providerKey(provider.id);
      if (!provider.baseUrl || !provider.model || !apiKey) {
        sendJson(res, 200, { ok: false, message: '请先填写 Base URL、模型与 API Key' });
        return;
      }
      try {
        const result = await ai.testConnection({
          protocol: provider.protocol,
          baseUrl: provider.baseUrl,
          model: provider.model,
          apiKey,
        });
        sendJson(res, 200, result);
      } catch (error) {
        sendJson(res, 200, { ok: false, message: error instanceof Error ? error.message : '测试失败' });
      }
    },
    async runtime(req, res) {
      if (req.method === 'GET') {
        sendJson(res, 200, supervisor.status());
        return;
      }
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: '仅支持 GET / POST' });
        return;
      }
      let body: { action?: string } = {};
      try {
        body = JSON.parse((await readBody(req)) || '{}') as typeof body;
      } catch {
        sendJson(res, 400, { error: '请求体不是合法 JSON' });
        return;
      }
      try {
        if (body.action === 'start') await supervisor.ensureStarted();
        else if (body.action === 'stop') await stopVoice();
        else if (body.action === 'restart') {
          await stopVoice();
          await supervisor.ensureStarted();
        } else if (body.action === 'touch') supervisor.touch();
        else {
          sendJson(res, 400, { error: 'action 只能是 start / stop / restart / touch' });
          return;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendJson(res, 200, { ...supervisor.status(), error: message });
        return;
      }
      sendJson(res, 200, supervisor.status());
    },
    async voiceToken(req, res) {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: '仅支持 POST' });
        return;
      }
      let body: { identity?: string; room?: string } = {};
      try {
        body = JSON.parse((await readBody(req)) || '{}') as typeof body;
      } catch {
        sendJson(res, 400, { error: '请求体不是合法 JSON' });
        return;
      }
      const identity = String(body.identity ?? '').trim();
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(identity)) {
        sendJson(res, 400, { error: 'identity 只能包含字母/数字/下划线/短横线' });
        return;
      }
      try {
        await supervisor.ensureStarted();
        if (!supervisor.status().running) throw new Error(supervisor.status().error || '语音服务未就绪');
        const room = supervisor.status().room;
        supervisor.touch();
        sendJson(res, 200, supervisor.mintJoinToken(identity, room));
      } catch (error) {
        sendJson(res, 503, { error: error instanceof Error ? error.message : '语音服务未就绪' });
      }
    },
    voicePage: voiceAsset('voice.html', 'text/html'),
    voiceScript: voiceAsset('voice.js', 'text/javascript'),
    voiceClient: voiceAsset('livekit-client.umd.js', 'text/javascript'),
    transcriptPage: voiceAsset('transcript.html', 'text/html'),
    transcriptScript: voiceAsset('transcript.js', 'text/javascript'),
    voices(_req, res) {
      sendJson(res, 200, {
        edge: EDGE_VOICES,
        melo: { ...MELO_VOICE, available: meloAvailable(runtime.meloDir) },
      });
    },
    async voicePreview(req, res) {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: '仅支持 POST' });
        return;
      }
      let body: { engine?: string; voice?: string; text?: string; rate?: string; pitch?: string; volume?: string } = {};
      try {
        body = JSON.parse((await readBody(req)) || '{}') as typeof body;
      } catch {
        sendJson(res, 400, { error: '请求体不是合法 JSON' });
        return;
      }
      const text = String(body.text ?? '').trim();
      if (!text || text.length > 200) {
        sendJson(res, 400, { error: '试听文本需为 1–200 字' });
        return;
      }
      const engine = body.engine === 'melo' ? 'melo' : 'edge';
      if (!runtime.python || !runtime.agentRoot) {
        sendJson(res, 503, { error: '未找到 Python/Agent 目录，无法试听' });
        return;
      }
      if (engine === 'melo' && !meloAvailable(runtime.meloDir)) {
        sendJson(res, 400, { error: 'MeloTTS 模型未安装（models/melo-tts）' });
        return;
      }
      try {
        const wav = await renderPreview({
          engine,
          voice: String(body.voice ?? ''),
          text,
          rate: body.rate,
          pitch: body.pitch,
          volume: body.volume,
          meloDir: runtime.meloDir,
          python: runtime.python,
          agentRoot: runtime.agentRoot,
        });
        res.writeHead(200, {
          'content-type': 'audio/wav',
          'content-length': wav.length,
          'cache-control': 'no-store',
        });
        res.end(wav);
      } catch (error) {
        sendJson(res, 500, { error: error instanceof Error ? error.message : '试听失败' });
      }
    },
    async voiceTranscript(req, res) {
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: '仅支持 GET' });
        return;
      }
      sendJson(res, 200, { ok: true, messages: await readTranscript() });
    },
    async voiceOpen(req, res) {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: '仅支持 POST' });
        return;
      }
      try {
        await openVoice();
        sendJson(res, 200, { ok: true, ...supervisor.status() });
      } catch (error) {
        sendJson(res, 200, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          ...supervisor.status(),
        });
      }
    },
    async voiceClose(req, res) {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: '仅支持 POST' });
        return;
      }
      await closeVoice();
      sendJson(res, 200, { ok: true, ...supervisor.status() });
    },
  };
}
