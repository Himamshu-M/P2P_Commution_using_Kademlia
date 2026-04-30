/**
 * app.js — Frontend Controller
 *
 * Wires PeerDiscovery → UI:
 *   - Generates / restores a persistent node ID
 *   - Connects to the signaling server
 *   - Renders messages, peer list, file transfers
 *   - Handles send button, file picker, typing events
 */

'use strict';

// ─── Config ───────────────────────────────────────────────────────────────────

const SIGNALING_URL = `ws://${location.hostname}:8765`;

// ─── Persistent Node ID ───────────────────────────────────────────────────────

function getOrCreateNodeId() {
  let id = sessionStorage.getItem('kademlia_node_id');
  if (!id) {
    // 20 random bytes → 40 hex chars = 160-bit ID
    const buf = new Uint8Array(20);
    crypto.getRandomValues(buf);
    id = [...buf].map(b => b.toString(16).padStart(2, '0')).join('');
    sessionStorage.setItem('kademlia_node_id', id);
  }
  return id;
}

// ─── DOM Refs ─────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const dom = {
  nodeIdDisplay: $('node-id-display'),
  statusDot:     $('status-dot'),
  peerList:      $('peer-list'),
  peerCount:     $('peer-count'),
  messages:      $('messages'),
  typingIndicator: $('typing-indicator'),
  chatTarget:    $('chat-target'),
  inputArea:     $('input-area'),
  messageInput:  $('message-input'),
  sendBtn:       $('send-btn'),
  fileBtn:       $('file-btn'),
  fileInput:     $('file-input'),
  toastContainer: $('toast-container'),
  emptyState:    $('empty-state'),
  dhtNodes:      $('dht-nodes'),
  dhtBuckets:    $('dht-buckets'),
};

// ─── State ────────────────────────────────────────────────────────────────────

const nodeId   = getOrCreateNodeId();
let   discovery = null;

/** @type {Map<string, DataChannelManager>}  nodeId → channel */
const channels  = new Map();

/** The current "conversation target": a nodeId string or null (= broadcast) */
let activePeer  = null;

/** Map of in-progress file transfers: transferId → DOM element */
const activeTransfers = new Map();

/** Typing debounce timer */
let typingTimer = null;

// ─── Init ─────────────────────────────────────────────────────────────────────

function init() {
  dom.nodeIdDisplay.textContent = `ID: ${nodeId.slice(0, 8)}…${nodeId.slice(-4)}`;
  dom.nodeIdDisplay.title       = `Your node ID: ${nodeId}`;
  dom.nodeIdDisplay.addEventListener('click', () => {
    navigator.clipboard?.writeText(nodeId);
    showToast('Node ID copied to clipboard', 'success');
  });

  discovery = new PeerDiscovery({
    nodeId,
    signalingUrl: SIGNALING_URL,
  });

  discovery.on('ready', () => {
    dom.statusDot.classList.add('connected');
    appendSystemMessage('Connected to signaling server. Discovering peers…');
  });

  discovery.on('peer_connected', ({ nodeId: peerId, channel }) => {
    channels.set(peerId, channel);
    bindChannelEvents(channel, peerId);
    renderPeerList();
    appendSystemMessage(`Peer joined: ${peerId.slice(0, 12)}…`);
    showToast(`Peer connected: ${peerId.slice(0, 8)}…`, 'success');

    // Auto-select first peer
    if (!activePeer) setActivePeer(peerId);
  });

  discovery.on('peer_disconnected', ({ nodeId: peerId }) => {
    channels.delete(peerId);
    if (activePeer === peerId) setActivePeer(null);
    renderPeerList();
    appendSystemMessage(`Peer left: ${peerId.slice(0, 12)}…`);
  });

  discovery.start();

  // Input events
  dom.messageInput.addEventListener('keydown', onKeyDown);
  dom.messageInput.addEventListener('input',   onInputChange);
  dom.sendBtn.addEventListener('click',  sendMessage);
  dom.fileBtn.addEventListener('click',  () => dom.fileInput.click());
  dom.fileInput.addEventListener('change', onFileSelected);

  // Initial UI state
  renderPeerList();
  updateChatHeader();
}

// ─── Peer List ─────────────────────────────────────────────────────────────────

function renderPeerList() {
  dom.peerList.innerHTML = '';
  dom.peerCount.textContent = channels.size;

  if (channels.size === 0) {
    dom.peerList.innerHTML = '<li class="no-peers">Waiting for peers…</li>';
    return;
  }

  // Add "Broadcast" option
  const bcastItem = document.createElement('li');
  bcastItem.className = `peer-item${activePeer === null ? ' active' : ''}`;
  bcastItem.innerHTML = `<span class="peer-dot" style="background:var(--amber);box-shadow:0 0 4px var(--amber)"></span>
    <span class="peer-id-short">Broadcast all</span>
    <span class="peer-count-badge">${channels.size}</span>`;
  bcastItem.addEventListener('click', () => setActivePeer(null));
  dom.peerList.appendChild(bcastItem);

  for (const [id] of channels) {
    const li = document.createElement('li');
    li.className = `peer-item${activePeer === id ? ' active' : ''}`;
    li.innerHTML = `<span class="peer-dot"></span>
      <span class="peer-id-short" title="${id}">${id.slice(0, 8)}…${id.slice(-4)}</span>`;
    li.addEventListener('click', () => setActivePeer(id));
    dom.peerList.appendChild(li);
  }
}

function setActivePeer(peerId) {
  activePeer = peerId;
  renderPeerList();
  updateChatHeader();
}

