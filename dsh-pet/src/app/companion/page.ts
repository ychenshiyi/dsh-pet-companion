/** 伴侣设置中心页面（HTML/CSS/JS 三份字符串，路由按 /companion/ 提供）。 */
export const companionPage = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>桌宠伴侣设置</title>
<link rel="icon" href="data:," />
<link rel="stylesheet" href="/companion/style.css">
<script src="/companion/app.js" defer></script></head>
<body>
<header class="top"><div class="brand"><span class="logo">🐾</span><div><h1>桌宠伴侣设置</h1>
<p class="sub">独立应用 · 所有配置只保存在本机</p></div></div><div id="status" class="status" role="status" aria-live="polite">正在读取…</div></header>

<nav class="tabs" id="tabs">
<button data-tab="model" class="active">模型</button>
<button data-tab="voice">语音</button>
<button data-tab="chat">对话</button>
<button data-tab="emotion">情感</button>
<button data-tab="care">陪伴</button>
<button data-tab="pets">宠物</button>
<button data-tab="display">显示</button>
<button data-tab="livekit">LiveKit</button>
<button data-tab="about">路径 / 关于</button>
</nav>

<main>
<section data-panel="model" class="panel active">
  <div class="card">
    <div class="row between"><h2>模型服务商</h2><div class="row">
      <button id="add-provider" type="button" class="ghost">新增</button>
      <button id="del-provider" type="button" class="ghost danger">删除</button>
    </div></div>
    <label>当前使用</label>
    <select id="provider-select"></select>
    <div class="grid2">
      <div><label>显示名称</label><input id="p-name" maxlength="64" /></div>
      <div><label>协议</label><select id="p-protocol"><option value="openai-compatible">OpenAI 兼容</option><option value="anthropic">Anthropic</option></select></div>
      <div class="wide"><label>Base URL</label><input id="p-baseUrl" placeholder="https://api.deepseek.com/v1" spellcheck="false" /></div>
      <div><label>模型</label><input id="p-model" placeholder="deepseek-chat" spellcheck="false" /></div>
      <div><label>API Key</label><input id="p-apiKey" type="password" autocomplete="new-password" placeholder="留空则保留已保存的密钥" /><p class="hint" id="p-key-state"></p></div>
      <div><label>温度（0–2）</label><input id="p-temperature" type="number" min="0" max="2" step="0.1" /></div>
      <div><label>单次输出上限（tokens）</label><input id="p-maxTokens" type="number" min="64" max="8192" step="1" /></div>
    </div>
    <label class="check"><input id="p-enabled" type="checkbox" /> 启用这个服务商</label>
    <div class="row"><button id="test-provider" type="button" class="ghost">测试连接</button><span id="test-result" class="note"></span></div>
    <p class="hint">默认 DeepSeek：Base URL 填 <code>https://api.deepseek.com/v1</code>，模型填 <code>deepseek-chat</code>。密钥只写入本机 ACL 文件，不回显。</p>
  </div>
</section>

<section data-panel="voice" class="panel">
  <div class="card"><h2>语音合成（音色）</h2>
    <div class="grid2">
      <div><label>引擎</label><select id="v-engine"><option value="edge">Edge TTS（免费在线）</option><option value="melo">MeloTTS（本地离线）</option></select></div>
      <div><label>音色</label><select id="v-voice"></select><p class="hint" id="v-voice-note"></p></div>
      <div><label>语速（如 +10%）</label><input id="v-rate" placeholder="+0%" /></div>
      <div><label>音调（如 +2Hz）</label><input id="v-pitch" placeholder="+0Hz" /></div>
      <div><label>音量（如 +0%）</label><input id="v-volume" placeholder="+0%" /></div>
      <div><label>识别语言</label><input id="v-sttLanguage" placeholder="zh" /></div>
      <div><label>唤醒词</label><input id="v-wakeWord" maxlength="16" placeholder="小鱼" /></div>
      <div><label>空闲多久后需要唤醒（秒）</label><input id="v-wakeIdle" type="number" min="3" max="120" step="1" /></div>
    </div>
    <label>试听文本</label><textarea id="v-text" rows="2" maxlength="200" style="width:100%;border:1px solid #b9c8d6;border-radius:8px;padding:8px 11px;font:inherit">主人，我在呢。今天想聊点什么呀？</textarea>
    <p class="hint">语音常开：开启后可直接说话；超过空闲秒数没对话，下一句需要先说唤醒词（默认「小鱼」）。</p>
    <div class="row" style="margin-top:10px"><button id="v-preview" type="button" class="ghost">试听</button><span id="v-preview-state" class="note"></span></div>
    <audio id="v-audio" controls style="width:100%;margin-top:10px;display:none"></audio>
    <p class="hint">Edge 音色在线合成；MeloTTS 需要本地模型（models/melo-tts，约 170MB）。保存后语音会话重启生效。</p>
  </div>
</section>

