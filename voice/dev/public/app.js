/**
 * LiveKit 本机联调页逻辑
 *
 * 只做三件事：进房、推/收音频、把状态画出来。
 * - 令牌从本机 127.0.0.1:7890/token 取，浏览器里没有 API secret
 * - 音量用 livekit-client 的 createAudioAnalyser 计算（本地与远端同口径）
 * - window.__lkTest.snapshot() 给自动化测试读状态（不影响页面使用）
 */
const LK = window.LivekitClient;
const { Room, RoomEvent, createLocalAudioTrack, createAudioAnalyser } = LK;

const $ = (id) => document.getElementById(id);
const els = {
  room: $('room'),
  identity: $('identity'),
  publish: $('publish'),
  join: $('join'),
  mute: $('mute'),
  micTest: $('micTest'),
  leave: $('leave'),
  dot: $('dot'),
  status: $('status'),
  count: $('count'),
  people: $('people'),
  log: $('log'),
  health: $('health'),
  sink: $('audio-sink'),
  micState: $('micState'),
  micHelp: $('micHelp'),
};

const state = {
  room: null,
  localTrack: null,
  localAnalyser: null,
  remote: new Map(), // trackSid -> { participant, track, element, analyser }
  speakers: new Set(),
  timer: null,
  joining: false,
  lastMicError: null,
  transcript: [],
};

function log(message, kind = '') {
  const line = document.createElement('div');
  if (kind) line.className = kind;
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  line.textContent = `[${time}] ${message}`;
  els.log.appendChild(line);
  els.log.scrollTop = els.log.scrollHeight;
}

/** 麦克风错误 → 人话 + 处理建议（NotAllowedError 在 Chrome 里文案就是 Permission denied） */
function micErrorText(error) {
  const name = error?.name ?? '';
  if (name === 'NotAllowedError' || /permission/i.test(error?.message ?? '')) {
    return '权限被拒绝（浏览器站点权限或 Windows 隐私设置）';
  }
  if (name === 'NotFoundError') return '没有找到麦克风设备';
  if (name === 'NotReadableError') return '麦克风被其它程序占用';
  if (name === 'OverconstrainedError') return '麦克风不支持当前采样参数';
  return error?.message ?? String(error);
}

function showMicHelp(text) {
  els.micHelp.style.display = 'block';
  els.micHelp.textContent =
    text ??
    '麦克风被拒绝时页面会以“仅收听”继续工作。恢复办法：' +
      '① 点地址栏左侧图标 → 麦克风 → 允许，然后刷新；' +
      '② Windows 设置 → 隐私和安全性 → 麦克风 → 允许桌面应用访问；' +
      '③ 若之前点过“阻止”，到 chrome://settings/content/microphone 删除 127.0.0.1 的阻止记录。';
}

async function refreshMicPermission() {
  try {
    const status = await navigator.permissions.query({ name: 'microphone' });
    els.micState.textContent =
      status.state === 'granted' ? '已允许' : status.state === 'denied' ? '已阻止' : '未授权';
    els.micState.style.color =
      status.state === 'granted' ? 'var(--ok)' : status.state === 'denied' ? 'var(--err)' : 'var(--warn)';
    if (status.state === 'denied') showMicHelp();
    status.onchange = () => void refreshMicPermission();
  } catch {
    els.micState.textContent = '未知';
  }
}

function setStatus(text, kind = '') {
  els.status.textContent = text;
  els.dot.className = 'dot' + (kind ? ' ' + kind : '');
}

function volumePercent(analyser) {
  if (!analyser) return 0;
  try {
    const v = analyser.calculateVolume();
    return Math.min(100, Math.round(Math.sqrt(Math.max(0, v)) * 140));
  } catch {
    return 0;
  }
}

function micOn(participant) {
  for (const pub of participant.audioTrackPublications.values()) {
    if (pub.track && !pub.isMuted) return true;
  }
  return false;
}

