/**
 * peer-connection.js — WebRTC RTCPeerConnection Wrapper
 *
 * Handles the full WebRTC lifecycle:
 *   1. Create offer / accept offer+answer
 *   2. Exchange ICE candidates via signaling server
 *   3. Expose a clean EventEmitter-style API
 *
 * Usage:
 *   const pc = new PeerConnection(signalingChannel, { iceServers });
 *   pc.on('open',    (dataChannel) => { ... });
 *   pc.on('close',   ()            => { ... });
 *   pc.on('error',   (err)         => { ... });
 *   await pc.createOffer(remoteNodeId);
 *   // OR
 *   await pc.acceptOffer(remoteNodeId, offerSdp);
 */

'use strict';

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

const CHANNEL_LABEL  = 'kademlia-data';
const CONNECT_TIMEOUT = 30_000; // ms

// ─── Tiny EventEmitter (browser-safe) ────────────────────────────────────────

class EventEmitter {
  constructor() { this._listeners = {}; }
  on(event, fn)     { (this._listeners[event] = this._listeners[event] || []).push(fn); return this; }
  off(event, fn)    { this._listeners[event] = (this._listeners[event] || []).filter(f => f !== fn); }
  emit(event, ...a) { (this._listeners[event] || []).forEach(f => f(...a)); }
  once(event, fn)   { const w = (...a) => { this.off(event, w); fn(...a); }; this.on(event, w); }
}

// ─── PeerConnection ───────────────────────────────────────────────────────────

class PeerConnection extends EventEmitter {
  /**
   * @param {SignalingChannel} signaling  — must implement send(nodeId, msg) and on('message', cb)
   * @param {object}           options
   * @param {string}           options.localNodeId
   * @param {Array}            [options.iceServers]
   */
  constructor(signaling, { localNodeId, iceServers = DEFAULT_ICE_SERVERS } = {}) {
    super();
    this.signaling     = signaling;
    this.localNodeId   = localNodeId;
    this.iceServers    = iceServers;
    this.remoteNodeId  = null;
    this.pc            = null;
    this.dataChannel   = null;
    this._connected    = false;
    this._pendingIce   = [];   // ICE candidates buffered before remote desc is set
  }

  // ─── Initiate Connection (Caller side) ────────────────────────────────────

  /**
   * Create an SDP offer and send it to the remote peer via signaling.
   * @param {string} remoteNodeId
   * @returns {Promise<void>}  Resolves when the data channel opens
   */
  createOffer(remoteNodeId) {
    this.remoteNodeId = remoteNodeId;
    this._setupPeerConnection();

    // Create data channel (offerer always creates it)
    this.dataChannel = this.pc.createDataChannel(CHANNEL_LABEL, {
      ordered: true,
    });
    this._bindDataChannelEvents(this.dataChannel);

    return this._negotiateOffer();
  }

  // ─── Accept Connection (Answerer side) ────────────────────────────────────

  /**
   * Accept an SDP offer from a remote peer and send back an answer.
   * @param {string} remoteNodeId
   * @param {RTCSessionDescriptionInit} offerSdp
   * @returns {Promise<void>}
   */
  async acceptOffer(remoteNodeId, offerSdp) {
    this.remoteNodeId = remoteNodeId;
    this._setupPeerConnection();

    // Answerer receives the data channel via ondatachannel
    this.pc.ondatachannel = (event) => {
      this.dataChannel = event.channel;
      this._bindDataChannelEvents(this.dataChannel);
    };

    await this.pc.setRemoteDescription(new RTCSessionDescription(offerSdp));

    // Flush buffered ICE candidates
    for (const ice of this._pendingIce) {
      await this.pc.addIceCandidate(new RTCIceCandidate(ice)).catch(() => {});
    }
    this._pendingIce = [];

    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);

    this.signaling.send(remoteNodeId, {
      type:    'signal',
      payload: { type: 'answer', sdp: answer },
    });
  }

  // ─── Receive Signaling Messages ───────────────────────────────────────────

  /**
   * Feed incoming signaling messages here.
   * Typically wired up by the SignalingChannel.
   * @param {{ type: 'answer'|'ice', sdp?: object, candidate?: object }} payload
   */
  async handleSignal(payload) {
    if (!this.pc) return;

    if (payload.type === 'answer') {
      await this.pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      for (const ice of this._pendingIce) {
        await this.pc.addIceCandidate(new RTCIceCandidate(ice)).catch(() => {});
      }
      this._pendingIce = [];

    } else if (payload.type === 'ice') {
      if (this.pc.remoteDescription) {
        await this.pc.addIceCandidate(new RTCIceCandidate(payload.candidate)).catch(() => {});
      } else {
        this._pendingIce.push(payload.candidate);
      }
    }
  }

  // ─── Close ────────────────────────────────────────────────────────────────

  close() {
    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    this._connected = false;
    this.emit('close');
  }

  get connected() { return this._connected; }

  // ─── Private ──────────────────────────────────────────────────────────────

  _setupPeerConnection() {
    this.pc = new RTCPeerConnection({ iceServers: this.iceServers });

    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.signaling.send(this.remoteNodeId, {
          type:    'signal',
          payload: { type: 'ice', candidate: event.candidate },
        });
      }
    };

    this.pc.onconnectionstatechange = () => {
      const state = this.pc.connectionState;
      if (state === 'connected') {
        this._connected = true;
      } else if (['disconnected', 'failed', 'closed'].includes(state)) {
        this._connected = false;
        this.emit('close');
      }
    };

    this.pc.onicecandidateerror = (e) => {
      console.warn('[WebRTC] ICE candidate error:', e.errorCode, e.errorText);
    };
  }

  async _negotiateOffer() {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);

    this.signaling.send(this.remoteNodeId, {
      type:    'signal',
      payload: { type: 'offer', sdp: offer },
    });

    // Return a promise that resolves when the data channel opens
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Connection timeout')), CONNECT_TIMEOUT);
      this.once('open', () => { clearTimeout(timer); resolve(); });
      this.once('error', (err) => { clearTimeout(timer); reject(err); });
    });
  }

  _bindDataChannelEvents(channel) {
    channel.onopen = () => {
      this._connected = true;
      this.emit('open', channel);
    };
    channel.onclose = () => {
      this._connected = false;
      this.emit('close');
    };
    channel.onerror = (e) => {
      this.emit('error', new Error(e.error?.message || 'DataChannel error'));
    };
    channel.onmessage = (event) => {
      this.emit('message', event.data);
    };
  }
}

// ─── Export ───────────────────────────────────────────────────────────────────

// Works in browser (window.PeerConnection) and Node.js (module.exports)
if (typeof module !== 'undefined') {
  module.exports = { PeerConnection, DEFAULT_ICE_SERVERS };
} else {
  window.PeerConnection = PeerConnection;
}
