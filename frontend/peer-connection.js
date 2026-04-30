(function() {
'use strict';

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

const CHANNEL_LABEL   = 'kademlia-data';
const CONNECT_TIMEOUT = 60_000;

// ─── Tiny EventEmitter ────────────────────────────────────────────────────────

class EventEmitter {
  constructor() { this._listeners = {}; }
  on(event, fn)     { (this._listeners[event] = this._listeners[event] || []).push(fn); return this; }
  off(event, fn)    { this._listeners[event] = (this._listeners[event] || []).filter(f => f !== fn); }
  emit(event, ...a) { (this._listeners[event] || []).forEach(f => f(...a)); }
  once(event, fn)   { const w = (...a) => { this.off(event, w); fn(...a); }; this.on(event, w); }
}

// ─── PeerConnection ───────────────────────────────────────────────────────────

class PeerConnection extends EventEmitter {
  constructor(signaling, { localNodeId, iceServers = DEFAULT_ICE_SERVERS } = {}) {
    super();
    this.signaling    = signaling;
    this.localNodeId  = localNodeId;
    this.iceServers   = iceServers;
    this.remoteNodeId = null;
    this.pc           = null;
    this.dataChannel  = null;
    this._connected   = false;
    this._pendingIce  = [];
    this._closing     = false;
  }

  // ─── Initiate (Caller) ────────────────────────────────────────────────────

  createOffer(remoteNodeId) {
    this.remoteNodeId = remoteNodeId;
    this._setupPeerConnection();
    this.dataChannel = this.pc.createDataChannel(CHANNEL_LABEL, { ordered: true });
    this._bindDataChannelEvents(this.dataChannel);
    return this._negotiateOffer();
  }

  // ─── Accept (Answerer) ────────────────────────────────────────────────────

  async acceptOffer(remoteNodeId, offerSdp) {
    this.remoteNodeId = remoteNodeId;
    this._setupPeerConnection();

    this.pc.ondatachannel = (event) => {
      this.dataChannel = event.channel;
      this._bindDataChannelEvents(this.dataChannel);
    };

    await this.pc.setRemoteDescription(new RTCSessionDescription(offerSdp));

    for (const ice of this._pendingIce) {
      await this.pc.addIceCandidate(new RTCIceCandidate(ice)).catch(e =>
        console.warn('[ICE] Failed to add buffered candidate:', e.message)
      );
    }
    this._pendingIce = [];

    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);

    this.signaling.send(remoteNodeId, {
      type:    'signal',
      payload: { type: 'answer', sdp: answer },
    });
  }

  // ─── Handle Incoming Signal ───────────────────────────────────────────────

  async handleSignal(payload) {
    if (!this.pc) {
      console.warn('[PeerConnection] handleSignal called but pc is null, type:', payload.type);
      return;
    }

    if (payload.type === 'answer') {
      if (this.pc.signalingState !== 'have-local-offer') {
        console.warn('[PeerConnection] Ignoring answer — signalingState is:', this.pc.signalingState);
        return;
      }
      await this.pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      for (const ice of this._pendingIce) {
        await this.pc.addIceCandidate(new RTCIceCandidate(ice)).catch(e =>
          console.warn('[ICE] Failed to add buffered candidate:', e.message)
        );
      }
      this._pendingIce = [];

    } else if (payload.type === 'ice') {
      if (!payload.candidate) return;
      if (this.pc.remoteDescription) {
        await this.pc.addIceCandidate(new RTCIceCandidate(payload.candidate)).catch(e =>
          console.warn('[ICE] addIceCandidate failed:', e.message)
        );
      } else {
        this._pendingIce.push(payload.candidate);
      }
    }
  }

  // ─── Close ────────────────────────────────────────────────────────────────

  close() {
    if (this._closing) return;
    this._closing = true;

    if (this.dataChannel) {
      try { this.dataChannel.close(); } catch (_) {}
      this.dataChannel = null;
    }
    if (this.pc) {
      this.pc.onconnectionstatechange    = null;
      this.pc.oniceconnectionstatechange = null;
      this.pc.onicecandidate             = null;
      this.pc.ondatachannel              = null;
      try { this.pc.close(); } catch (_) {}
      this.pc = null;
    }
    this._connected = false;
    this.emit('close');
  }

  get connected() { return this._connected; }

  // ─── Private: Setup ───────────────────────────────────────────────────────

  _setupPeerConnection() {
    this.pc = new RTCPeerConnection({ iceServers: this.iceServers });

    this.pc.oniceconnectionstatechange = () => {
      if (!this.pc) return;
      const s = this.pc.iceConnectionState;
      console.log('[ICE] state:', s);
      // NOTE: we do NOT reject the offer promise on 'failed' here.
      // mDNS-only candidates always fail initially — once you disable
      // chrome://flags/#enable-webrtc-hide-local-ips-with-mdns the real
      // IPs appear and ICE succeeds. Failing fast was causing the offer
      // to be torn down before the answer arrived.
      if (s === 'failed') {
        console.error(
          '[ICE] *** FAILED ***\n' +
          'All candidates are mDNS (.local) — Chrome is hiding your real IP.\n' +
          'FIX (required, one-time):\n' +
          '  1. Open a new tab\n' +
          '  2. Go to: chrome://flags/#enable-webrtc-hide-local-ips-with-mdns\n' +
          '  3. Set dropdown to: Disabled\n' +
          '  4. Click Relaunch\n' +
          '  5. Hard-refresh this page (Ctrl+Shift+R)'
        );
      }
    };

    this.pc.onicegatheringstatechange = () => {
      if (!this.pc) return;
      console.log('[ICE] gathering:', this.pc.iceGatheringState);
    };

    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        const addr   = event.candidate.address || '';
        const isMdns = addr.endsWith('.local');
        if (isMdns) {
          console.warn('[ICE] mDNS candidate (real IP hidden):', addr);
        } else if (addr) {
          console.log('[ICE] candidate:', event.candidate.type, addr);
        }
        this.signaling.send(this.remoteNodeId, {
          type:    'signal',
          payload: { type: 'ice', candidate: event.candidate },
        });
      } else {
        console.log('[ICE] gathering complete');
      }
    };

    this.pc.onconnectionstatechange = () => {
      if (!this.pc) return;
      const state = this.pc.connectionState;
      console.log('[WebRTC] connection state:', state);
      if (state === 'connected') {
        this._connected = true;
      } else if (['disconnected', 'failed', 'closed'].includes(state)) {
        this._connected = false;
        setTimeout(() => this.emit('close'), 0);
      }
    };

    this.pc.onicecandidateerror = (e) => {
      if (e.errorCode === 701) {
        // Suppress — expected when STUN is unreachable or mDNS is active
      } else {
        console.warn('[WebRTC] ICE candidate error:', e.errorCode, e.errorText);
      }
    };
  }

  // ─── Private: Negotiate ───────────────────────────────────────────────────

  async _negotiateOffer() {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);

    this.signaling.send(this.remoteNodeId, {
      type:    'signal',
      payload: { type: 'offer', sdp: offer },
    });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Connection timeout')), CONNECT_TIMEOUT);
      // Only resolve on DataChannel open — that's the true success signal.
      // Do NOT reject on ICE 'failed' state because with mDNS candidates
      // ICE reports failed even while the answer/ICE exchange is still in flight.
      this.once('open',  ()    => { clearTimeout(timer); resolve(); });
      this.once('error', (err) => { clearTimeout(timer); reject(err); });
    });
  }

  // ─── Private: Data Channel ────────────────────────────────────────────────

  _bindDataChannelEvents(channel) {
    channel.onopen = () => {
      console.log('[DataChannel] open — P2P connection established!');
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

window.PeerConnection      = PeerConnection;
window.DEFAULT_ICE_SERVERS = DEFAULT_ICE_SERVERS;

})();