function render() {
  const room = state.room;
  if (!room) {
    els.count.textContent = '0';
    els.people.innerHTML = '<p class="hint">加入后显示。</p>';
    return;
  }
  const local = room.localParticipant;
  const people = [
    { participant: local, local: true },
    ...[...room.remoteParticipants.values()].map((p) => ({ participant: p, local: false })),
  ];
  els.count.textContent = String(people.length);
  els.people.innerHTML = '';

  // 本地音量条（本地没有 analyser 时给 0）
  const localVolume = state.localTrack ? volumePercent(state.localAnalyser) : 0;
  for (const { participant, local: isLocal } of people) {
    const card = document.createElement('div');
    card.className = 'person' + (state.speakers.has(participant.identity) ? ' speaking' : '');
    card.dataset.identity = participant.identity;

    const who = document.createElement('div');
    who.className = 'who';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = participant.name || participant.identity;
    who.appendChild(name);
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = isLocal ? '我' : '远端';
    who.appendChild(tag);
    if (!micOn(participant)) {
      const off = document.createElement('span');
      off.className = 'mic-off';
      off.textContent = '未开麦';
      who.appendChild(off);
    }

    const meterWrap = document.createElement('div');
    meterWrap.className = 'meter';
    const bar = document.createElement('i');
    let volume = 0;
    if (isLocal) volume = localVolume;
    else {
      for (const entry of state.remote.values()) {
        if (entry.participant.identity === participant.identity) {
          volume = Math.max(volume, volumePercent(entry.analyser));
        }
      }
    }
    bar.style.width = volume + '%';
    meterWrap.appendChild(bar);

    card.appendChild(who);
    card.appendChild(meterWrap);
    els.people.appendChild(card);
  }
}

function startRenderLoop() {
  if (state.timer) return;
  state.timer = setInterval(render, 150);
}

function stopRenderLoop() {
  if (!state.timer) return;
  clearInterval(state.timer);
  state.timer = null;
}

async function attachRemoteAudio(track, participant) {
  if (track.kind !== 'audio') return;
  const element = track.attach();
  element.autoplay = true;
  element.playsInline = true;
  els.sink.appendChild(element);
  state.remote.set(track.sid, {
    participant,
    track,
    element,
    analyser: createAudioAnalyser(track, { fftSize: 512 }),
  });
  log(`订阅到音频：${participant.name || participant.identity} (${track.sid})`, 'ok');
  render();
}

function detachRemoteAudio(trackSid) {
  const entry = state.remote.get(trackSid);
  if (!entry) return;
  try {
    entry.track.detach().forEach((el) => el.remove());
  } catch {
    entry.element.remove();
  }
  entry.analyser?.cleanup().catch(() => {});
  state.remote.delete(trackSid);
  render();
}

function bindRoom(room) {
  room.on(RoomEvent.ParticipantConnected, (p) => {
    log(`参与者加入：${p.name || p.identity}`);
    render();
  });
  room.on(RoomEvent.ParticipantDisconnected, (p) => {
    log(`参与者离开：${p.name || p.identity}`);
    for (const [sid, entry] of state.remote) {
      if (entry.participant.identity === p.identity) detachRemoteAudio(sid);
    }
    render();
  });
  room.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
    void attachRemoteAudio(track, participant);
  });
  room.on(RoomEvent.TrackUnsubscribed, (track) => {
    detachRemoteAudio(track.sid);
  });
  room.on(RoomEvent.TrackMuted, () => render());
  room.on(RoomEvent.TrackUnmuted, () => render());
  room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
    state.speakers = new Set(speakers.map((p) => p.identity));
    render();
  });
  room.on(RoomEvent.Reconnecting, () => setStatus('重连中…', 'warn'));
  room.on(RoomEvent.Reconnected, () => setStatus('已重连', 'ok'));
  room.on(RoomEvent.Disconnected, (reason) => {
    log(`连接断开${reason ? '：' + reason : ''}`, 'err');
    void cleanup();
  });
  room.on(RoomEvent.AudioPlaybackStatusChanged, () => {
    if (!room.canPlaybackAudio) log('浏览器拦截了自动播放，请点一下页面任意位置', 'err');
  });

  // 文字转写（Agent 默认会把用户与自己的转写发到房间）
  if (RoomEvent.TranscriptionReceived) {
    room.on(RoomEvent.TranscriptionReceived, (segments, participant) => {
      for (const seg of segments ?? []) {
        if (!seg?.text) continue;
        const identity = participant?.identity ?? '';
        const text = seg.text;
        const final = Boolean(seg.final);
        // legacy 转写是「增量长文本」：新文本是旧文本的前缀延伸就替换，否则另起一条
        let idx = -1;
        for (let i = state.transcript.length - 1; i >= 0; i -= 1) {
          if (state.transcript[i].identity === identity) {
            idx = i;
            break;
          }
        }
        const prev = idx >= 0 ? state.transcript[idx] : null;
        const grows = prev && (text.startsWith(prev.text) || prev.text.startsWith(text));
        if (grows) state.transcript[idx] = { identity, text, final };
        else state.transcript.push({ identity, text, final });
        if (state.transcript.length > 60) state.transcript.shift();
        if (!prev || prev.text !== text) {
          if (final) log(`转写[${identity}] ${text}`);
        }
      }
    });
  }
}

