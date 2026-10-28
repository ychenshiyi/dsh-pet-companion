/** 语音试听：Edge TTS 音色清单 + 本机 Python 合成（WAV）。 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface VoiceOption {
  id: string;
  label: string;
  locale: string;
  gender: 'female' | 'male';
}

/** 常用中文 Edge 音色（其余可手填 voice id）。 */
export const EDGE_VOICES: VoiceOption[] = [
  { id: 'zh-CN-XiaoxiaoNeural', label: '晓晓 · 温柔女声', locale: 'zh-CN', gender: 'female' },
  { id: 'zh-CN-XiaoyiNeural', label: '晓伊 · 活泼女声', locale: 'zh-CN', gender: 'female' },
  { id: 'zh-CN-XiaochenNeural', label: '晓辰 · 自然女声', locale: 'zh-CN', gender: 'female' },
  { id: 'zh-CN-XiaohanNeural', label: '晓涵 · 知性女声', locale: 'zh-CN', gender: 'female' },
  { id: 'zh-CN-XiaomengNeural', label: '晓梦 · 甜美女声', locale: 'zh-CN', gender: 'female' },
  { id: 'zh-CN-XiaoqiuNeural', label: '晓秋 · 成熟女声', locale: 'zh-CN', gender: 'female' },
  { id: 'zh-CN-XiaoruiNeural', label: '晓睿 · 沉稳女声', locale: 'zh-CN', gender: 'female' },
  { id: 'zh-CN-XiaoxuanNeural', label: '晓萱 · 干练女声', locale: 'zh-CN', gender: 'female' },
  { id: 'zh-CN-XiaoyanNeural', label: '晓颜 · 亲切女声', locale: 'zh-CN', gender: 'female' },
  { id: 'zh-CN-YunxiNeural', label: '云希 · 清爽男声', locale: 'zh-CN', gender: 'male' },
  { id: 'zh-CN-YunjianNeural', label: '云健 · 浑厚男声', locale: 'zh-CN', gender: 'male' },
  { id: 'zh-CN-YunyangNeural', label: '云扬 · 新闻男声', locale: 'zh-CN', gender: 'male' },
  { id: 'zh-CN-YunxiaNeural', label: '云夏 · 少年男声', locale: 'zh-CN', gender: 'male' },
  { id: 'zh-CN-YunzeNeural', label: '云泽 · 低沉男声', locale: 'zh-CN', gender: 'male' },
  { id: 'zh-HK-HiuMaanNeural', label: '曉曼 · 粤语女声', locale: 'zh-HK', gender: 'female' },
  { id: 'zh-TW-HsiaoChenNeural', label: '曉臻 · 台湾女声', locale: 'zh-TW', gender: 'female' },
];

export const MELO_VOICE: VoiceOption = {
  id: 'melo-zh-en',
  label: 'MeloTTS · 中英离线',
  locale: 'zh-CN',
  gender: 'female',
};

export function meloAvailable(meloDir: string): boolean {
  return existsSync(join(meloDir, 'model.onnx'));
}

export interface PreviewRequest {
  engine: 'edge' | 'melo';
  voice: string;
  text: string;
  rate?: string;
  pitch?: string;
  volume?: string;
  meloDir: string;
  python: string;
  agentRoot: string;
}

/** 起一次 Python 进程合成，返回 WAV 字节。 */
export function renderPreview(request: PreviewRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      engine: request.engine,
      voice: request.voice,
      text: request.text,
      rate: request.rate || '+0%',
      pitch: request.pitch || '+0Hz',
      volume: request.volume || '+0%',
      meloDir: request.meloDir,
    });
    const child = spawn(request.python, ['-m', 'agent.preview', payload], {
      cwd: request.agentRoot,
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(() => reject(new Error('试听超时（30 秒）')));
    }, 30_000);
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    child.on('error', (error) => finish(() => reject(error)));
    child.on('close', (code) => {
      if (code !== 0) {
        const message = Buffer.concat(err).toString('utf8').trim() || `试听进程退出（${code}）`;
        finish(() => reject(new Error(message.slice(0, 500))));
        return;
      }
      const buffer = Buffer.concat(out);
      if (buffer.length < 64) {
        finish(() => reject(new Error('试听没有返回音频')));
        return;
      }
      finish(() => resolve(buffer));
    });
  });
}
