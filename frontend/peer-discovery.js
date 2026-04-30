(function() {
'use strict';

const _PeerConnection     = (typeof PeerConnection     !== 'undefined') ? PeerConnection     : require('./peer-connection').PeerConnection;
const _DataChannelManager = (typeof DataChannelManager !== 'undefined') ? DataChannelManager : require('./data-channel').DataChannelManager;

const SIGNALING_RECONNECT_DELAY = 3000;
const MAX_CONNECTIONS           = 20;

// ─── Tiny EventEmitter ────────────────────────────────────────────────────────

class EventEmitter {
  constructor() { this._l = {}; }
  on(e, f)      { (this._l[e] = this._l[e] || []).push(f); return this; }
  off(e, f)     { this._l[e] = (this._l[e] || []).filter(x => x !== f); }
  emit(e, ...a) { (this._l[e] || []).forEach(f => f(...a)); }
}

// ─── SignalingChannel ─────────────────────────────────────────────────────────

class SignalingChannel extends EventEmitter {
  constructor(url, nodeId) {
    super();
    this.url    = url;
    this.nodeId = nodeId;
    this.ws     = null;
    this._queue = [];
  }

  connect() {
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      console.log('[Signaling] Connected, registering as', this.nodeId.slice(0, 12) + '…');
      this.ws.send(JSON.stringify({ type: 'register', nodeId: this.nodeId }));
      this._queue.forEach(m => this.ws.send(JSON.stringify(m)));
      this._queue = [];
    };

    this.ws.onmessage = (event) => {
      try { this.emit('message', JSON.parse(event.data)); }
      catch (_) {}
    };

    this.ws.onclose = () => {
      console.warn('[Signaling] Disconnected — reconnecting in', SIGNALING_RECONNECT_DELAY, 'ms');
      this.emit('close');
      setTimeout(() => this.connect(), SIGNALING_RECONNECT_DELAY);
    };

    this.ws.onerror = (e) => {
      console.error('[Signaling] WebSocket error:', e);
      this.emit('error', e);
    };
  }

  // peer-connection.js sends { type:'signal', payload:{...} }
  // We add 'to' for the server router and forward as-is.
  send(toNodeId, msg) {
    const envelope = { ...msg, to: toNodeId };
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(envelope));
    } else {
      this._queue.push(envelope);
    }
  }

  requestPeers() {
    const msg = { type: 'peers' };
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }
}

// ─── PeerDiscovery ────────────────────────────────────────────────────────────