async function publishMicrophone(room) {
  const track = await createLocalAudioTrack({
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  });
  await room.localParticipant.publishTrack(track, { name: 'microphone' });
  state.localTrack = track;
  state.localAnalyser = createAudioAnalyser(track, { fftSize: 512 });
  log('麦克风已发布', 'ok');
}

async function join() {
  if (state.joining || state.room) return;
  state.joining = true;
  els.join.disabled = true;
  const roomName = els.room.value.trim() || 'pet-room';
  const identity =
    els.identity.value.trim() ||
    'me-' + Math.random().toString(36).slice(2, 6);
  const publish = els.publish.checked;
  els.identity.value = identity;
  localStorage.setItem('lk.identity', identity);
  setStatus('连接中…', 'warn');
  log(`正在加入 ${roomName} / ${identity}`);

  try {
    const res = await fetch('/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ room: roomName, identity }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `令牌服务返回 ${res.status}`);

    const room = new Room({ adaptiveStream: false, dynacast: false, disconnectOnPageLeave: true });
    state.room = room;
    bindRoom(room);
    await room.connect(data.url, data.token, { autoSubscribe: true });
    setStatus('已连接', 'ok');
    log(`已连接：${data.url}`, 'ok');

    if (publish) {
      try {
        await publishMicrophone(room);
        state.lastMicError = null;
      } catch (error) {
        // 麦克风失败不应该把整个连接拆掉：降级为仅收听，用户仍能听到对方/Agent
        state.lastMicError = micErrorText(error);
        log('麦克风不可用：' + state.lastMicError + '，已切换为「仅收听」', 'err');
        showMicHelp();
        els.publish.checked = false;
        void refreshMicPermission();
      }
    } else {
      log('未发布麦克风（仅接收模式）');
    }

    await room.startAudio().catch((e) => log('startAudio: ' + e.message, 'err'));
    els.join.disabled = true;
    els.leave.disabled = false;
    els.mute.disabled = !state.localTrack;
    startRenderLoop();
    render();
  } catch (error) {
    log('加入失败：' + (error?.message ?? error), 'err');
    setStatus('连接失败', 'err');
    await cleanup();
  } finally {
    state.joining = false;
    els.join.disabled = !!state.room;
  }
}

async function cleanup() {
  stopRenderLoop();
  for (const sid of [...state.remote.keys()]) detachRemoteAudio(sid);
  try {
    state.localAnalyser?.cleanup();
  } catch {}
  state.localAnalyser = null;
  if (state.localTrack) {
    try {
      state.localTrack.stop();
    } catch {}
  }
  state.localTrack = null;
  if (state.room) {
    try {
      await state.room.disconnect();
    } catch {}
    state.room = null;
  }
  state.speakers.clear();
  els.join.disabled = false;
  els.leave.disabled = true;
  els.mute.disabled = true;
  els.mute.textContent = '静音';
  els.people.innerHTML = '<p class="hint">加入后显示。</p>';
  els.count.textContent = '0';
  setStatus('未连接');
}

async function leave() {
  log('主动离开房间');
  await cleanup();
}

async function toggleMute() {  const track = state.localTrack;
  if (!track) return;
  if (track.isMuted) {
    await track.unmute();
    els.mute.textContent = '静音';
    log('麦克风已取消静音');
  } else {
    await track.mute();
    els.mute.textContent = '取消静音';
    log('麦克风已静音');
  }
  render();
}

async function retryMic() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    state.lastMicError = null;
    els.micHelp.style.display = 'none';
    await refreshMicPermission();
    log('麦克风权限正常', 'ok');
    // 已经在房间里且还没发布麦克风：顺手补发布，不用退出重进
    if (state.room && !state.localTrack) {
      await publishMicrophone(state.room);
      els.publish.checked = true;
      els.mute.disabled = false;
      render();
    }
  } catch (error) {
    state.lastMicError = micErrorText(error);
    log('麦克风仍不可用：' + state.lastMicError, 'err');
    showMicHelp();
    void refreshMicPermission();
  }
}

