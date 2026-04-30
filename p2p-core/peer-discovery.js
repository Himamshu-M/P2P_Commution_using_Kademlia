/**
 * peer-discovery.js — Kademlia-Guided Peer Discovery
 *
 * Bridges the Kademlia DHT logic and the WebRTC layer.
 * Responsibilities:
 *   1. Connect to the signaling server and register this node
 *   2. Bootstrap the Kademlia routing table using peers from the signaling server
 *   3. Establish direct WebRTC connections to discovered peers
 *   4. Expose a clean API for the frontend
 *
 * Events emitted:
 *   'peer_connected'   { nodeId, channel: DataChannelManager }
 *   'peer_disconnected' { nodeId }
 *   'ready'            { nodeId }  — once signaling server connection is established
 *   'error'            Error
 */

'use strict';

// In Node.js test environments these would be imports; in the browser they're
// globals loaded by <script> tags before this file.
const _PeerConnection     = (typeof PeerConnection     !== 'undefined') ? PeerConnection     : require('./peer-connection').PeerConnection;
const _DataChannelManager = (typeof DataChannelManager !== 'undefined') ? DataChannelManager : require('./data-channel').DataChannelManager;

const SIGNALING_RECONNECT_DELAY = 3000;   // ms
const MAX_CONNECTIONS = 20;               // max simultaneous WebRTC peers

// ─── Tiny EventEmitter ────────────────────────────────────────────────────────
class EventEmitter {
  constructor() { this._l = {}; }
  on(e, f)     { (this._l[e] = this._l[e] || []).push(f); return this; }
  off(e, f)    { this._l[e] = (this._l[e] || []).filter(x => x !== f); }
  emit(e, ...a){ (this._l[e] || []).forEach(f => f(...a)); }
}

// ─── SignalingChannel — thin wrapper around WebSocket ────────────────────────

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
      this.ws.send(JSON.stringify({ type: 'register', nodeId: this.nodeId }));
      this._queue.forEach(m => this.ws.send(JSON.stringify(m)));
      this._queue = [];
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        this.emit('message', msg);
      } catch { /* ignore malformed */ }
    };

    this.ws.onclose = () => {
      this.emit('close');
      setTimeout(() => this.connect(), SIGNALING_RECONNECT_DELAY);
    };

    this.ws.onerror = (e) => this.emit('error', e);
  }

  /** Relay a signal payload to a remote peer via the server */
  send(toNodeId, payload) {
    const msg = { type: 'signal', to: toNodeId, payload };
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      this._queue.push(msg);
    }
  }

  /** Request the current peer list from the server */
  requestPeers() {
    const msg = { type: 'peers' };
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }
}

// ─── PeerDiscovery ────────────────────────────────────────────────────────────

