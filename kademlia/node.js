/**
 * node.js — KademliaNode
 *
 * Implements the four Kademlia RPCs:
 *   PING        — check if a peer is alive
 *   FIND_NODE   — locate the k-closest nodes to a target ID
 *   STORE       — save a key/value pair on this node
 *   FIND_VALUE  — retrieve a value by key (or fall back to FIND_NODE)
 *
 * Transport is intentionally abstract: inject a `transport` object that
 * implements { send(nodeInfo, message): Promise<response> }.  This lets
 * the same Kademlia logic drive both a Node.js UDP/TCP transport and the
 * browser WebRTC data-channel transport.
 */

'use strict';

const { RoutingTable, K_BUCKET_SIZE, ALPHA } = require('./routing-table');
const {
  randomNodeId,
  generateNodeId,
  idToHex,
  hexToId,
  xorDistance,
  sortByDistance,
} = require('./utils');

const LOOKUP_TIMEOUT_MS = 5000;   // Per-RPC timeout
const REPUBLISH_INTERVAL = 60_000; // Re-announce stored values every 60 s

class KademliaNode {
  /**
   * @param {{ transport: object, id?: Buffer|string }} options
   *   transport  — { send(peer, msg): Promise<object> }
   *   id         — optional fixed node ID (Buffer or hex string); random if omitted
   */
  constructor({ transport, id } = {}) {
    if (!transport) throw new Error('KademliaNode requires a transport');

    this.transport    = transport;
    this.id           = id
      ? (Buffer.isBuffer(id) ? id : hexToId(id))
      : randomNodeId();
    this.hexId        = idToHex(this.id);
    this.routingTable = new RoutingTable(this.id);
    this.store        = new Map();   // key (hex) → { value, timestamp }

    // Wire inbound RPCs
    transport.on('rpc', (msg, reply) => this._handleRpc(msg, reply));

    this._republishTimer = null;
  }

  // ─── Bootstrap ────────────────────────────────────────────────────────────

  /**
   * Join the network by contacting one known bootstrap peer.
   * Performs a self-lookup to populate the routing table.
   *
   * @param {{ id: Buffer, address: string, port: number }} bootstrapPeer
   */
  async bootstrap(bootstrapPeer) {
    this.routingTable.add(bootstrapPeer);
    await this.lookup(this.id);           // Self-lookup fills our k-buckets
    this._startRepublish();
    console.log(`[Kademlia] Bootstrapped. ${this.routingTable.stats().totalNodes} peers known.`);
  }

  // ─── Public Higher-Level API ──────────────────────────────────────────────

  /**
   * Store a value in the DHT.
   * @param {string} key
   * @param {*}      value
   */
  async put(key, value) {
    const keyId   = generateNodeId(key);
    const closest = await this.lookup(keyId);
    await Promise.all(
      closest.map(peer => this._rpc(peer, { type: 'STORE', key, value }).catch(() => {}))
    );
  }

  /**
   * Retrieve a value from the DHT.
   * @param {string} key
   * @returns {*|null}
   */
  async get(key) {
    const keyId = generateNodeId(key);
    return this._findValue(keyId, key);
  }

  // ─── Kademlia Iterative Lookup ────────────────────────────────────────────

  /**
   * Iterative node lookup.  Returns the k-closest nodes to targetId.
   * @param {Buffer} targetId
   * @returns {Promise<Array<NodeInfo>>}
   */
  async lookup(targetId) {
    const visited  = new Set();
    let   shortlist = this.routingTable.findClosest(targetId, K_BUCKET_SIZE);

    if (shortlist.length === 0) return [];

    while (true) {
      // Pick ALPHA unvisited nodes from the shortlist
      const unvisited = shortlist.filter(n => !visited.has(idToHex(n.id)));
      const batch     = unvisited.slice(0, ALPHA);
      if (batch.length === 0) break;

      batch.forEach(n => visited.add(idToHex(n.id)));

      const results = await Promise.allSettled(
        batch.map(peer =>
          this._rpc(peer, { type: 'FIND_NODE', targetId: idToHex(targetId) })
        )
      );

      let improved = false;
      for (const result of results) {
        if (result.status !== 'fulfilled') continue;
        const { nodes } = result.value;
        if (!nodes) continue;

        for (const raw of nodes) {
          const n = { ...raw, id: hexToId(raw.id) };
          this.routingTable.add(n);
          if (!visited.has(raw.id)) {
            shortlist.push(n);
            improved = true;
          }
        }
      }

      // Re-sort and trim shortlist
      shortlist = sortByDistance(targetId, shortlist).slice(0, K_BUCKET_SIZE);
      if (!improved) break;
    }

    return shortlist.slice(0, K_BUCKET_SIZE);
  }

