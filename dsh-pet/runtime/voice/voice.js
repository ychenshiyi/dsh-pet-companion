'use strict';
/**
 * 隐藏语音窗：连接 LiveKit、发布麦克风、播放 Agent 音频。
 * 只通过 /companion/voice/token 取令牌；状态暴露在 window.__voiceState 供主进程轮询。
 */
(() => {
  const LK = window.LivekitClient;
  const params = new URLSearchParams(location.hash.slice(1));
  const appToken = params.get('token') || '';
  const roomName = params.get('room') || 'pet-room';
  const wakeWord = params.get('wake') || '小鱼';
  const wakeIdle = Math.max(3, Number(params.get('idle') || 10));
  const identity = 'desktop-' + Math.random().toString(36).slice(2, 8);
  console.log('voice hash length', location.hash.length, 'token length', appToken.length);
  const state = { status: 'starting', error: '', identity, room: roomName, mic: false };
  let room = null;
  const el = document.getElementById('s');
  const render = () => { if (el) el.textContent = state.status + (state.error ? '\n' + state.error : ''); };
  window.__voiceState = () => ({ ...state });

  async function connect() {
    state.status = 'token';
    render();
    const res = await fetch('/companion/voice/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-DSH-Pet-Token': appToken },
      body: JSON.stringify({ identity, room: roomName }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));

    room = new LK.Room({ adaptiveStream: false, dynacast: false, disconnectOnPageLeave: true });
    room.on(LK.RoomEvent.TrackSubscribed, (track) => {
      if (track.kind !== 'audio') return;
      const audio = track.attach();
      audio.autoplay = true;
      audio.style.display = 'none';
      document.body.appendChild(audio);
    });
    room.on(LK.RoomEvent.Disconnected, () => {
      state.status = 'disconnected';
      state.mic = false;
      render();
      setTimeout(() => { if (state.status === 'disconnected') void connect().catch(fail); }, 2000);
    });
    room.on(LK.RoomEvent.Reconnecting, () => { state.status = 'reconnecting'; render(); });
    room.on(LK.RoomEvent.Reconnected, () => { state.status = 'connected'; render(); });

    // 听/想/说：用宿主气泡做可见状态（隐藏语音窗本身不可见）。
    let indicator = '';
    function showBubble(text, duration) {
      if (indicator === text) return;
      indicator = text;
      void fetch('/dsh-pet-7340/broadcast?pet=main&surface=any', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-DSH-Pet-Token': appToken },
        body: JSON.stringify({ text, duration, anim: false }),
      }).catch(() => {});
    }
    const speakersEvent = LK.RoomEvent.ActiveSpeakersChanged;
    if (speakersEvent) room.on(speakersEvent, (speakers) => {
      const local = (speakers || []).some((participant) => participant && participant.isLocal);
      if (local) {
        armWakeHint();
        showBubble('🎤 在听你说…', 60000);
      } else if (indicator.indexOf('🎤') === 0) showBubble('🤔 我在想…', 60000);
    });
    let wakeTimer = null;
    function armWakeHint() {
      if (wakeTimer) clearTimeout(wakeTimer);
      wakeTimer = setTimeout(() => showBubble('😴 说「' + wakeWord + '」唤醒我', 60000), wakeIdle * 1000);
    }

    // 字幕：Agent 的最终转写通过宿主气泡显示（隐藏语音窗本身不可见）。
    // anim=false 只弹文字，不抢当前动画；duration 8s 由宿主消费。
    const transcriptionEvent = LK.RoomEvent.TranscriptionReceived;
    if (transcriptionEvent) room.on(transcriptionEvent, (segments, participant) => {
      if (!participant || participant.isLocal) return;
      const text = (segments || [])
        .filter((segment) => segment && segment.final && segment.text)
        .map((segment) => segment.text.trim())
        .join(' ')
        .trim();
      if (!text) return;
      indicator = text;
      armWakeHint();
      void fetch('/dsh-pet-7340/broadcast?pet=main&surface=any', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-DSH-Pet-Token': appToken },
        body: JSON.stringify({ text, duration: 8000, anim: false }),
      })
        .then((response) => {
          if (!response.ok) console.log('voice subtitle rejected', response.status);
        })
        .catch((error) => console.log('voice subtitle failed', error && error.message));
    });

    await room.connect(data.url, data.token, { autoSubscribe: true });
    await room.localParticipant.setMicrophoneEnabled(true);
    state.mic = true;
    showBubble('🎤 我在听；' + wakeIdle + ' 秒没聊请说「' + wakeWord + '」叫我', 60000);
    armWakeHint();
    await room.startAudio().catch(() => {});
    state.status = 'connected';
    state.mic = true;
    render();
  }

  function fail(error) {
    state.status = 'error';
    state.error = error && error.message ? error.message : String(error);
    console.error('voice error:', state.error);
    render();
  }

  connect().catch(fail);
})();