els.join.addEventListener('click', () => void join());
els.leave.addEventListener('click', () => void leave());
els.mute.addEventListener('click', () => void toggleMute());
els.micTest.addEventListener('click', () => void retryMic());
els.identity.value = localStorage.getItem('lk.identity') ?? '';

document.addEventListener('click', () => {
  // 用户手势后恢复被浏览器拦截的音频播放
  if (state.room && !state.room.canPlaybackAudio) {
    void state.room.startAudio().catch(() => {});
  }
});

void (async () => {
  void refreshMicPermission();
  try {
    const res = await fetch('/health');
    const data = await res.json();
    els.health.textContent = data.ok
      ? `本机服务 OK · LiveKit ${data.livekit} 在线`
      : `本机服务 OK · 但 LiveKit ${data.livekit} 不可达（先跑 scripts\\start.cmd）`;
  } catch {
    els.health.textContent = '本机服务不可达';
  }
})();

// 自动化测试读状态用（不参与界面逻辑）
window.__lkTest = {
  snapshot() {
    const room = state.room;
    return {
      status: els.status.textContent,
      connected: room?.state ?? 'disconnected',
      identity: room?.localParticipant.identity ?? null,
      participantCount: room ? 1 + room.remoteParticipants.size : 0,
      participants: room
        ? [
            { identity: room.localParticipant.identity, local: true, mic: micOn(room.localParticipant), kind: room.localParticipant.kind },
            ...[...room.remoteParticipants.values()].map((p) => ({
              identity: p.identity,
              local: false,
              mic: micOn(p),
              kind: p.kind,
            })),
          ]
        : [],
      remoteAudioTracks: [...state.remote.keys()],
      localVolume: state.localTrack ? volumePercent(state.localAnalyser) : 0,
      lastMicError: state.lastMicError,
      remoteVolumes: Object.fromEntries(
        [...state.remote.entries()].map(([sid, entry]) => [sid, volumePercent(entry.analyser)]),
      ),
      logLines: [...els.log.children].map((line) => line.textContent),
      transcript: state.transcript.slice(-40),
    };
  },

  /** 测试辅助：把一段音频文件当作麦克风发布（用于自动化验证 STT 链路） */
  async publishWav(url) {
    const room = state.room;
    if (!room) throw new Error('未连接');
    const res = await fetch(url);
    if (!res.ok) throw new Error('测试音频加载失败：HTTP ' + res.status);
    const data = await res.arrayBuffer();
    const audioCtx = new AudioContext();
    const buffer = await audioCtx.decodeAudioData(data);
    const dest = audioCtx.createMediaStreamDestination();
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(dest);
    source.start();
    const [mediaTrack] = dest.stream.getAudioTracks();
    const track = new LK.LocalAudioTrack(mediaTrack, undefined, true);
    await room.localParticipant.publishTrack(track, {
      name: 'test-audio',
      source: LK.Track.Source.Microphone,
    });
    log(`已发布测试音频：${buffer.duration.toFixed(1)} 秒`);
    return { duration: buffer.duration };
  },
};