  // ─── Private: Find Value Walk ─────────────────────────────────────────────

  async _findValue(keyId, key) {
    const visited   = new Set();
    let   shortlist = this.routingTable.findClosest(keyId, K_BUCKET_SIZE);

    // Check local store first
    const local = this.store.get(idToHex(keyId));
    if (local) return local.value;

    while (true) {
      const unvisited = shortlist.filter(n => !visited.has(idToHex(n.id)));
      const batch     = unvisited.slice(0, ALPHA);
      if (batch.length === 0) return null;

      batch.forEach(n => visited.add(idToHex(n.id)));

      const results = await Promise.allSettled(
        batch.map(peer =>
          this._rpc(peer, { type: 'FIND_VALUE', key })
        )
      );

      for (const result of results) {
        if (result.status !== 'fulfilled') continue;
        const { value, nodes } = result.value;
        if (value !== undefined) return value;   // Found it!
        if (nodes) {
          for (const raw of nodes) {
            const n = { ...raw, id: hexToId(raw.id) };
            this.routingTable.add(n);
            if (!visited.has(raw.id)) shortlist.push(n);
          }
        }
      }

      shortlist = sortByDistance(keyId, shortlist).slice(0, K_BUCKET_SIZE);
    }
  }

  // ─── Private: Inbound RPC Handler ────────────────────────────────────────

  _handleRpc(msg, reply) {
    // Refresh the sender in our routing table
    if (msg.senderId) {
      this.routingTable.add({
        id:      hexToId(msg.senderId),
        address: msg.senderAddress || '',
        port:    msg.senderPort    || 0,
      });
    }

    switch (msg.type) {
      case 'PING':
        reply({ type: 'PONG', nodeId: this.hexId });
        break;

      case 'FIND_NODE': {
        const targetId = hexToId(msg.targetId);
        const closest  = this.routingTable.findClosest(targetId, K_BUCKET_SIZE);
        reply({
          type:  'FOUND_NODES',
          nodes: closest.map(n => ({ ...n, id: idToHex(n.id) })),
        });
        break;
      }

      case 'STORE': {
        const keyId = idToHex(generateNodeId(msg.key));
        this.store.set(keyId, { value: msg.value, timestamp: Date.now() });
        reply({ type: 'STORE_OK' });
        break;
      }

      case 'FIND_VALUE': {
        const keyId = idToHex(generateNodeId(msg.key));
        const entry = this.store.get(keyId);
        if (entry) {
          reply({ type: 'FOUND_VALUE', value: entry.value });
        } else {
          const closest = this.routingTable.findClosest(hexToId(keyId), K_BUCKET_SIZE);
          reply({
            type:  'FOUND_NODES',
            nodes: closest.map(n => ({ ...n, id: idToHex(n.id) })),
          });
        }
        break;
      }

      default:
        reply({ type: 'ERROR', message: `Unknown RPC type: ${msg.type}` });
    }
  }

  // ─── Private: Outbound RPC ────────────────────────────────────────────────

  _rpc(peer, message) {
    return Promise.race([
      this.transport.send(peer, { ...message, senderId: this.hexId }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('RPC timeout')), LOOKUP_TIMEOUT_MS)
      ),
    ]);
  }

  // ─── Republish ────────────────────────────────────────────────────────────

  _startRepublish() {
    this._republishTimer = setInterval(async () => {
      for (const [keyHex, { value }] of this.store.entries()) {
        const keyId   = Buffer.from(keyHex, 'hex');
        const closest = await this.lookup(keyId);
        await Promise.all(
          closest.map(peer =>
            this._rpc(peer, { type: 'STORE', key: keyHex, value }).catch(() => {})
          )
        );
      }
    }, REPUBLISH_INTERVAL);
    if (this._republishTimer.unref) this._republishTimer.unref();
  }

  stop() {
    clearInterval(this._republishTimer);
  }

  // ─── Debug ────────────────────────────────────────────────────────────────

  toString() {
    const { filledBuckets, totalNodes } = this.routingTable.stats();
    return `KademliaNode(${this.hexId.slice(0, 12)}… | peers=${totalNodes} | buckets=${filledBuckets})`;
  }
}

module.exports = { KademliaNode, K_BUCKET_SIZE, ALPHA };
