const loginScreen = document.querySelector('#loginScreen');
const operatorShell = document.querySelector('#operatorShell');
const loginForm = document.querySelector('#loginForm');
const loginError = document.querySelector('#loginError');
const passwordInput = document.querySelector('#password');
const queueList = document.querySelector('#queueList');
const operatorConversation = document.querySelector('#operatorConversation');
const operatorTitle = document.querySelector('#operatorTitle');
const operatorMeta = document.querySelector('#operatorMeta');
const operatorStatus = document.querySelector('#operatorStatus');
const replyInput = document.querySelector('#replyInput');
const replyButton = document.querySelector('#replyButton');
const operatorComposer = document.querySelector('#operatorComposer');
const characterCount = document.querySelector('#characterCount');
const queuePanel = document.querySelector('.queue-panel');
const scriptUrl = new URL(document.currentScript?.src || location.href);
const appBaseUrl = new URL('./', scriptUrl);
let socket;
let conversations = [];
let selectedId = null;
let currentFilter = 'all';
let typingTimer;

function escapeHtml(text) {
  return String(text).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function statusText(status) {
  return ({ waiting: '待回复', answering: '回复中', resolved: '已完成' })[status] || '未知';
}

function relativeTime(date) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(date).getTime()) / 1000));
  if (seconds < 60) return '刚刚';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}小时前`;
  return new Date(date).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

async function checkAuth() {
  const response = await fetch(new URL('api/admin/status', appBaseUrl));
  const result = await response.json();
  if (result.authenticated) showConsole();
}

function showConsole() {
  loginScreen.classList.add('hidden');
  operatorShell.classList.remove('hidden');
  connectAdmin();
}

function connectAdmin() {
  const endpoint = new URL('ws', appBaseUrl);
  endpoint.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(endpoint);
  socket.addEventListener('open', () => socket.send(JSON.stringify({ type: 'join_admin' })));
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.type === 'conversation_list') {
      conversations = message.conversations;
      renderQueue();
      if (selectedId) selectConversation(selectedId, false);
    }
    if (message.type === 'conversation_updated') {
      const index = conversations.findIndex((item) => item.id === message.conversation.id);
      if (index >= 0) conversations[index] = message.conversation;
      else conversations.unshift(message.conversation);
      renderQueue();
      if (selectedId === message.conversation.id) renderDetail(message.conversation);
    }
    if (message.type === 'conversation_detail') renderDetail(message.conversation);
    if (message.type === 'conversation_meta') {
      const item = conversations.find((conversation) => conversation.id === message.sessionId);
      if (item) {
        item.status = message.status;
        item.updatedAt = message.updatedAt;
        renderQueue();
      }
      if (selectedId === message.sessionId) setStatus(message.status);
    }
  });
  socket.addEventListener('close', () => setTimeout(connectAdmin, 1600));
}

function renderQueue() {
  const filtered = conversations.filter((item) => currentFilter === 'all' || item.status === currentFilter);
  document.querySelector('#allCount').textContent = conversations.length;
  document.querySelector('#waitingCount').textContent = conversations.filter((item) => item.status === 'waiting').length;
  queueList.innerHTML = filtered.length ? '' : '<div class="queue-empty">当前没有符合条件的对话</div>';
  for (const conversation of filtered) {
    const last = conversation.messages.at(-1)?.text || '暂无消息';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `queue-item ${selectedId === conversation.id ? 'active' : ''}`;
    button.innerHTML = `<div class="queue-item-top"><strong>${escapeHtml(conversation.title)}</strong><span class="queue-time">${relativeTime(conversation.updatedAt)}</span></div><p>${escapeHtml(last)}</p><span class="queue-status ${conversation.status}">${statusText(conversation.status)}</span>`;
    button.addEventListener('click', () => selectConversation(conversation.id));
    queueList.append(button);
  }
}

function selectConversation(id, requestDetail = true) {
  selectedId = id;
  renderQueue();
  queuePanel.classList.remove('open');
  if (requestDetail && socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'select_conversation', sessionId: id }));
  }
}

function renderDetail(conversation) {
  if (conversation.id !== selectedId) return;
  operatorTitle.textContent = conversation.title;
  operatorMeta.textContent = `会话 ${conversation.id.slice(0, 8)} · ${new Date(conversation.createdAt).toLocaleString('zh-CN')}`;
  setStatus(conversation.status);
  operatorConversation.innerHTML = '';
  for (const message of conversation.messages) {
    const article = document.createElement('article');
    article.className = `operator-message ${message.role}`;
    article.innerHTML = `<div class="operator-message-label"><span>${message.role === 'user' ? '用户' : '你的回复'}</span><time>${new Date(message.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time></div><p>${escapeHtml(message.text)}</p>`;
    operatorConversation.append(article);
  }
  replyInput.disabled = false;
  replyInput.value = conversation.adminDraft || '';
  updateReplyState();
  requestAnimationFrame(() => { operatorConversation.scrollTop = operatorConversation.scrollHeight; });
}

function setStatus(status) {
  operatorStatus.className = `status-pill ${status}`;
  operatorStatus.textContent = statusText(status);
}

function updateReplyState() {
  characterCount.textContent = `${replyInput.value.length} / 12000`;
  replyButton.disabled = !selectedId || !replyInput.value.trim();
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginError.textContent = '';
  const response = await fetch(new URL('api/admin/login', appBaseUrl), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: passwordInput.value }) });
  const result = await response.json();
  if (!response.ok) {
    loginError.textContent = result.error || '登录失败，请重试';
    return;
  }
  passwordInput.value = '';
  showConsole();
});

document.querySelector('#togglePassword').addEventListener('click', (event) => {
  const reveal = passwordInput.type === 'password';
  passwordInput.type = reveal ? 'text' : 'password';
  event.currentTarget.textContent = reveal ? '隐藏' : '显示';
  event.currentTarget.setAttribute('aria-label', reveal ? '隐藏密码' : '显示密码');
});

replyInput.addEventListener('input', () => {
  updateReplyState();
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    if (selectedId && socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'admin_typing', sessionId: selectedId, text: replyInput.value }));
    }
  }, 70);
});

replyInput.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') operatorComposer.requestSubmit();
});

operatorComposer.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = replyInput.value.trim();
  if (!selectedId || !text || socket?.readyState !== WebSocket.OPEN) return;
  clearTimeout(typingTimer);
  socket.send(JSON.stringify({ type: 'admin_send', sessionId: selectedId, text }));
  replyInput.value = '';
  updateReplyState();
});

document.querySelectorAll('.queue-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    currentFilter = tab.dataset.filter;
    document.querySelectorAll('.queue-tab').forEach((item) => item.classList.toggle('active', item === tab));
    renderQueue();
  });
});

document.querySelector('#operatorMenu').addEventListener('click', () => queuePanel.classList.add('open'));
document.querySelector('#queueScrim').addEventListener('click', () => queuePanel.classList.remove('open'));
document.querySelector('#logoutButton').addEventListener('click', async () => {
  await fetch(new URL('api/admin/logout', appBaseUrl), { method: 'POST' });
  location.reload();
});

checkAuth();