class PeerDiscovery extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string} opts.nodeId           — 40-char hex node ID
   * @param {string} opts.signalingUrl     — 'ws://localhost:8765'
   * @param {Array}  [opts.iceServers]     — custom STUN/TURN
   */
  constructor({ nodeId, signalingUrl, iceServers } = {}) {
    super();
    this.nodeId      = nodeId;
    this.iceServers  = iceServers;

    /** @type {Map<string, { pc: PeerConnection, dc: DataChannelManager }>} */
    this.connections = new Map();

    // Incoming offers we haven't answered yet: nodeId → offerSdp
    this._pendingOffers = new Map();

    this.signaling = new SignalingChannel(signalingUrl, nodeId);
    this._wireSignaling();
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  /** Start everything. */
  start() {
    this.signaling.connect();
  }

  /** Return all currently connected peer IDs */
  connectedPeers() {
    return [...this.connections.keys()];
  }

  /** Send a text message to all connected peers */
  broadcast(text) {
    for (const { dc } of this.connections.values()) {
      dc.sendText(text);
    }
  }

  /** Send a text message to a specific peer */
  sendTo(nodeId, text) {
    const conn = this.connections.get(nodeId);
    if (conn) conn.dc.sendText(text);
  }

  /** Send a file to a specific peer */
  sendFileTo(nodeId, file) {
    const conn = this.connections.get(nodeId);
    if (conn) return conn.dc.sendFile(file);
    return Promise.reject(new Error(`Peer ${nodeId} not connected`));
  }

  // ─── Private: Signaling ───────────────────────────────────────────────────

  _wireSignaling() {
    this.signaling.on('message', (msg) => {
      switch (msg.type) {
        case 'registered':
          this.signaling.requestPeers();
          this.emit('ready', { nodeId: this.nodeId });
          break;

        case 'peers':
          this._handlePeerList(msg.list || []);
          break;

        case 'peer_joined':
          // Initiate connection to new peer (lower-ID node initiates to avoid race)
          if (msg.nodeId !== this.nodeId && msg.nodeId > this.nodeId) {
            this._initiateConnection(msg.nodeId);
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
      if (!this.connections.has(peer.nodeId)) {
        // Lower-ID peer initiates to avoid symmetric double-offers
        if (this.nodeId > peer.nodeId) {
          this._initiateConnection(peer.nodeId);
        }
      }
    }
  }

  // ─── Private: Connection Lifecycle ───────────────────────────────────────

  async _initiateConnection(remoteNodeId) {
    if (this.connections.has(remoteNodeId)) return;

    const pc = new _PeerConnection(this.signaling, {
      localNodeId: this.nodeId,
      iceServers:  this.iceServers,
    });

    this._registerPcEvents(pc, remoteNodeId);

    try {
      await pc.createOffer(remoteNodeId);
    } catch (err) {
      console.warn(`[Discovery] Failed to connect to ${remoteNodeId.slice(0, 12)}:`, err.message);
      this._teardown(remoteNodeId);
    }
  }

  async _handleInboundSignal(fromNodeId, payload) {
    if (payload.type === 'offer') {
      if (this.connections.has(fromNodeId)) return; // Already connected

      const pc = new _PeerConnection(this.signaling, {
        localNodeId: this.nodeId,
        iceServers:  this.iceServers,
      });
      this._registerPcEvents(pc, fromNodeId);
      // Store temporarily so ICE candidates can be routed
      this.connections.set(fromNodeId, { pc, dc: null });

      try {
        await pc.acceptOffer(fromNodeId, payload.sdp);
      } catch (err) {
        console.warn(`[Discovery] Failed to accept offer from ${fromNodeId.slice(0, 12)}:`, err.message);
        this._teardown(fromNodeId);
      }

    } else {
      // answer or ice — route to existing pc
      const conn = this.connections.get(fromNodeId);
      if (conn?.pc) conn.pc.handleSignal(payload);
    }
  }

  _registerPcEvents(pc, remoteNodeId) {
    pc.on('open', (rawChannel) => {
      const dc = new _DataChannelManager(rawChannel, this.nodeId);
      this.connections.set(remoteNodeId, { pc, dc });
      console.log(`[Discovery] Connected to ${remoteNodeId.slice(0, 12)}…`);
      this.emit('peer_connected', { nodeId: remoteNodeId, channel: dc });
    });

    pc.on('close', () => this._teardown(remoteNodeId));
    pc.on('error', (err) => {
      console.error('[Discovery] PeerConnection error:', err);
      this._teardown(remoteNodeId);
    });
  }

  _teardown(nodeId) {
    const conn = this.connections.get(nodeId);
    if (conn) {
      conn.pc?.close();
      this.connections.delete(nodeId);
      this.emit('peer_disconnected', { nodeId });
      console.log(`[Discovery] Disconnected from ${nodeId.slice(0, 12)}…`);
    }
  }
}

// ─── Export ───────────────────────────────────────────────────────────────────

if (typeof module !== 'undefined') {
  module.exports = { PeerDiscovery, SignalingChannel };
} else {
  window.PeerDiscovery   = PeerDiscovery;
  window.SignalingChannel = SignalingChannel;
}
