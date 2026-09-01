const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WebSocket } = require('ws');

const port = 3219;
const baseUrl = `http://127.0.0.1:${port}`;
const sessionId = `test-${Date.now()}-session`;
const testDataFile = path.join(os.tmpdir(), `fake-ai-e2e-${process.pid}.json`);
const server = spawn(process.execPath, ['server.js'], {
  cwd: path.join(__dirname, '..'),
  env: { ...process.env, PORT: String(port), APP_NAME: 'Test Human AI', ADMIN_PASSWORD: 'test-password', DATA_FILE: testDataFile },
  stdio: ['ignore', 'pipe', 'pipe']
});

function waitForServer() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server startup timed out')), 5000);
    server.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('Test Human AI is running')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    server.once('exit', (code) => reject(new Error(`Server exited early with ${code}`)));
  });
}

function nextMessage(ws, expectedType, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', handler);
      reject(new Error(`Timed out waiting for ${expectedType}`));
    }, timeoutMs);
    function handler(raw) {
      const message = JSON.parse(raw.toString());
      if (message.type !== expectedType) return;
      clearTimeout(timer);
      ws.off('message', handler);
      resolve(message);
    }
    ws.on('message', handler);
  });
}

function openSocket(headers) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers });
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

(async () => {
  let user;
  let admin;
  try {
    await waitForServer();
    const health = await fetch(`${baseUrl}/health`).then((response) => response.json());
    assert.equal(health.ok, true);
    const userHtml = await fetch(`${baseUrl}/`, { headers: { 'X-Forwarded-Prefix': '/proxy/chat' } }).then((response) => response.text());
    const adminHtml = await fetch(`${baseUrl}/admin`, { headers: { 'X-Forwarded-Prefix': '/proxy/chat' } }).then((response) => response.text());
    assert.match(userHtml, /<base href="\/proxy\/chat\/">/);
    assert.match(adminHtml, /<base href="\/proxy\/chat\/">/);
    assert.match(userHtml, /<title>Test Human AI<\/title>/);
    assert.match(userHtml, /href="styles\.css"/);
    assert.match(userHtml, /src="app\.js"/);
    assert.match(adminHtml, /href="styles\.css"/);
    assert.match(adminHtml, /src="admin\.js"/);
    assert.doesNotMatch(`${userHtml}${adminHtml}`, /(?:href|src)="\/(?:styles\.css|app\.js|admin\.js)"/);
    const directHtml = await fetch(`${baseUrl}/`).then((response) => response.text());
    assert.match(directHtml, /<base href="\/">/);
    const userScript = await fetch(`${baseUrl}/app.js`).then((response) => response.text());
    assert.match(userScript, /function createSessionId\(\)/);
    assert.doesNotMatch(userScript, /\|\| crypto\.randomUUID\(\)/);

    const login = await fetch(`${baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'test-password' })
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];

    admin = await openSocket({ Cookie: cookie });
    const initialList = nextMessage(admin, 'conversation_list');
    admin.send(JSON.stringify({ type: 'join_admin' }));
    await initialList;

    user = await openSocket();
    const initialConversation = nextMessage(user, 'conversation');
    user.send(JSON.stringify({ type: 'join_user', sessionId }));
    await initialConversation;

    const adminUpdate = nextMessage(admin, 'conversation_updated');
    const userUpdate = nextMessage(user, 'conversation');
    user.send(JSON.stringify({ type: 'user_message', text: '请介绍一下你自己' }));
    assert.equal((await adminUpdate).conversation.messages[0].text, '请介绍一下你自己');
    assert.equal((await userUpdate).conversation.status, 'waiting');

    const draftUpdate = nextMessage(user, 'draft_update');
    admin.send(JSON.stringify({ type: 'admin_typing', sessionId, text: '我是一个实时助手' }));
    assert.equal((await draftUpdate).text, '我是一个实时助手');

    const finalUpdate = nextMessage(user, 'conversation');
    admin.send(JSON.stringify({ type: 'admin_send', sessionId, text: '我是一个实时助手。' }));
    const finalConversation = (await finalUpdate).conversation;
    assert.equal(finalConversation.status, 'resolved');
    assert.equal(finalConversation.messages.at(-1).text, '我是一个实时助手。');
    console.log('E2E passed: mapped assets, login, question, live typing, and final answer');
  } finally {
    user?.close();
    admin?.close();
    server.kill();
    setTimeout(() => {
      for (const file of [testDataFile, `${testDataFile}.tmp`]) {
        try { fs.unlinkSync(file); } catch {}
      }
    }, 150);
  }
})().catch((error) => {
  console.error(error);
  server.kill();
  process.exitCode = 1;
});
