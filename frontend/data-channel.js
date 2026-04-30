/**
 * data-channel.js — Text & File Transfer over RTCDataChannel
 *
 * Protocol (JSON envelope over the raw RTCDataChannel):
 *
 *   Text message:
 *     { type: 'text', id: string, from: string, body: string, ts: number }
 *
 *   File transfer — chunked:
 *     { type: 'file_start',  id, from, name, size, mimeType, totalChunks }
 *     { type: 'file_chunk',  id, index, data: <base64> }
 *     { type: 'file_end',    id }
 *     { type: 'file_abort',  id, reason }
 *
 *   Typing indicator:
 *     { type: 'typing', from: string }
 *
 * Usage:
 *   const dc = new DataChannelManager(rawRTCDataChannel, localNodeId);
 *   dc.on('text',       ({ from, body, ts }) => { ... });
 *   dc.on('file',       ({ name, blob })     => { ... });
 *   dc.on('progress',   ({ id, pct })        => { ... });
 *   dc.on('typing',     ({ from })           => { ... });
 *   dc.sendText('hello!');
 *   dc.sendFile(fileObject);
 */
(function() {
'use strict';

const CHUNK_SIZE = 16 * 1024;   // 16 KB per chunk — safe for all browsers

// Tiny EventEmitter (same pattern as peer-connection.js)
class EventEmitter {
  constructor() { this._l = {}; }
  on(e, f)     { (this._l[e] = this._l[e] || []).push(f); return this; }
  off(e, f)    { this._l[e] = (this._l[e] || []).filter(x => x !== f); }
  emit(e, ...a){ (this._l[e] || []).forEach(f => f(...a)); }
}

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// ─── DataChannelManager ───────────────────────────────────────────────────────

class DataChannelManager extends EventEmitter {
  /**
   * @param {RTCDataChannel} channel
   * @param {string}         localNodeId
   */
  constructor(channel, localNodeId) {
    super();
    this.channel      = channel;
    this.localNodeId  = localNodeId;
    this._inbound     = new Map();   // id → { meta, chunks[] }
    this._aborted     = new Set();

    channel.onmessage = (event) => this._handleMessage(event.data);
    channel.onerror   = (e)     => this.emit('error', e);
    channel.onclose   = ()      => this.emit('close');
  }

  // ─── Send Text ────────────────────────────────────────────────────────────

  /**
   * @param {string} body
   * @returns {string}  message id
   */
  sendText(body) {
    const id = uid();
    this._send({ type: 'text', id, from: this.localNodeId, body, ts: Date.now() });
    return id;
  }

  // ─── Send Typing Indicator ────────────────────────────────────────────────

  sendTyping() {
    this._send({ type: 'typing', from: this.localNodeId });
  }

  // ─── Send File ────────────────────────────────────────────────────────────

  /**
   * @param {File|Blob} file
   * @param {string}    [fileName]   — override for Blob inputs
   * @returns {Promise<string>}  resolves with transfer id when done
   */
  async sendFile(file, fileName) {
    const id          = uid();
    const name        = fileName || file.name || 'file';
    const size        = file.size;
    const mimeType    = file.type || 'application/octet-stream';
    const totalChunks = Math.ceil(size / CHUNK_SIZE);

    this._send({ type: 'file_start', id, from: this.localNodeId, name, size, mimeType, totalChunks });

    let index = 0;
    let offset = 0;

    while (offset < size) {
      if (this._aborted.has(id)) throw new Error(`Transfer ${id} aborted`);

      const slice = file.slice(offset, offset + CHUNK_SIZE);
      const data  = await this._blobToBase64(slice);
      this._send({ type: 'file_chunk', id, index, data });

      const pct = Math.round(((index + 1) / totalChunks) * 100);
      this.emit('progress', { id, pct, direction: 'send' });

      index++;
      offset += CHUNK_SIZE;

      // Yield to the event loop to avoid blocking UI on large files
      await new Promise(r => setTimeout(r, 0));
    }

    this._send({ type: 'file_end', id });
    return id;
  }

  // ─── Abort In-Flight Transfer ─────────────────────────────────────────────

  abort(id, reason = 'User cancelled') {
    this._aborted.add(id);
    this._send({ type: 'file_abort', id, reason });
    this._inbound.delete(id);
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  _send(obj) {
    if (this.channel.readyState !== 'open') {
      console.warn('[DataChannel] Cannot send — channel not open');
      return;
    }
    this.channel.send(JSON.stringify(obj));
  }

  _handleMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      this.emit('error', new Error('Malformed message'));
      return;
    }

    switch (msg.type) {

      case 'text':
        this.emit('text', { id: msg.id, from: msg.from, body: msg.body, ts: msg.ts });
        break;

      case 'typing':
        this.emit('typing', { from: msg.from });
        break;

      case 'file_start':
        this._inbound.set(msg.id, {
          meta:   { name: msg.name, size: msg.size, mimeType: msg.mimeType, from: msg.from, totalChunks: msg.totalChunks },
          chunks: [],
        });
        this.emit('file_start', { id: msg.id, name: msg.name, size: msg.size, from: msg.from });
        break;

      case 'file_chunk': {
        const transfer = this._inbound.get(msg.id);
        if (!transfer) return;
        transfer.chunks[msg.index] = msg.data;   // may arrive out of order

        const received = transfer.chunks.filter(Boolean).length;
        const pct      = Math.round((received / transfer.meta.totalChunks) * 100);
        this.emit('progress', { id: msg.id, pct, direction: 'receive' });
        break;
      }

      case 'file_end': {
        const transfer = this._inbound.get(msg.id);
        if (!transfer) return;

        // Reassemble — all chunks should be present
        const { name, mimeType, from } = transfer.meta;
        const binaryChunks = transfer.chunks.map(b64 => {
          const binary = atob(b64);
          const arr    = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
          return arr;
        });
        const blob = new Blob(binaryChunks, { type: mimeType });
        this._inbound.delete(msg.id);
        this.emit('file', { id: msg.id, name, blob, from, url: URL.createObjectURL(blob) });
        break;
      }

      case 'file_abort': {
        this._inbound.delete(msg.id);
        this.emit('file_abort', { id: msg.id, reason: msg.reason });
        break;
      }

      default:
        console.warn('[DataChannel] Unknown message type:', msg.type);
    }
  }

  _blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
}

// ─── Export ───────────────────────────────────────────────────────────────────

window.DataChannelManager = DataChannelManager;
window.CHUNK_SIZE = CHUNK_SIZE;

})();