<section data-panel="chat" class="panel">
  <div class="card"><h2>对话与上下文</h2>
    <label>上下文存储目录</label><input id="c-memoryDir" spellcheck="false" />
    <label>每次携带最近轮数（0–50）</label><input id="c-rounds" type="number" min="0" max="50" step="1" />
    <p class="hint">文本与语音共用 <code>&lt;目录&gt;/memory.json</code>；首次会自动迁移旧文件。修改目录后需重启应用生效。</p>
  </div>
</section>

<section data-panel="emotion" class="panel">
  <div class="card"><h2>情感养成 v1</h2>
    <label><input type="checkbox" id="e-enabled" /> 启用情感养成（修改后需重启应用）</label>
    <p class="hint">关系状态只影响提示词语气与情绪动画；数值透明、可随时重置，不做付费加速。</p>
    <div id="e-bars"></div>
    <p id="e-mood" class="hint"></p>
    <h3>最近情节</h3><ul id="e-episodes"></ul>
    <h3>记得的事</h3><ul id="e-facts"></ul>
    <h3>成长日志</h3><ul id="e-insights"></ul>
    <div class="row"><button id="e-reset" type="button" class="ghost">重置成长</button><span id="e-reset-state" class="note"></span></div>
  </div>
</section>

<section data-panel="care" class="panel">
  <div class="card"><h2>用量 / 配额</h2>
    <p class="hint" id="u-today">读取中…</p>
    <div class="grid2">
      <div><label>每日 token 上限（0 = 不限）</label><input id="u-limit" type="number" min="0" max="10000000" step="1000" /></div>
      <div><label>提醒阈值（%）</label><input id="u-warn" type="number" min="50" max="100" step="5" /></div>
      <div><label>每 1k token 估算价格（元，0 = 不估算）</label><input id="u-price" type="number" min="0" step="0.001" /></div>
    </div>
    <ul id="u-days"></ul>
  </div>
  <div class="card"><h2>主动关心</h2>
    <label><input type="checkbox" id="p-enabled" /> 允许桌宠在空闲时主动说话（默认关）</label>
    <div class="grid2">
      <div><label>安静开始</label><input id="p-quietStart" placeholder="23:00" /></div>
      <div><label>安静结束</label><input id="p-quietEnd" placeholder="08:00" /></div>
      <div><label>每日最多主动次数</label><input id="p-daily" type="number" min="0" max="100" /></div>
      <div><label>两次之间至少（分钟）</label><input id="p-interval" type="number" min="5" max="1440" /></div>
    </div>
  </div>
  <div class="card"><h2>专注模式</h2>
    <label><input type="checkbox" id="f-enabled" /> 关闭主动关心（会议/游戏）</label>
    <label><input type="checkbox" id="f-mute" /> 同时关闭语音（保存后立即生效）</label>
    <p class="hint">专注模式不会删除数据；取消勾选即恢复。</p>
  </div>
  <div class="card"><h2>提醒 / 日程</h2>
    <div class="grid2">
      <div><label>提醒内容</label><input id="r-text" maxlength="200" placeholder="起来喝水" /></div>
      <div><label>时间</label><input id="r-time" type="datetime-local" /></div>
    </div>
    <div class="row" style="margin-top:8px"><button id="r-add" type="button">添加提醒</button><span id="r-state" class="note"></span></div>
    <ul id="r-list"></ul>
  </div>
  <div class="card"><h2>回忆录</h2>
    <p class="hint">导出对话、关系状态、事实与成长日志为 Markdown。</p>
    <button id="memoir-export" type="button">导出回忆录</button>
    <span id="memoir-state" class="note"></span>
  </div>
</section>

<section data-panel="pets" class="panel">
  <div class="card"><h2>语音宠物</h2>
    <p class="hint">选择语音对话代表哪只宠物；音色/人设留空则用「语音」页默认。</p>
    <label>语音对话使用</label><select id="pet-active"></select>
    <label>音色覆盖（Edge voice id，留空 = 默认）</label><input id="pet-voice" placeholder="zh-CN-XiaoxiaoNeural" spellcheck="false" />
    <label>人设补充（留空 = 用原桌宠人设）</label><textarea id="pet-persona" rows="4" style="width:100%;border:1px solid #b9c8d6;border-radius:8px;padding:8px 11px;font:inherit"></textarea>
    <p class="hint">文本对话仍读取原 main-config 的每只宠物人设；这里的音色/人设只作用于语音会话。</p>
  </div>
</section>

<section data-panel="display" class="panel">
  <div class="card"><h2>显示位置</h2>
    <p class="hint">每只宠物选择显示位置；修改后桌面窗口会按新配置重建。等价于原右键「显示位置」。</p>
    <div id="display-list"><p class="hint">加载中…</p></div>
    <p id="display-state" class="note"></p>
  </div>
</section>

