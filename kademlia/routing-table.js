/**
 * routing-table.js — K-Bucket Routing Table
 *
 * Maintains 160 k-buckets, each holding up to K_BUCKET_SIZE peers.
 * Buckets are indexed by XOR distance (bit position of highest set bit).
 *
 * Kademlia rules enforced here:
 *  - Least-Recently Seen (LRS) eviction: new nodes go to tail;
 *    if a bucket is full and the head (LRS) node responds to PING,
 *    the new node is discarded. If head doesn't respond, evict & add new.
 *  - The routing table never stores our own node ID.
 */

'use strict';

const { xorDistance, bucketIndex, sortByDistance, idToHex } = require('./utils');

const K_BUCKET_SIZE = 20;   // Kademlia's "k" parameter
const ALPHA         = 3;    // Parallelism for lookups

class RoutingTable {
  /**
   * @param {Buffer} ownId  — this node's 160-bit ID
   */
  constructor(ownId) {
    this.ownId = ownId;
    // 160 buckets; each is an ordered Array of NodeInfo objects
    // NodeInfo: { id: Buffer, address: string, port: number, lastSeen: Date }
    this.buckets = Array.from({ length: 160 }, () => []);
  }

  // ─── Internal Helpers ──────────────────────────────────────────────────────

  _bucketFor(nodeId) {
    const dist = xorDistance(this.ownId, nodeId);
    const idx  = bucketIndex(dist);
    if (idx === -1) return null; // Same as own ID — should never happen
    return this.buckets[idx];
  }

  _indexOf(bucket, nodeId) {
    return bucket.findIndex(n => n.id.equals(nodeId));
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Add or refresh a node in the routing table.
   * Returns one of: 'added' | 'updated' | 'full' | 'self'
   *
   * @param {{ id: Buffer, address: string, port: number }} nodeInfo
   * @returns {string}
   */
  add(nodeInfo) {
    if (nodeInfo.id.equals(this.ownId)) return 'self';

    const bucket = this._bucketFor(nodeInfo.id);
    if (!bucket) return 'self';

    const existing = this._indexOf(bucket, nodeInfo.id);

    if (existing !== -1) {
      // Node already known — move to tail (Most Recently Seen)
      const [node] = bucket.splice(existing, 1);
      node.lastSeen = new Date();
      Object.assign(node, nodeInfo); // refresh address/port in case it changed
      bucket.push(node);
      return 'updated';
    }

    if (bucket.length < K_BUCKET_SIZE) {
      // Bucket has room — add to tail
      bucket.push({ ...nodeInfo, lastSeen: new Date() });
      return 'added';
    }

    // Bucket full — caller should PING bucket[0] (LRS node).
    // If no response, call evictAndAdd(). If response, discard new node.
    return 'full';
  }

  /**
   * Evict the Least-Recently-Seen node from a bucket and add the new one.
   * Call this only after confirming the LRS node is unresponsive.
   *
   * @param {Buffer} evictId  — ID of the LRS node (bucket head)
   * @param {{ id: Buffer, address: string, port: number }} newNode
   */
  evictAndAdd(evictId, newNode) {
    const bucket = this._bucketFor(newNode.id);
    if (!bucket) return;
    const idx = this._indexOf(bucket, evictId);
    if (idx !== -1) bucket.splice(idx, 1);
    bucket.push({ ...newNode, lastSeen: new Date() });
  }

  /**
   * Remove a node entirely (e.g. after confirmed failure).
   * @param {Buffer} nodeId
   */
  remove(nodeId) {
    const bucket = this._bucketFor(nodeId);
    if (!bucket) return;
    const idx = this._indexOf(bucket, nodeId);
    if (idx !== -1) bucket.splice(idx, 1);
  }

  /**
   * Find the K closest nodes to a target ID (excluding own ID).
   *
   * @param {Buffer} targetId
   * @param {number} [count=K_BUCKET_SIZE]
   * @returns {Array<NodeInfo>}
   */
  findClosest(targetId, count = K_BUCKET_SIZE) {
    const all = this.buckets.flat();
    return sortByDistance(targetId, all).slice(0, count);
  }

  /**
   * Get a specific node by ID.
   * @param {Buffer} nodeId
   * @returns {NodeInfo|null}
   */
  get(nodeId) {
    const bucket = this._bucketFor(nodeId);
    if (!bucket) return null;
    const idx = this._indexOf(bucket, nodeId);
    return idx !== -1 ? bucket[idx] : null;
  }

  /**
   * Return all known peers (flattened from all buckets).
   * @returns {Array<NodeInfo>}
   */
  allPeers() {
    return this.buckets.flat();
  }

  /**
   * Return stats for debugging / UI.
   */
  stats() {
    const filled = this.buckets.filter(b => b.length > 0).length;
    const total  = this.buckets.reduce((s, b) => s + b.length, 0);
    return { filledBuckets: filled, totalNodes: total };
  }

  /**
   * Serialise to plain objects (for logging / storage).
   */
  toJSON() {
    return this.buckets.map((bucket, i) =>
      bucket.length > 0
        ? { bucket: i, nodes: bucket.map(n => ({ ...n, id: idToHex(n.id) })) }
        : null
    ).filter(Boolean);
  }
}

module.exports = { RoutingTable, K_BUCKET_SIZE, ALPHA };
