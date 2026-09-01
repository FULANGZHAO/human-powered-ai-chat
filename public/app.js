const conversationEl = document.querySelector('#conversation');
const welcomeEl = document.querySelector('#welcome');
const composer = document.querySelector('#composer');
const input = document.querySelector('#messageInput');
const sendButton = document.querySelector('#sendButton');
const connectionState = document.querySelector('#connectionState');
const historyTitle = document.querySelector('#historyTitle');
const sidebar = document.querySelector('#sidebar');
const sessionKey = 'human_ai_session_id';
const scriptUrl = new URL(document.currentScript?.src || location.href);
const appBaseUrl = new URL('./', scriptUrl);
const appName = document.title || 'AI';
let sessionId = localStorage.getItem(sessionKey) || createSessionId();
let socket;
let reconnectTimer;
let currentConversation = null;
let liveDraft = '';

localStorage.setItem(sessionKey, sessionId);

function createSessionId() {
  if (typeof window.crypto?.randomUUID === 'function') return window.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof window.crypto?.getRandomValues === 'function') {
    window.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const value = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function connect() {
  clearTimeout(reconnectTimer);
  const endpoint = new URL('ws', appBaseUrl);
  endpoint.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(endpoint);
  connectionState.classList.remove('online');
  connectionState.lastChild.textContent = '正在连接';

  socket.addEventListener('open', () => {
    connectionState.classList.add('online');
    connectionState.lastChild.textContent = '已连接';
    socket.send(JSON.stringify({ type: 'join_user', sessionId }));
  });

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.type === 'conversation') {
      currentConversation = message.conversation;
      liveDraft = currentConversation?.adminDraft || '';
      renderConversation();
    }
    if (message.type === 'draft_update') {
      liveDraft = message.text;
      if (currentConversation) currentConversation.status = message.status;
      renderConversation();
    }
  });

  socket.addEventListener('close', () => {
    connectionState.classList.remove('online');
    connectionState.lastChild.textContent = '连接中断，正在重试';
    reconnectTimer = setTimeout(connect, 1500);
  });
}

function renderConversation() {
  const messages = currentConversation?.messages || [];
  welcomeEl.classList.toggle('hidden', messages.length > 0);
  conversationEl.querySelectorAll('.message').forEach((item) => item.remove());
  historyTitle.textContent = currentConversation?.title || '新对话';

  for (const message of messages) {
    const article = document.createElement('article');
    article.className = `message ${message.role}`;
    if (message.role === 'assistant') {
      article.innerHTML = `<div class="message-avatar" aria-hidden="true">A</div><div class="message-content">${escapeHtml(message.text)}</div>`;
    } else {
      article.innerHTML = `<div class="message-content">${escapeHtml(message.text)}</div>`;
    }
    conversationEl.append(article);
  }

  const waiting = currentConversation && ['waiting', 'answering'].includes(currentConversation.status);
  if (waiting) {
    const article = document.createElement('article');
    article.className = 'message assistant';
    const content = liveDraft
      ? `<div class="typing-label">正在生成回答</div>${escapeHtml(liveDraft)}<span class="streaming-cursor" aria-hidden="true"></span>`
      : `<div class="typing-label">${escapeHtml(appName)} 正在思考</div><span class="typing-dots" aria-label="正在输入"><i></i><i></i><i></i></span>`;
    article.innerHTML = `<div class="message-avatar" aria-hidden="true">A</div><div class="message-content">${content}</div>`;
    conversationEl.append(article);
  }
  requestAnimationFrame(() => { conversationEl.scrollTop = conversationEl.scrollHeight; });
}

function resizeInput() {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
  sendButton.disabled = !input.value.trim() || socket?.readyState !== WebSocket.OPEN;
}

composer.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text || socket?.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type: 'user_message', text }));
  input.value = '';
  resizeInput();
});

input.addEventListener('input', resizeInput);
input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    composer.requestSubmit();
  }
});

document.querySelector('#newChat').addEventListener('click', () => {
  sessionId = createSessionId();
  localStorage.setItem(sessionKey, sessionId);
  currentConversation = null;
  liveDraft = '';
  renderConversation();
  sidebar.classList.remove('open');
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'join_user', sessionId }));
  input.focus();
});
document.querySelector('#openSidebar').addEventListener('click', () => sidebar.classList.add('open'));
document.querySelector('#closeSidebar').addEventListener('click', () => sidebar.classList.remove('open'));
document.querySelector('#sidebarScrim').addEventListener('click', () => sidebar.classList.remove('open'));

connect();
resizeInput();