<section data-panel="livekit" class="panel">
  <div class="card"><h2>LiveKit</h2>
    <div class="grid2">
      <div><label>模式</label><select id="l-mode"><option value="disabled">关闭（仅文本）</option><option value="embedded">内置（应用拉起）</option><option value="external">连接外部服务</option></select></div>
      <div><label>端口</label><input id="l-port" type="number" min="1" max="65535" /></div>
      <div><label>房间名</label><input id="l-room" maxlength="64" /></div>
      <div><label>外部地址</label><input id="l-url" placeholder="ws://127.0.0.1:7880" spellcheck="false" /></div>
    </div>
    <p class="hint">内置模式会在语音开启时自动拉起 LiveKit 与 Agent，关闭后退出（P2/P4）。</p>
    <div class="row" style="margin-top:14px"><button id="runtime-toggle" type="button">启动语音服务</button><span id="runtime-state" class="note">读取中…</span></div>
    <pre id="runtime-log" class="hint" style="white-space:pre-wrap;max-height:140px;overflow:auto"></pre>
  </div>
</section>

<section data-panel="about" class="panel">
  <div class="card"><h2>本机路径</h2><dl id="paths"><dt>加载中</dt></dl></div>
  <div class="card"><h2>宠物</h2><ul id="pets"></ul><p class="hint">桌宠配置仍由原 <code>main-config.jsonc</code> 管理，本页不修改它。</p></div>
  <div class="card"><h2>版本</h2><p id="version" class="hint"></p></div>
</section>
</main>