class PeerDiscovery extends EventEmitter {
  constructor({ nodeId, signalingUrl, iceServers } = {}) {
    super();
    this.nodeId     = nodeId;
    this.iceServers = iceServers;

    // nodeId → { pc, dc }
    // dc is null while the WebRTC handshake is still in progress.
    // The entry is created as soon as we create a PeerConnection so that
    // incoming signals (answer, ICE) can always find the right pc object.
    this.connections = new Map();

    this.signaling = new SignalingChannel(signalingUrl, nodeId);
    this._wireSignaling();
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  start() { this.signaling.connect(); }

  connectedPeers() { return [...this.connections.keys()]; }

  broadcast(text) {
    for (const { dc } of this.connections.values()) {
      if (dc) dc.sendText(text);
    }
  }

  sendTo(nodeId, text) {
    const conn = this.connections.get(nodeId);
    if (conn?.dc) conn.dc.sendText(text);
  }

  sendFileTo(nodeId, file) {
    const conn = this.connections.get(nodeId);
    if (conn?.dc) return conn.dc.sendFile(file);
    return Promise.reject(new Error(`Peer ${nodeId} not connected`));
  }

  // ─── Signaling Wiring ────────────────────────────────────────────────────

  _wireSignaling() {
    this.signaling.on('message', (msg) => {
      switch (msg.type) {

        case 'registered':
          console.log('[Discovery] Registered with signaling server');
          this.signaling.requestPeers();
          this.emit('ready', { nodeId: this.nodeId });
          break;

        case 'peers':
          console.log('[Discovery] Got peer list, count:', (msg.list || []).length);
          this._handlePeerList(msg.list || []);
          break;

        case 'peer_joined':
          console.log('[Discovery] peer_joined:', msg.nodeId.slice(0, 12));
          if (msg.nodeId !== this.nodeId) {
            // Only the higher-ID node initiates to prevent both sides sending offers
            if (this.nodeId > msg.nodeId) {
              setTimeout(() => this._initiateConnection(msg.nodeId), 300);
            }
          }
          break;

        case 'peer_left':
          this._teardown(msg.nodeId);
          break;

        case 'signal':
          this._handleInboundSignal(msg.from, msg.payload);
          break;
      }
    });
  }

  _handlePeerList(list) {
    for (const peer of list) {
      if (peer.nodeId === this.nodeId) continue;
      if (this.connections.size >= MAX_CONNECTIONS) break;
      if (!this.connections.has(peer.nodeId) && this.nodeId > peer.nodeId) {
        this._initiateConnection(peer.nodeId);
      }
    }
  }

  // ─── Connection Lifecycle ─────────────────────────────────────────────────

  async _initiateConnection(remoteNodeId, attempt = 1) {
    // KEY FIX: only skip if there's already an active data channel (dc != null).
    // A null dc means handshake is in progress — allow replacing stale attempts.
    const existing = this.connections.get(remoteNodeId);
    if (existing?.dc) {
      console.log('[Discovery] Already connected to', remoteNodeId.slice(0, 12), '— skipping');
      return;
    }
    if (attempt > 3) {
      console.warn(`[Discovery] Giving up on ${remoteNodeId.slice(0, 12)} after 3 attempts`);
      return;
    }

    console.log(`[Discovery] Initiating connection to ${remoteNodeId.slice(0, 12)} (attempt ${attempt})`);

    const pc = new _PeerConnection(this.signaling, {
      localNodeId: this.nodeId,
      iceServers:  this.iceServers,
    });

    // KEY FIX: register in the map BEFORE sending the offer so that
    // when the answer arrives it finds a valid pc entry to route to.
    this.connections.set(remoteNodeId, { pc, dc: null });
    this._registerPcEvents(pc, remoteNodeId);

    try {
      await pc.createOffer(remoteNodeId);
      // createOffer resolves only when DataChannel opens — success handled in _registerPcEvents
    } catch (err) {
      console.warn(`[Discovery] Attempt ${attempt}/3 failed for ${remoteNodeId.slice(0, 12)}:`, err.message);
      // KEY FIX: only teardown if this pc is still the one registered
      // (a later attempt may have already replaced it)
      const current = this.connections.get(remoteNodeId);
      if (current?.pc === pc) {
        this._teardown(remoteNodeId);
        setTimeout(() => this._initiateConnection(remoteNodeId, attempt + 1), 2000);
      }
    }
  }

  async _handleInboundSignal(fromNodeId, payload) {
    if (!payload) {
      console.warn('[Signal] No payload from', fromNodeId?.slice(0, 12));
      return;
    }

    console.log('[Signal] from', fromNodeId.slice(0, 12), '| type:', payload.type);

    if (payload.type === 'offer') {
      const existing = this.connections.get(fromNodeId);

      // If we have a live connection with an open dc, ignore the offer
      if (existing?.dc) {
        console.log('[Signal] Already connected to', fromNodeId.slice(0, 12), '— ignoring offer');
        return;
      }

      // Clean up any stale in-progress entry
      if (existing) {
        console.log('[Signal] Replacing stale entry for', fromNodeId.slice(0, 12));
        this._teardown(fromNodeId);
      }

      const pc = new _PeerConnection(this.signaling, {
        localNodeId: this.nodeId,
        iceServers:  this.iceServers,
      });

      // KEY FIX: register pc BEFORE accepting so ICE candidates that arrive
      // before acceptOffer completes can be routed correctly
      this.connections.set(fromNodeId, { pc, dc: null });
      this._registerPcEvents(pc, fromNodeId);

      try {
        await pc.acceptOffer(fromNodeId, payload.sdp);
      } catch (err) {
        console.warn(`[Discovery] Failed to accept offer from ${fromNodeId.slice(0, 12)}:`, err.message);
        const current = this.connections.get(fromNodeId);
        if (current?.pc === pc) this._teardown(fromNodeId);
      }

    } else {
      // answer or ice — route to the pc registered for this peer
      const conn = this.connections.get(fromNodeId);
      if (conn?.pc) {
        console.log('[Signal] routing', payload.type, '→', fromNodeId.slice(0, 12));
        conn.pc.handleSignal(payload);
      } else {
        console.warn('[Signal] no pc found for', fromNodeId.slice(0, 12), '| type:', payload.type, '— dropping');
      }
    }
  }

  _registerPcEvents(pc, remoteNodeId) {
    pc.on('open', (rawChannel) => {
      const dc = new _DataChannelManager(rawChannel, this.nodeId);
      this.connections.set(remoteNodeId, { pc, dc });
      console.log(`[Discovery] ✓ Connected to ${remoteNodeId.slice(0, 12)}!`);
      this.emit('peer_connected', { nodeId: remoteNodeId, channel: dc });
    });

    pc.on('close', () => this._teardown(remoteNodeId));
    pc.on('error', (err) => {
      console.error('[Discovery] PeerConnection error:', err.message);
      const current = this.connections.get(remoteNodeId);
      if (current?.pc === pc) this._teardown(remoteNodeId);
    });
  }

  _teardown(nodeId) {
    const conn = this.connections.get(nodeId);
    if (!conn) return;

    // Delete FIRST to break any re-entrant teardown loops
    this.connections.delete(nodeId);
    try { conn.pc?.close(); } catch (_) {}

    console.log(`[Discovery] Disconnected from ${nodeId.slice(0, 12)}`);
    // Only emit peer_disconnected if the data channel was open (truly connected)
    if (conn.dc) this.emit('peer_disconnected', { nodeId });
  }
}

// ─── Export ───────────────────────────────────────────────────────────────────

window.PeerDiscovery    = PeerDiscovery;
window.SignalingChannel = SignalingChannel;

})();
