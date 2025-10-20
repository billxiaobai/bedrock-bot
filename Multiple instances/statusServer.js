const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const instances = new Map(); 

function start(host = process.env.STATUS_HOST || '0.0.0.0', port = parseInt(process.env.STATUS_PORT, 10) || 19132) {
  const server = http.createServer((req, res) => {
    const parsed = url.parse(req.url, true);
    if (parsed.pathname && parsed.pathname.startsWith('/send/') && req.method === 'POST') {
      const id = parsed.pathname.replace('/send/', '');
      if (!instances.has(id)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'instance not found' }));
        return;
      }
      let body = '';
      req.on('data', chunk => body += chunk.toString());
      req.on('end', async () => {
        try {
          const data = JSON.parse(body || '{}');
          const msg = data.message;
          const entry = instances.get(id);
          if (!entry.send || typeof entry.send !== 'function') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'send not available for this instance' }));
            return;
          }
          await entry.send(msg); 
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: String(err && err.message ? err.message : err) }));
        }
      });
      return;
    }
    if (parsed.pathname && parsed.pathname.startsWith('/events/')) {
      const id = parsed.pathname.replace('/events/', '');
      if (!instances.has(id)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('instance not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      });
      res.write('\n');

      const entry = instances.get(id);
      entry.clients.add(res);
      res.write(`event: meta\ndata: ${JSON.stringify(entry.meta || {})}\n\n`);

      req.on('close', () => {
        entry.clients.delete(res);
      });
      return;
    }
    if (parsed.pathname === '/instances') {
      const list = Array.from(instances.entries()).map(([id, v]) => ({ id, meta: v.meta }));
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(list));
      return;
    }
    let filePath;

   
    if (parsed.pathname === '/background.png') {
      const bgPath = path.join(__dirname, '..', 'Web', 'background.png');
      fs.readFile(bgPath, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(data);
      });
      return;
    }

    if (parsed.pathname === '/' || parsed.pathname === '/index.html') {
      filePath = path.join(__dirname, 'web', 'index.html');
    } else { 
      filePath = path.join(__dirname, 'web', parsed.pathname.replace(/^\//, ''));
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      const contentType = ext === '.js' ? 'application/javascript' : 'text/html';
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    });
  });

  server.listen(port, host, () => {
    console.log(`Status server listening on http://${host}:${port}`);
  });

  return server;
}

function registerInstance(id, emitter, meta = {}, sendFn = null) {
  if (instances.has(id)) return;
  const entry = { emitter, clients: new Set(), meta, send: sendFn };
  entry._lastChatText = null;
  entry._lastChatTs = 0;
  instances.set(id, entry);
  console.log(`StatusServer: registered instance ${id}`);

  const onLog = (msg) => {
    for (const res of entry.clients) {
      try {
        let originId = id;
        let text = '';
        if (msg && typeof msg === 'object') {
          if (msg.id) originId = msg.id;
          if (msg.text) text = String(msg.text);
          else text = JSON.stringify(msg);
        } else {
          text = String(msg);
        }

        // 只保留包含 "[CHAT]" 的訊息，並只傳送 "[CHAT]" 之後的內容
        if (!text.includes('[CHAT]')) {
          continue; // 忽略非 CHAT 訊息
        }
        const idx = text.indexOf('[CHAT]');
        const chatText = text.substring(idx + '[CHAT]'.length).trim();

        // 去重：若與上次相同且在短時間內（2s）則忽略
        const now = Date.now();
        const lastText = entry._lastChatText;
        const lastTs = entry._lastChatTs || 0;
        const DEDUP_MS = 2000;
        if (lastText === chatText && (now - lastTs) < DEDUP_MS) {
          continue; 
        }
      
        entry._lastChatText = chatText;
        entry._lastChatTs = now;

      
        res.write(`data: ${JSON.stringify({ id: originId, text: chatText, ts: now })}\n\n`);
      } catch (e) { /* ignore */ }
    }
  };

  emitter.on('log', onLog);
  entry._onLog = onLog;
}

function unregisterInstance(id) {
  const entry = instances.get(id);
  if (!entry) return;
  entry.emitter.removeListener('log', entry._onLog);
  for (const res of entry.clients) {
    try {
      res.end();
    } catch (e) { /* ignore */ }
  }
  instances.delete(id);
}

module.exports = {
  start,
  registerInstance,
  unregisterInstance
};