<footer class="footer"><span id="save-state" class="note"></span><div class="row">
<button id="save" class="primary">保存设置</button></div></footer>
</body></html>`;

export const companionStyle = `
:root{color-scheme:light;--ink:#1f2d3a;--muted:#5b6b7a;--blue:#1f6feb;--line:#d8e1ea;--paper:#fff;--bg:#f4f7fb}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 "Microsoft YaHei UI","PingFang SC",system-ui,sans-serif}
.top{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:22px 28px 10px;max-width:980px;margin:0 auto}
.brand{display:flex;gap:14px;align-items:center}.logo{font-size:30px}h1{font-size:22px;margin:0}.sub{margin:2px 0 0;color:var(--muted);font-size:13px}
.status{font-size:13px;color:var(--blue);min-height:22px}
.tabs{display:flex;gap:6px;max-width:980px;margin:0 auto;padding:10px 28px 0;border-bottom:1px solid var(--line);flex-wrap:wrap}
.tabs button{border:0;background:transparent;color:var(--muted);font:inherit;padding:10px 14px;border-radius:8px 8px 0 0;cursor:pointer}
.tabs button.active{background:var(--paper);color:var(--ink);font-weight:600;border:1px solid var(--line);border-bottom-color:var(--paper);margin-bottom:-1px}
main{max-width:980px;margin:0 auto;padding:18px 28px 90px}
.panel{display:none}.panel.active{display:block}
.card{background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:20px 22px;margin-bottom:16px}
h2{font-size:16px;margin:0 0 14px}
label{display:block;font-size:13px;color:var(--muted);margin:12px 0 5px}
input:not([type=checkbox]),select{width:100%;min-height:40px;border:1px solid #b9c8d6;border-radius:8px;background:#fff;color:var(--ink);padding:8px 11px;font:inherit;font-size:14px}
input:focus,select:focus{outline:2px solid rgba(31,111,235,.35);border-color:var(--blue)}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px 18px}.wide{grid-column:1/-1}
.row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.between{justify-content:space-between}
.check{display:flex;align-items:center;gap:8px;color:var(--ink);font-size:14px;margin-top:14px}
button{border:1px solid var(--line);background:#fff;color:var(--ink);border-radius:8px;min-height:38px;padding:8px 16px;font:inherit;font-size:14px;cursor:pointer}
button:hover{background:#eef4fc}button.primary{background:var(--blue);border-color:var(--blue);color:#fff}button.ghost{background:#f7fafd}
button.danger{color:#b42318}.hint{font-size:12px;color:var(--muted);line-height:1.6;margin:6px 0 0}
.note{font-size:13px;color:var(--blue);min-height:20px}.note.error{color:#b42318}.note.ok{color:#1a7f37}
.footer{position:fixed;left:0;right:0;bottom:0;background:rgba(244,247,251,.96);border-top:1px solid var(--line);padding:12px 28px;display:flex;justify-content:space-between;align-items:center;gap:14px}
dl{display:grid;grid-template-columns:160px 1fr;gap:8px 14px;margin:0}dt{color:var(--muted);font-size:13px}dd{margin:0;font-family:Consolas,monospace;font-size:12px;word-break:break-all}
ul{margin:0;padding-left:20px}code{background:#eef2f7;border:1px solid var(--line);border-radius:5px;padding:1px 5px;font-size:12px}
a{color:var(--blue)}@media(max-width:640px){.grid2{grid-template-columns:1fr}main,.top,.tabs{padding-left:14px;padding-right:14px}.footer{padding:10px 14px}}
`;

export const companionScript = `
'use strict';
(() => {
  const token = new URLSearchParams(location.hash.slice(1)).get('token') || '';
  const initialTab = new URLSearchParams(location.search).get('tab') || new URLSearchParams(location.hash.slice(1)).get('tab') || '';
  history.replaceState(null, '', location.pathname);
  const $ = (id) => document.getElementById(id);
  let data = null;
  let providers = [];
  let current = null;
  let dirty = false;
  let voices = null;
  let statePetId = 'main';
  let infoPets = [];

  const setStatus = (text, cls) => { const el = $('status'); el.textContent = text; el.className = 'status ' + (cls || ''); };
  const setSave = (text, cls) => { const el = $('save-state'); el.textContent = text; el.className = 'note ' + (cls || ''); };
  const markDirty = () => { dirty = true; setSave('有未保存的修改'); };

  async function api(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(path, {
        ...options,
        cache: 'no-store',
        credentials: 'omit',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'X-DSH-Pet-Token': token, ...(options.headers || {}) },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || ('HTTP ' + res.status));
      return body;
    } catch (error) {
      if (error && error.name === 'AbortError') throw new Error('请求超时（8 秒），请检查语音服务后重试');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  function providerFromForm() {
    return {
      id: current.id,
      name: $('p-name').value.trim(),
      protocol: $('p-protocol').value,
      baseUrl: $('p-baseUrl').value.trim(),
      model: $('p-model').value.trim(),
      temperature: Number($('p-temperature').value),
      maxTokens: Number($('p-maxTokens').value),
      enabled: $('p-enabled').checked,
      apiKey: $('p-apiKey').value.trim(),
    };
  }

  function stashProvider() {
    if (!current) return;
    const next = providerFromForm();
    const index = providers.findIndex((p) => p.id === current.id);
    if (index >= 0) providers[index] = { ...providers[index], ...next, hasKey: current.hasKey };
    current = providers[index];
  }

  function renderProviders() {
    const select = $('provider-select');
    select.innerHTML = '';
    for (const provider of providers) {
      const option = document.createElement('option');
      option.value = provider.id;
      option.textContent = provider.name + (provider.hasKey ? '' : '（未设密钥）');
      select.appendChild(option);
    }
    select.value = current.id;
    $('p-name').value = current.name;
    $('p-protocol').value = current.protocol;
    $('p-baseUrl').value = current.baseUrl;
    $('p-model').value = current.model;
    $('p-temperature').value = String(current.temperature);
    $('p-maxTokens').value = String(current.maxTokens);
    $('p-enabled').checked = current.enabled;
    $('p-apiKey').value = '';
    $('p-key-state').textContent = current.hasKey ? '已保存密钥 · 留空不修改' : '尚未设置密钥';
  }

  function selectProvider(id) {
    if (current) stashProvider();
    current = providers.find((p) => p.id === id) || providers[0];
    renderProviders();
  }

  async function runtime(action) {
    const button = $('runtime-toggle');
    if (button) button.disabled = true;
    try {
      const result = await api('/companion/runtime', { method: 'POST', body: JSON.stringify({ action }) });
      renderRuntime(result);
    } catch (error) {
      $('runtime-state').className = 'note error';
      $('runtime-state').textContent = '操作失败：' + error.message;
    } finally {
      if (button) button.disabled = false;
    }
  }

  function renderRuntime(status) {
    const running = Boolean(status.running);
    $('runtime-toggle').textContent = running ? '停止语音服务' : '启动语音服务';
    $('runtime-state').className = 'note ' + (status.phase === 'error' ? 'error' : running ? 'ok' : '');
    $('runtime-state').textContent =
      (running ? '运行中' : status.phase === 'error' ? '启动失败' : '未运行') +
      (status.port ? ' · 端口 ' + status.port : '') +
      (status.room ? ' · 房间 ' + status.room : '') +
      (status.error ? ' · ' + status.error : '');
    $('runtime-log').textContent = (status.logTail || []).slice(-8).join('\\n');
  }

  async function refreshRuntime() {
    try {
      renderRuntime(await api('/companion/runtime'));
    } catch (error) {
      const el = $('runtime-state');
      if (el) {
        el.className = 'note error';
        el.textContent = '读取失败：' + error.message;
      }
    }
  }

  function fillVoiceOptions(selected) {
    const engine = $('v-engine').value;
    const list = engine === 'melo' ? [voices.melo] : voices.edge;
    const select = $('v-voice');
    select.innerHTML = '';
    for (const voice of list) {
      const option = document.createElement('option');
      option.value = voice.id;
      option.textContent = voice.label;
      select.appendChild(option);
    }
    if (selected && !list.some((voice) => voice.id === selected)) {
      const option = document.createElement('option');
      option.value = selected;
      option.textContent = selected;
      select.appendChild(option);
    }
    select.value = selected || (list[0] ? list[0].id : '');
    $('v-voice-note').textContent =
      engine === 'melo' ? (voices.melo.available ? '本地模型已就绪' : '未安装模型：models/melo-tts') : '';
  }

  async function loadVoices(selected) {
    voices = await api('/companion/voices');
    fillVoiceOptions(selected);
  }

  async function previewVoice() {
    const button = $('v-preview');
    button.disabled = true;
    $('v-preview-state').className = 'note';
    $('v-preview-state').textContent = '合成中…';
    try {
      const res = await fetch('/companion/voice/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-DSH-Pet-Token': token },
        body: JSON.stringify({
          engine: $('v-engine').value,
          voice: $('v-voice').value,
          text: $('v-text').value,
          rate: $('v-rate').value,
          pitch: $('v-pitch').value,
          volume: $('v-volume').value,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || ('HTTP ' + res.status));
      }
      const blob = await res.blob();
      const audio = $('v-audio');
      if (audio.dataset.url) URL.revokeObjectURL(audio.dataset.url);
      const url = URL.createObjectURL(blob);
      audio.dataset.url = url;
      audio.src = url;
      audio.style.display = 'block';
      await audio.play().catch(() => {});
      $('v-preview-state').className = 'note ok';
      $('v-preview-state').textContent = '试听已生成';
    } catch (error) {
      $('v-preview-state').className = 'note error';
      $('v-preview-state').textContent = '试听失败：' + error.message;
    } finally {
      button.disabled = false;
    }
  }

  const moodLabel = { happy: '开心', calm: '平静', shy: '有点害羞', sad: '低落', angry: '有点生气', tired: '疲惫' };

  function renderEmotion(state) {
    const bars = [
      ['好感', state.affection],
      ['信任', state.trust],
      ['熟悉', state.familiarity],
      ['精力', state.energy],
    ];
    $('e-bars').innerHTML = bars
      .map(([label, value]) =>
        '<div style="display:flex;align-items:center;gap:10px;margin:8px 0"><span style="width:40px;color:#5b6b7a">' +
        label +
        '</span><progress max="100" value="' +
        Number(value) +
        '" style="flex:1;height:14px"></progress><b style="width:34px;text-align:right">' +
        Number(value) +
        '</b></div>',
      )
      .join('');
    $('e-mood').textContent =
      '当前心情：' + (moodLabel[state.mood] || state.mood) +
      ' · 用户情绪：' + (moodLabel[state.userMood] || state.userMood || '平静') +
      ' · 已聊 ' + state.turns + ' 轮';
    const list = (id, items, format) => {
      const el = $(id);
      el.innerHTML = '';
      for (const item of items) {
        const li = document.createElement('li');
        li.textContent = format(item);
        el.appendChild(li);
      }
      if (items.length === 0) {
        const li = document.createElement('li');
        li.textContent = '暂无';
        li.style.color = '#8a9aaa';
        el.appendChild(li);
      }
    };
    list('e-episodes', state.episodes.slice(-8).reverse(), (item) => '[' + (moodLabel[item.emotion] || item.emotion) + '] ' + item.summary);
    list('e-facts', state.facts.slice(-8).reverse(), (item) => item.text);
    list('e-insights', state.insights.slice(-5).reverse(), (item) => item);
  }

  async function loadEmotion() {
    const res = await fetch('/dsh-pet-7340/emotion?pet=' + encodeURIComponent(statePetId), {
      headers: { 'X-DSH-Pet-Token': token },
      cache: 'no-store',
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) throw new Error(body.message || body.error || ('HTTP ' + res.status));
    renderEmotion(body.state);
  }

  const displayLabel = { desktop: '仅桌面', web: '仅网页', both: '两者', none: '都不' };

  async function applyDisplay(petId, display, select) {
    select.disabled = true;
    $('display-state').className = 'note';
    $('display-state').textContent = '应用中…';
    try {
      const res = await fetch('/dsh-pet-7340/pet-display', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-DSH-Pet-Token': token },
        body: JSON.stringify({ id: petId, display }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.ok === false) throw new Error(body.message || body.error || ('HTTP ' + res.status));
      const pet = infoPets.find((item) => item.id === petId);
      if (pet) pet.display = display;
      $('display-state').className = 'note ok';
      $('display-state').textContent = '已应用：' + (displayLabel[display] || display) + '（桌面窗口会重建）';
    } catch (error) {
      $('display-state').className = 'note error';
      $('display-state').textContent = '修改失败：' + error.message;
      select.value = infoPets.find((item) => item.id === petId)?.display || select.value;
    } finally {
      select.disabled = false;
    }
  }

  function renderDisplay() {
    const box = $('display-list');
    box.innerHTML = '';
    if (infoPets.length === 0) {
      box.innerHTML = '<p class="hint">没有桌宠</p>';
      return;
    }
    for (const pet of infoPets) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;margin:10px 0';
      const label = document.createElement('span');
      label.textContent = pet.name || pet.id;
      const select = document.createElement('select');
      select.style.width = '220px';
      for (const [value, text] of Object.entries(displayLabel)) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = text;
        select.appendChild(option);
      }
      select.value = pet.display || 'desktop';
      select.addEventListener('change', () => void applyDisplay(pet.id, select.value, select));
      row.append(label, select);
      box.appendChild(row);
    }
  }

  const fmtTokens = (n) => (n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n));

  async function loadUsage() {
    try {
      const res = await fetch('/dsh-pet-7340/usage', {
        headers: { 'X-DSH-Pet-Token': token },
        cache: 'no-store',
      });
      const body = await res.json();
      if (!body.ok) throw new Error(body.error || '读取失败');
      $('u-today').textContent =
        '今日 ' + fmtTokens(body.today.input + body.today.output) + ' tokens' +
        ' · 文本 ' + fmtTokens(body.bySurface.text.input + body.bySurface.text.output) +
        ' / 语音 ' + fmtTokens(body.bySurface.voice.input + body.bySurface.voice.output) +
        ' · ' + body.today.calls + ' 次调用' +
        ' · 约 ¥' + ((body.today.input + body.today.output) / 1000 * (Number($('u-price').value) || 0)).toFixed(3);
      const list = $('u-days');
      list.innerHTML = '';
      for (const day of body.days.slice(0, 7)) {
        const li = document.createElement('li');
        li.textContent = day.day + '：' + fmtTokens(day.input + day.output) + ' tokens / ' + day.calls + ' 次';
        list.appendChild(li);
      }
    } catch (error) {
      $('u-today').textContent = '用量读取失败：' + error.message;
    }
  }

  function renderReminders(items) {
    const list = $('r-list');
    list.innerHTML = '';
    if (!items.length) {
      const li = document.createElement('li');
      li.textContent = '暂无提醒';
      li.style.color = '#8a9aaa';
      list.appendChild(li);
      return;
    }
    for (const item of items) {
      const li = document.createElement('li');
      li.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;margin:6px 0';
      const label = document.createElement('span');
      label.textContent = new Date(item.dueAt).toLocaleString() + ' · ' + item.text;
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'ghost';
      del.textContent = '删除';
      del.addEventListener('click', async () => {
        await fetch('/dsh-pet-7340/reminders?id=' + encodeURIComponent(item.id) + '&pet=' + encodeURIComponent(statePetId), {
          method: 'DELETE',
          headers: { 'X-DSH-Pet-Token': token },
        });
        await loadReminders();
      });
      li.append(label, del);
      list.appendChild(li);
    }
  }

  async function loadReminders() {
    try {
      const res = await fetch('/dsh-pet-7340/reminders?pet=' + encodeURIComponent(statePetId), {
        headers: { 'X-DSH-Pet-Token': token },
        cache: 'no-store',
      });
      const body = await res.json();
      if (!body.ok) throw new Error(body.error || '读取失败');
      renderReminders(body.items || []);
    } catch (error) {
      $('r-state').className = 'note error';
      $('r-state').textContent = '读取失败：' + error.message;
    }
  }

  async function addReminder() {
    const text = $('r-text').value.trim();
    const dueAt = new Date($('r-time').value).getTime();
    if (!text || !Number.isFinite(dueAt)) {
      $('r-state').className = 'note error';
      $('r-state').textContent = '请填写内容和时间';
      return;
    }
    const res = await fetch('/dsh-pet-7340/reminders?pet=' + encodeURIComponent(statePetId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-DSH-Pet-Token': token },
      body: JSON.stringify({ text, dueAt }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) {
      $('r-state').className = 'note error';
      $('r-state').textContent = '添加失败：' + (body.message || body.error || res.status);
      return;
    }
    $('r-text').value = '';
    $('r-state').className = 'note ok';
    $('r-state').textContent = '已添加';
    await loadReminders();
  }

  async function exportMemoir() {
    $('memoir-state').textContent = '生成中…';
    try {
      const res = await fetch('/dsh-pet-7340/memoir?pet=' + encodeURIComponent(statePetId), {
        headers: { 'X-DSH-Pet-Token': token },
      });
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body.error || '生成失败');
      const blob = new Blob([body.markdown], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'dsh-pet-memoir-' + statePetId + '.md';
      a.click();
      URL.revokeObjectURL(url);
      $('memoir-state').textContent = '已导出';
    } catch (error) {
      $('memoir-state').textContent = '导出失败：' + error.message;
    }
  }

  function renderPetSelect() {
    const select = $('pet-active');
    select.innerHTML = '';
    for (const pet of infoPets) {
      const option = document.createElement('option');
      option.value = pet.id;
      option.textContent = pet.name || pet.id;
      select.appendChild(option);
    }
    const active = data.voice.activePetId || (infoPets[0] && infoPets[0].id) || 'main';
    select.value = active;
    loadPetOverride();
  }

  function loadPetOverride() {
    const id = $('pet-active').value;
    const override = (data.pets && data.pets[id]) || {};
    $('pet-voice').value = override.voice || '';
    $('pet-persona').value = override.persona || '';
  }

  async function load() {
    setStatus('正在读取…');
    const info = await api('/companion/info');
    data = await api('/companion/settings');
    providers = data.providers.map((p) => ({ ...p, apiKey: '' }));
    current = providers.find((p) => p.id === data.activeProviderId) || providers[0];

    $('v-engine').value = data.voice.engine;
    await loadVoices(data.voice.voice);
    $('v-rate').value = data.voice.rate;
    $('v-pitch').value = data.voice.pitch;
    $('v-volume').value = data.voice.volume;
    $('v-sttLanguage').value = data.voice.sttLanguage;
    $('v-wakeWord').value = data.voice.wakeWord || '小鱼';
    $('v-wakeIdle').value = String(data.voice.wakeIdleSeconds ?? 10);
    $('c-memoryDir').value = data.chat.memoryDir;
    $('c-rounds').value = String(data.chat.rounds);
    statePetId = String((info.pets && info.pets[0] && info.pets[0].id) || 'main');
    infoPets = Array.isArray(info.pets) ? info.pets.map((pet) => ({ ...pet })) : [];
    renderDisplay();
    renderPetSelect();
    $('e-enabled').checked = data.emotion.enabled;
    $('u-limit').value = String(data.usage.dailyLimit);
    $('u-warn').value = String(data.usage.warnPercent);
    $('u-price').value = String(data.usage.pricePer1k ?? 0);
    $('p-enabled').checked = data.proactive.enabled === true;
    $('p-quietStart').value = data.proactive.quietStart;
    $('p-quietEnd').value = data.proactive.quietEnd;
    $('p-daily').value = String(data.proactive.dailyLimit);
    $('p-interval').value = String(data.proactive.minIntervalMinutes);
    $('f-enabled').checked = data.focus.enabled === true;
    $('f-mute').checked = data.focus.muteVoice === true;
    await loadEmotion();
    await loadUsage();
    await loadReminders();
    $('l-mode').value = data.livekit.mode;
    $('l-port').value = String(data.livekit.port);
    $('l-room').value = data.livekit.room;
    $('l-url').value = data.livekit.url;

    const paths = data.paths;
    $('paths').innerHTML = '';
    for (const [label, value] of [
      ['数据根', paths.petHome], ['配置文件', paths.configFile], ['密钥文件', paths.secretsFile], ['日志', paths.logsFile],
      ['识别/合成模型目录', paths.petHome + '\\\\models'],
    ]) {
      const dt = document.createElement('dt'); dt.textContent = label;
      const dd = document.createElement('dd'); dd.textContent = value;
      $('paths').append(dt, dd);
    }
    $('pets').innerHTML = '';
    for (const pet of info.pets || []) {
      const li = document.createElement('li');
      li.textContent = (pet.name || pet.id) + '（' + pet.display + '）';
      $('pets').appendChild(li);
    }
    $('version').textContent = 'dsh-pet ' + info.version + ' · 端口 ' + info.port + ' · 桌宠数据根 ' + paths.petHome;
    renderProviders();
    setStatus('已读取');
    dirty = false;
    setSave('');
    void refreshRuntime();
  }

  function collect() {
    stashProvider();
    const activeId = $('pet-active').value || 'main';
    const activeName = $('pet-active').selectedOptions[0]?.textContent || activeId;
    const pets = { ...(data.pets || {}) };
    pets[activeId] = { voice: $('pet-voice').value.trim(), persona: $('pet-persona').value.trim() };
    return {
      activeProviderId: current.id,
      providers: providers.map(({ hasKey, ...p }) => p),
      voice: {
        engine: $('v-engine').value,
        voice: $('v-voice').value.trim(),
        rate: $('v-rate').value.trim() || '+0%',
        pitch: $('v-pitch').value.trim() || '+0Hz',
        volume: $('v-volume').value.trim() || '+0%',
        sttLanguage: $('v-sttLanguage').value.trim() || 'zh',
        wakeWord: $('v-wakeWord').value.trim() || '小鱼',
        wakeIdleSeconds: Number($('v-wakeIdle').value) || 10,
        activePetId: activeId,
        activePetName: activeName,
      },
      pets,
      chat: { memoryDir: $('c-memoryDir').value.trim(), rounds: Number($('c-rounds').value) },
      emotion: { enabled: $('e-enabled').checked, proactive: false },
      usage: { dailyLimit: Number($('u-limit').value) || 0, warnPercent: Number($('u-warn').value) || 80, pricePer1k: Number($('u-price').value) || 0 },
      proactive: {
        enabled: $('p-enabled').checked,
        quietStart: $('p-quietStart').value.trim() || '23:00',
        quietEnd: $('p-quietEnd').value.trim() || '08:00',
        dailyLimit: Number($('p-daily').value) || 0,
        minIntervalMinutes: Number($('p-interval').value) || 120,
      },
      focus: { enabled: $('f-enabled').checked, muteVoice: $('f-mute').checked },
      livekit: {
        mode: $('l-mode').value,
        port: Number($('l-port').value),
        room: $('l-room').value.trim(),
        url: $('l-url').value.trim(),
      },
    };
  }

  async function save() {
    $('save').disabled = true;
    setSave('正在保存…');
    try {
      data = await api('/companion/settings', { method: 'PUT', body: JSON.stringify(collect()) });
      providers = data.providers.map((p) => ({ ...p, apiKey: '' }));
      current = providers.find((p) => p.id === data.activeProviderId) || providers[0];
      renderProviders();
      dirty = false;
      setSave('已保存 · 文本对话立即生效', 'ok');
      setStatus('已保存', '');
    } catch (error) {
      setSave('保存失败：' + error.message, 'error');
    } finally {
      $('save').disabled = false;
    }
  }

  async function testProvider() {
    stashProvider();
    const button = $('test-provider');
    button.disabled = true;
    $('test-result').className = 'note';
    $('test-result').textContent = '测试中…';
    try {
      const result = await api('/companion/test', { method: 'POST', body: JSON.stringify({ providerId: current.id, apiKey: $('p-apiKey').value.trim() }) });
      $('test-result').className = 'note ' + (result.ok ? 'ok' : 'error');
      $('test-result').textContent = (result.ok ? '✓ ' : '✗ ') + result.message + (result.reply ? ' · ' + result.reply : '');
    } catch (error) {
      $('test-result').className = 'note error';
      $('test-result').textContent = '✗ ' + error.message;
    } finally {
      button.disabled = false;
    }
  }

  function addProvider() {
    stashProvider();
    let n = providers.length + 1;
    while (providers.some((p) => p.id === 'provider-' + n)) n += 1;
    const provider = { id: 'provider-' + n, name: '新服务商 ' + n, protocol: 'openai-compatible', baseUrl: '', model: '', temperature: 0.7, maxTokens: 1024, enabled: false, apiKey: '', hasKey: false };
    providers.push(provider);
    current = provider;
    renderProviders();
    markDirty();
  }

  function removeProvider() {
    if (providers.length <= 1) return;
    providers = providers.filter((p) => p.id !== current.id);
    current = providers[0];
    renderProviders();
    markDirty();
  }

  $('provider-select').addEventListener('change', (event) => { selectProvider(event.target.value); });
  $('add-provider').addEventListener('click', addProvider);
  $('del-provider').addEventListener('click', removeProvider);
  $('save').addEventListener('click', save);
  $('test-provider').addEventListener('click', testProvider);
  $('runtime-toggle').addEventListener('click', () => {
    void runtime($('runtime-toggle').textContent.includes('停止') ? 'stop' : 'start');
  });
  $('v-engine').addEventListener('change', () => {
    if (voices) fillVoiceOptions('');
  });
  $('v-preview').addEventListener('click', () => void previewVoice());
  $('pet-active').addEventListener('change', () => loadPetOverride());
  $('r-add').addEventListener('click', () => void addReminder());
  $('memoir-export').addEventListener('click', () => void exportMemoir());
  $('e-reset').addEventListener('click', async () => {
    $('e-reset-state').className = 'note';
    $('e-reset-state').textContent = '重置中…';
    try {
      const res = await fetch('/dsh-pet-7340/emotion/reset?pet=' + encodeURIComponent(statePetId), {
        method: 'POST',
        headers: { 'X-DSH-Pet-Token': token },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) throw new Error(body.message || body.error || ('HTTP ' + res.status));
      renderEmotion(body.state);
      $('e-reset-state').className = 'note ok';
      $('e-reset-state').textContent = '已重置';
    } catch (error) {
      $('e-reset-state').className = 'note error';
      $('e-reset-state').textContent = '重置失败：' + error.message;
    }
  });
  setInterval(() => {
    const panel = document.querySelector('[data-panel="livekit"]');
    if (panel && panel.classList.contains('active')) void refreshRuntime();
  }, 3000);
  document.querySelectorAll('#tabs button').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b === button));
      document.querySelectorAll('.panel').forEach((panel) => panel.classList.toggle('active', panel.dataset.panel === button.dataset.tab));
    });
  });
  if (['model', 'voice', 'chat', 'emotion', 'care', 'pets', 'display', 'livekit', 'about'].includes(initialTab)) {
    const tabButton = document.querySelector('#tabs button[data-tab="' + initialTab + '"]');
    if (tabButton) tabButton.click();
  }
  document.querySelectorAll('input,select').forEach((el) => el.addEventListener('input', markDirty));

  load().catch((error) => { setStatus('读取失败：' + error.message, 'error'); });
})();
`;
