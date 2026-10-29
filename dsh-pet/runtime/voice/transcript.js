'use strict';
/** 语音对话框：轮询宿主 transcript 接口，按时间顺序渲染用户/宠物气泡。 */
(() => {
  const token = new URLSearchParams(location.hash.slice(1)).get('token') || '';
  history.replaceState(null, '', location.pathname);
  const list = document.getElementById('messages');
  const status = document.getElementById('status');
  let lastKey = '';

  function render(messages) {
    const key = messages.map((m) => `${m.ts}:${m.role}:${m.text}`).join('|');
    if (key === lastKey) return;
    lastKey = key;
    list.innerHTML = '';
    if (messages.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.innerHTML = '开始语音对话后，这里会实时显示<br>你说的话和桌宠的回复。';
      list.appendChild(empty);
      return;
    }
    for (const message of messages) {
      const row = document.createElement('div');
      row.className = 'row ' + (message.role === 'user' ? 'user' : 'pet');
      const who = document.createElement('span');
      who.className = 'who';
      who.textContent = message.role === 'user' ? '你' : '桌宠';
      const bubble = document.createElement('div');
      bubble.className = 'bubble';
      bubble.textContent = message.text;
      row.append(who, bubble);
      list.appendChild(row);
    }
    list.scrollTop = list.scrollHeight;
  }

  async function tick() {
    try {
      const res = await fetch('/companion/voice/transcript', {
        headers: { 'X-DSH-Pet-Token': token },
        cache: 'no-store',
      });
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body.error || 'HTTP ' + res.status);
      status.textContent = body.messages.length > 0 ? '实时对话 · ' + body.messages.length + ' 条' : '等待语音…';
      render(body.messages);
    } catch (error) {
      status.textContent = '读取失败：' + error.message;
    }
  }

  tick();
  setInterval(tick, 500);
})();
