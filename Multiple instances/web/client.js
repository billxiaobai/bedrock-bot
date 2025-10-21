(async () => {
  const container = document.getElementById('container');

  const createdIds = new Set();

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function ansiToHtml(input) {
    if (!input) return '';
    const colorMap = {
      30: '#000000', 31: '#AA0000', 32: '#00AA00', 33: '#AA5500',
      34: '#0000AA', 35: '#AA00AA', 36: '#00AAAA', 37: '#AAAAAA',
      90: '#555555', 91: '#FF5555', 92: '#55FF55', 93: '#FFFF55',
      94: '#5555FF', 95: '#FF55FF', 96: '#55FFFF', 97: '#FFFFFF'
    };

    let result = '';
    let openStack = [];
    const regex = /\x1b\[([0-9;]+)m/g;
    let lastIndex = 0;
    let match;
    while ((match = regex.exec(input)) !== null) {
      const chunk = input.substring(lastIndex, match.index);
      result += escapeHtml(chunk);
      lastIndex = regex.lastIndex;

      const codes = match[1].split(';').map(n => parseInt(n, 10) || 0);

      if (codes.includes(0)) {
        while (openStack.length) {
          result += openStack.pop();
        }
        continue;
      }

      let styles = [];
      codes.forEach(c => {
        if (c === 1) styles.push('font-weight:700');
        else if (c === 3) styles.push('font-style:italic');
        else if (c === 4) styles.push('text-decoration:underline');
        else if (c === 9) styles.push('text-decoration:line-through');
        else if ((c >= 30 && c <= 37) || (c >= 90 && c <= 97)) {
          const col = colorMap[c];
          if (col) styles.push(`color:${col}`);
        } else if (c === 39) {
          while (openStack.length) {
            result += openStack.pop();
          }
        }
      });

      if (styles.length) {
        result += `<span style="${styles.join(';')}">`;
        openStack.push('</span>');
      }
    }

    result += escapeHtml(input.substring(lastIndex));

    while (openStack.length) result += openStack.pop();
    return result.replace(/\r?\n/g, '<br>');
  }

  async function loadInstancesOnce() {
    try {
      const res = await fetch('/instances');
      const list = await res.json();
      if (!Array.isArray(list)) return;
      list.forEach(item => {
        if (!createdIds.has(item.id)) {
          createWindow(item.id, item.meta);
          createdIds.add(item.id);
        }
      });
    } catch (e) {
      console.error('Failed to load instances', e);
    }
  }
  await loadInstancesOnce();
  const pollInterval = setInterval(loadInstancesOnce, 3000);

  function createWindow(id, meta = {}) {
    if (createdIds.has(id)) return;

    const win = document.createElement('div');
    win.className = 'win';
    win.style.position = 'relative';

    win.style.width = '360px';
    win.style.height = '260px';

    const title = document.createElement('div');
    title.className = 'title';
    title.style.position = 'relative';
    const left = document.createElement('div');
    left.style.display = 'flex';
    left.style.alignItems = 'center';
    left.innerText = id;
    title.appendChild(left);

    const statusWrap = document.createElement('div');
    statusWrap.style.position = 'absolute';
    statusWrap.style.left = '50%';
    statusWrap.style.top = '50%';
    statusWrap.style.transform = 'translate(-50%, -50%)';
    statusWrap.style.pointerEvents = 'none';
    statusWrap.style.display = 'flex';
    statusWrap.style.alignItems = 'center';
    statusWrap.style.gap = '6px';
    const statusSquare = document.createElement('span');
    statusSquare.style.display = 'inline-block';
    statusSquare.style.width = '10px';
    statusSquare.style.height = '10px';
    statusSquare.style.borderRadius = '2px';
    statusSquare.style.backgroundColor = '#e74c3c';
    const statusText = document.createElement('span');
    statusText.style.fontSize = '12px';
    statusText.style.color = '#ffffff';
    statusText.style.opacity = '0.9';
    statusText.textContent = 'stop';
    statusWrap.appendChild(statusSquare);
    statusWrap.appendChild(statusText);
    title.appendChild(statusWrap);

    if (meta && meta.bot && meta.bot.username) {
      const m = document.createElement('span');
      m.className = 'meta';
      m.innerText = meta.bot.username;
      left.appendChild(m);
    }
    win.appendChild(title);

    const content = document.createElement('div');
    content.className = 'content';
    content.innerHTML = `Connecting to instance ${escapeHtml(id)}...<br>`;
    win.appendChild(content);
    const inputArea = document.createElement('div');
    inputArea.className = 'input-area';
    const inputField = document.createElement('input');
    inputField.className = 'input-field';
    inputField.placeholder = '輸入訊息後按 Enter 發送...';
    const sendBtn = document.createElement('button');
    sendBtn.className = 'send-btn';
    sendBtn.innerText = '送出';
    inputArea.appendChild(inputField);
    inputArea.appendChild(sendBtn);
    win.appendChild(inputArea);

    async function doSend() {
      const text = inputField.value;
      if (!text) return;
      sendBtn.disabled = true;
      try {
        const res = await fetch(`/send/${encodeURIComponent(id)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text })
        });
        const body = await res.json().catch(()=>({}));
        if (!res.ok) {
          content.innerHTML += `<div>[SEND ERROR] ${escapeHtml(body.error || res.statusText)}</div>`;
        } else {
          content.innerHTML += `<div>[SENT] ${escapeHtml(text)}</div>`;
        }
        content.scrollTop = content.scrollHeight;
      } catch (e) {
        content.innerHTML += `<div>[SEND ERROR] ${escapeHtml(String(e && e.message ? e.message : e))}</div>`;
        content.scrollTop = content.scrollHeight;
      } finally {
        sendBtn.disabled = false;
        inputField.value = '';
        inputField.focus();
      }
    }
    sendBtn.addEventListener('click', doSend);
    inputField.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        doSend();
      }
    });
    container.appendChild(win);
    const handle = document.createElement('div');
    handle.className = 'resize-handle';
    handle.innerText = '⟷';
    win.appendChild(handle);
    const handleV = document.createElement('div');
    handleV.className = 'resize-handle-vert';
    handleV.innerText = '↕';
    win.appendChild(handleV);
    let isResizingH = false;
    let resizeStartX = 0;
    let resizeStartWidth = 0;
    handle.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      isResizingH = true;
      resizeStartX = e.clientX;
      resizeStartWidth = win.getBoundingClientRect().width;
      document.body.style.userSelect = 'none';
    });
    document.addEventListener('mousemove', (e) => {
      if (isResizingH) {
        const dx = e.clientX - resizeStartX;
        const newW = Math.max(120, resizeStartWidth + dx);
        win.style.width = newW + 'px';
      }
    });
    document.addEventListener('mouseup', () => {
      if (isResizingH) {
        isResizingH = false;
        document.body.style.userSelect = '';
      }
    });
    let isResizingV = false;
    let resizeStartY = 0;
    let resizeStartHeight = 0;
    handleV.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      isResizingV = true;
      resizeStartY = e.clientY;
      resizeStartHeight = win.getBoundingClientRect().height;
      document.body.style.userSelect = 'none';
    });
    document.addEventListener('mousemove', (e) => {
      if (isResizingV) {
        const dy = e.clientY - resizeStartY;
        const newH = Math.max(80, resizeStartHeight + dy);
        win.style.height = newH + 'px';
      }
    });
    document.addEventListener('mouseup', () => {
      if (isResizingV) {
        isResizingV = false;
        document.body.style.userSelect = '';
      }
    });
    title.addEventListener('dblclick', () => {
      const isMax = win.classList.toggle('maximized');
      if (isMax) win.classList.remove('minimized');
    });
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let origX = 0;
    let origY = 0;
    title.addEventListener('mousedown', (e) => {
      if (e.target.closest('.resize-handle') || e.target.closest('.resize-handle-vert')) return;
      isDragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      const rect = win.getBoundingClientRect();
      origX = rect.left;
      origY = rect.top;
      win.style.position = 'fixed';
      win.style.left = origX + 'px';
      win.style.top = origY + 'px';
      win.style.zIndex = 1000;
      document.body.style.userSelect = 'none';
    });
    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      win.style.left = (origX + dx) + 'px';
      win.style.top = (origY + dy) + 'px';
    });
    document.addEventListener('mouseup', () => {
      if (!isDragging) return;
      isDragging = false;
      document.body.style.userSelect = '';
    });
    let es = null;
    let sseRetryTimer = null;
    const sseRetryDelay = 3000;

    function cleanupSSE() {
      if (es) {
        try { es.close(); } catch (e) {}
        es = null;
      }
      if (sseRetryTimer) {
        clearTimeout(sseRetryTimer);
        sseRetryTimer = null;
      }
    }

    function connectSSE() {
      cleanupSSE();
      const url = `/events/${encodeURIComponent(id)}`;
      try {
        es = new EventSource(url);
      } catch (e) {
        content.innerHTML += `<div>[SSE ERROR] cannot create EventSource, retrying in ${sseRetryDelay/1000}s...</div>`;
        sseRetryTimer = setTimeout(connectSSE, sseRetryDelay);
        return;
      }

      es.onopen = () => {};

      es.addEventListener('meta', (ev) => {
        try {
          const m = JSON.parse(ev.data);
          if (m && m.bot && m.bot.username) {
            title.querySelector('.meta')?.remove();
            const span = document.createElement('span');
            span.className = 'meta';
            span.innerText = m.bot.username;
            title.appendChild(span);
          }
        } catch (e) {}
      });

      es.addEventListener('status', (ev) => {
        try {
          const st = JSON.parse(ev.data || '{}');
          if (st && typeof st.connected !== 'undefined') {
            if (st.connected) {
              statusSquare.style.backgroundColor = '#2ecc71';
              statusText.textContent = 'online';
            } else {
              statusSquare.style.backgroundColor = '#e74c3c';
              statusText.textContent = 'stop';
            }
          }
        } catch (e) {}
      });

      function setStatusOnline() {
        statusSquare.style.backgroundColor = '#2ecc71';
        statusText.textContent = 'online';
      }
      function setStatusOffline() {
        statusSquare.style.backgroundColor = '#e74c3c';
        statusText.textContent = 'stop';
      }

      es.onmessage = (ev) => {
        try {
          const obj = JSON.parse(ev.data);
          if (obj.id && obj.id !== id) {
            return;
          }
          const time = new Date(obj.ts).toLocaleTimeString();
          const html = ansiToHtml(obj.text);
          content.innerHTML += `<div>${escapeHtml(time)} ${html}</div>`;
          content.scrollTop = content.scrollHeight;

          try {
            const txt = (obj.text || '').toLowerCase();
            if (txt.includes('bot spawned')) {
              setStatusOnline();
            } else if (txt.includes('bot disconnected') || txt.includes('bot kicked') || txt.includes('bot connection ended') || txt.includes('[sse disconnected]') || txt.includes('sse disconnected')) {
              setStatusOffline();
            } else if (txt.includes('[error]') && txt.includes('start error')) {
              setStatusOffline();
            }
          } catch (e) {}
        } catch (e) {
          content.innerHTML += `<div>${escapeHtml(ev.data)}</div>`;
          content.scrollTop = content.scrollHeight;
        }
      };

      es.onerror = (ev) => {
        content.innerHTML += `<div>[SSE disconnected] retrying in ${sseRetryDelay/1000}s...</div>`;
        content.scrollTop = content.scrollHeight;
        try { setStatusOffline(); } catch (e) {}
        cleanupSSE();
        sseRetryTimer = setTimeout(connectSSE, sseRetryDelay);
      };
    }
    connectSSE();
  }
})();
