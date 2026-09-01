const express = require('express');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { WebSocketServer, WebSocket } = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

const PORT = Number(process.env.PORT || 3000);
const APP_NAME = process.env.APP_NAME || 'Human AI';
const CONFIGURED_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_PASSWORD = CONFIGURED_ADMIN_PASSWORD || crypto.randomBytes(12).toString('base64url');
const DATA_FILE = process.env.DATA_FILE
  ? path.resolve(process.env.DATA_FILE)
  : path.join(__dirname, 'data', 'conversations.json');
const DATA_DIR = path.dirname(DATA_FILE);
const adminSessions = new Map();
const loginAttempts = new Map();
const sockets = new Set();
const PUBLIC_DIR = path.join(__dirname, 'public');
const USER_HTML = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
const ADMIN_HTML = fs.readFileSync(path.join(PUBLIC_DIR, 'admin.html'), 'utf8');
let conversations = new Map();
let saveTimer = null;

fs.mkdirSync(DATA_DIR, { recursive: true });
if (fs.existsSync(DATA_FILE)) {
  try {
    const stored = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    conversations = new Map(stored.map((item) => [item.id, item]));
  } catch (error) {
    console.error('Could not read conversation data:', error.message);
  }
}

app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));

function publicBasePath(req) {
  const forwarded = String(req.get('x-forwarded-prefix') || '').split(',')[0].trim();
  if (!forwarded || forwarded === '/') return '/';
  if (!/^\/[a-zA-Z0-9/_-]*$/.test(forwarded) || forwarded.includes('..')) return '/';
  return `${forwarded.replace(/\/+$/, '')}/`;
}

function servePage(template) {
  return (req, res) => {
    const basePath = publicBasePath(req);
    const safeAppName = APP_NAME.replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
    res.type('html').set('Cache-Control', 'no-store').send(
      template
        .replace('<head>', `<head>\n  <base href="${basePath}">`)
        .replaceAll('{{APP_NAME}}', safeAppName)
    );
  };
}

app.get(['/', '/index.html'], servePage(USER_HTML));
app.get(['/admin', '/admin/', '/admin.html'], servePage(ADMIN_HTML));
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((part) => part.trim().split('=').map(decodeURIComponent)).filter(([key]) => key));
}

function isAdminRequest(req) {
  const token = parseCookies(req.headers.cookie).fake_ai_admin;
  return token && adminSessions.has(token);
}

function passwordMatches(candidate) {
  const provided = Buffer.from(String(candidate || ''));
  const expected = Buffer.from(ADMIN_PASSWORD);
  return provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
}

function safeConversation(conversation, includeDraft = false) {
  const result = {
    id: conversation.id,
    title: conversation.title,
    status: conversation.status,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messages: conversation.messages
  };
  if (includeDraft) result.adminDraft = conversation.adminDraft || '';
  return result;
}

function persistSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const temporary = `${DATA_FILE}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify([...conversations.values()], null, 2));
      try {
        fs.renameSync(temporary, DATA_FILE);
      } catch (error) {
        if (!['EPERM', 'EEXIST', 'EBUSY'].includes(error.code)) throw error;
        fs.copyFileSync(temporary, DATA_FILE);
        fs.unlinkSync(temporary);
      }
    } catch (error) {
      console.error('Could not save conversation data:', error.message);
      try { fs.unlinkSync(temporary); } catch {}
    }
  }, 120);
}

function send(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

function broadcastAdmins(payload) {
  for (const client of sockets) {
    if (client.role === 'admin') send(client, payload);
  }
}

function broadcastUser(sessionId, payload) {
  for (const client of sockets) {
    if (client.role === 'user' && client.sessionId === sessionId) send(client, payload);
  }
}

function broadcastAdminList() {
  const list = [...conversations.values()]
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .map((item) => safeConversation(item, false));
  broadcastAdmins({ type: 'conversation_list', conversations: list });
}

app.post('/api/admin/login', (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const attempt = loginAttempts.get(ip) || { count: 0, firstAt: now };
  if (now - attempt.firstAt > 15 * 60 * 1000) {
    attempt.count = 0;
    attempt.firstAt = now;
  }
  if (attempt.count >= 8) {
    return res.status(429).json({ error: '尝试次数过多，请 15 分钟后再试' });
  }
  if (typeof req.body.password !== 'string' || !passwordMatches(req.body.password)) {
    attempt.count += 1;
    loginAttempts.set(ip, attempt);
    return res.status(401).json({ error: '密码不正确' });
  }
  loginAttempts.delete(ip);
  const token = crypto.randomBytes(32).toString('hex');
  adminSessions.set(token, Date.now());
  res.setHeader('Set-Cookie', `fake_ai_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`);
  res.json({ ok: true });
});

app.post('/api/admin/logout', (req, res) => {
  const token = parseCookies(req.headers.cookie).fake_ai_admin;
  if (token) adminSessions.delete(token);
  res.setHeader('Set-Cookie', 'fake_ai_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/admin/status', (req, res) => {
  res.json({ authenticated: Boolean(isAdminRequest(req)), usingTemporaryPassword: !CONFIGURED_ADMIN_PASSWORD });
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, conversations: conversations.size });
});

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname !== '/ws') return socket.destroy();
  if (req.headers.origin) {
    const origin = new URL(req.headers.origin);
    if (origin.host !== req.headers.host) return socket.destroy();
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.isAuthenticatedAdmin = isAdminRequest(req);
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws) => {
  sockets.add(ws);
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return send(ws, { type: 'error', message: '消息格式无效' });
    }

    if (message.type === 'join_user') {
      const sessionId = String(message.sessionId || '').slice(0, 80);
      if (!/^[a-zA-Z0-9-]{12,80}$/.test(sessionId)) return ws.close(1008, 'Invalid session');
      ws.role = 'user';
      ws.sessionId = sessionId;
      const conversation = conversations.get(sessionId);
      return send(ws, { type: 'conversation', conversation: conversation ? safeConversation(conversation, true) : null });
    }

    if (message.type === 'join_admin') {
      if (!ws.isAuthenticatedAdmin) return ws.close(1008, 'Unauthorized');
      ws.role = 'admin';
      const list = [...conversations.values()].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).map((item) => safeConversation(item, false));
      return send(ws, { type: 'conversation_list', conversations: list });
    }

    if (message.type === 'user_message' && ws.role === 'user') {
      const text = String(message.text || '').trim().slice(0, 8000);
      if (!text) return;
      const now = new Date().toISOString();
      let conversation = conversations.get(ws.sessionId);
      if (!conversation) {
        conversation = {
          id: ws.sessionId,
          title: text.replace(/\s+/g, ' ').slice(0, 36),
          status: 'waiting',
          adminDraft: '',
          createdAt: now,
          updatedAt: now,
          messages: []
        };
        conversations.set(ws.sessionId, conversation);
      }
      conversation.messages.push({ id: crypto.randomUUID(), role: 'user', text, createdAt: now });
      conversation.status = 'waiting';
      conversation.adminDraft = '';
      conversation.updatedAt = now;
      persistSoon();
      broadcastUser(ws.sessionId, { type: 'conversation', conversation: safeConversation(conversation, true) });
      broadcastAdminList();
      return broadcastAdmins({ type: 'conversation_updated', conversation: safeConversation(conversation, true) });
    }

    if (message.type === 'select_conversation' && ws.role === 'admin') {
      const conversation = conversations.get(String(message.sessionId));
      if (conversation) send(ws, { type: 'conversation_detail', conversation: safeConversation(conversation, true) });
      return;
    }

    if (message.type === 'admin_typing' && ws.role === 'admin') {
      const conversation = conversations.get(String(message.sessionId));
      if (!conversation) return;
      conversation.adminDraft = String(message.text || '').slice(0, 12000);
      conversation.status = 'answering';
      conversation.updatedAt = new Date().toISOString();
      persistSoon();
      broadcastUser(conversation.id, { type: 'draft_update', text: conversation.adminDraft, status: conversation.status });
      return broadcastAdmins({ type: 'conversation_meta', sessionId: conversation.id, status: conversation.status, updatedAt: conversation.updatedAt });
    }

    if (message.type === 'admin_send' && ws.role === 'admin') {
      const conversation = conversations.get(String(message.sessionId));
      const text = String(message.text || '').trim().slice(0, 12000);
      if (!conversation || !text) return;
      const now = new Date().toISOString();
      conversation.messages.push({ id: crypto.randomUUID(), role: 'assistant', text, createdAt: now });
      conversation.adminDraft = '';
      conversation.status = 'resolved';
      conversation.updatedAt = now;
      persistSoon();
      broadcastUser(conversation.id, { type: 'conversation', conversation: safeConversation(conversation, true) });
      broadcastAdmins({ type: 'conversation_updated', conversation: safeConversation(conversation, true) });
      return broadcastAdminList();
    }
  });

  ws.on('close', () => sockets.delete(ws));
});

const heartbeat = setInterval(() => {
  for (const ws of sockets) {
    if (!ws.isAlive) {
      sockets.delete(ws);
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

server.on('close', () => clearInterval(heartbeat));
server.listen(PORT, () => {
  console.log(`${APP_NAME} is running at http://localhost:${PORT}`);
  console.log(`Admin console: http://localhost:${PORT}/admin`);
  if (!CONFIGURED_ADMIN_PASSWORD) console.warn(`Temporary admin password: ${ADMIN_PASSWORD}`);
});