function updateChatHeader() {
  if (activePeer === null) {
    if (channels.size === 0) {
      dom.chatTarget.innerHTML = `<span>No peers connected yet</span>`;
    } else {
      dom.chatTarget.innerHTML = `Sending to <strong>all ${channels.size} peer${channels.size > 1 ? 's' : ''}</strong>
        <span class="broadcast-badge">BROADCAST</span>`;
    }
  } else {
    dom.chatTarget.innerHTML = `Talking to <strong>${activePeer.slice(0, 12)}…</strong>`;
  }
}

// ─── Channel Event Binding ────────────────────────────────────────────────────

function bindChannelEvents(channel, peerId) {
  channel.on('text', ({ body, ts }) => {
    appendMessage(peerId, body, 'incoming', ts);
  });

  channel.on('typing', () => {
    dom.typingIndicator.textContent = `${peerId.slice(0, 8)}… is typing…`;
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => { dom.typingIndicator.textContent = ''; }, 2000);
  });

  channel.on('file_start', ({ id, name, size }) => {
    appendFileProgress(id, name, size, peerId);
  });

  channel.on('progress', ({ id, pct, direction }) => {
    const el = activeTransfers.get(id);
    if (el) {
      el.querySelector('.progress-fill').style.width = pct + '%';
      el.querySelector('.file-size').textContent = `${direction === 'receive' ? '↓' : '↑'} ${pct}%`;
    }
  });

  channel.on('file', ({ id, name, blob, url }) => {
    const el = activeTransfers.get(id);
    if (el) el.remove();
    activeTransfers.delete(id);
    appendFileMessage(peerId, name, blob.size, url, 'incoming');
    showToast(`File received: ${name}`, 'success');
  });

  channel.on('file_abort', ({ id }) => {
    const el = activeTransfers.get(id);
    if (el) el.remove();
    activeTransfers.delete(id);
    appendSystemMessage(`File transfer cancelled`);
  });
}

// ─── Message Rendering ────────────────────────────────────────────────────────

function appendMessage(peerId, body, direction, ts = Date.now()) {
  const container = document.createElement('div');
  container.className = `msg ${direction}`;
  const time = new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const from  = direction === 'incoming' ? `${peerId.slice(0, 8)}…` : 'You';
  container.innerHTML = `
    <div class="msg-bubble">${escapeHtml(body)}</div>
    <div class="msg-meta">${from} · ${time}</div>`;
  appendToMessages(container);
}

function appendSystemMessage(text) {
  const el = document.createElement('div');
  el.className = 'msg system';
  el.innerHTML = `<div class="msg-bubble">${escapeHtml(text)}</div>`;
  appendToMessages(el);
}

function appendFileMessage(peerId, name, size, url, direction) {
  const container = document.createElement('div');
  container.className = `msg ${direction}`;
  const from = direction === 'incoming' ? `${peerId.slice(0, 8)}…` : 'You';
  container.innerHTML = `
    <div class="file-bubble">
      <span class="file-icon">📎</span>
      <div class="file-info">
        <div class="file-name">${escapeHtml(name)}</div>
        <div class="file-size">${formatBytes(size)}</div>
      </div>
      ${url ? `<a class="file-dl" href="${url}" download="${escapeHtml(name)}">Save</a>` : ''}
    </div>
    <div class="msg-meta">${from}</div>`;
  appendToMessages(container);
}

function appendFileProgress(id, name, size, peerId) {
  const container = document.createElement('div');
  container.className = 'msg incoming';
  container.innerHTML = `
    <div class="file-bubble">
      <span class="file-icon">⬇️</span>
      <div class="file-info">
        <div class="file-name">${escapeHtml(name)}</div>
        <div class="file-size">↓ 0%</div>
        <div class="progress-bar"><div class="progress-fill" style="width:0%"></div></div>
      </div>
    </div>
    <div class="msg-meta">${peerId.slice(0, 8)}…</div>`;
  activeTransfers.set(id, container);
  appendToMessages(container);
}

function appendToMessages(el) {
  // Hide empty state
  if (dom.emptyState) dom.emptyState.style.display = 'none';
  dom.messages.appendChild(el);
  dom.messages.scrollTop = dom.messages.scrollHeight;
}

// ─── Sending ───────────────────────────────────────────────────────────────────

function sendMessage() {
  const body = dom.messageInput.value.trim();
  if (!body) return;
  if (channels.size === 0) {
    showToast('No peers connected', 'error');
    return;
  }

  if (activePeer) {
    const ch = channels.get(activePeer);
    if (ch) ch.sendText(body);
  } else {
    // Broadcast
    for (const ch of channels.values()) ch.sendText(body);
  }

  appendMessage(null, body, 'outgoing');
  dom.messageInput.value = '';
  dom.messageInput.style.height = '';
}

async function onFileSelected(e) {
  const file = e.target.files[0];
  if (!file) return;
  dom.fileInput.value = '';

  if (channels.size === 0) {
    showToast('No peers connected', 'error');
    return;
  }

  const targets = activePeer ? [channels.get(activePeer)].filter(Boolean) : [...channels.values()];

  for (const ch of targets) {
    try {
      const id = await ch.sendFile(file);
      appendFileMessage(null, file.name, file.size, null, 'outgoing');
    } catch (err) {
      showToast(`File send failed: ${err.message}`, 'error');
    }
  }
}

// ─── Input Events ─────────────────────────────────────────────────────────────

function onKeyDown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

function onInputChange() {
  // Auto-resize
  dom.messageInput.style.height = 'auto';
  dom.messageInput.style.height = Math.min(dom.messageInput.scrollHeight, 120) + 'px';

  // Typing indicator
  if (activePeer) {
    const ch = channels.get(activePeer);
    if (ch) ch.sendTyping();
  }
}

// ─── Toasts ────────────────────────────────────────────────────────────────────

function showToast(message, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  dom.toastContainer.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ─── Utils ─────────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatBytes(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);
