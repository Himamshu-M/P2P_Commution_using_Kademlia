/**
 * utils.js — Kademlia Math Primitives
 * XOR distance metric + SHA-1 node ID generation
 */

'use strict';

const crypto = require('crypto');

// ─── Constants ───────────────────────────────────────────────────────────────
const ID_LENGTH_BITS  = 160;   // SHA-1 output size
const ID_LENGTH_BYTES = 20;    // 160 / 8

// ─── SHA-1 Node ID Generation ────────────────────────────────────────────────

/**
 * Generate a deterministic 160-bit node ID from any input string.
 * Returns a Buffer of 20 bytes.
 *
 * @param {string} input  — e.g. "ip:port", a public key, or a random seed
 * @returns {Buffer}
 */
function generateNodeId(input) {
  return crypto.createHash('sha1').update(input).digest();
}

/**
 * Generate a random 160-bit node ID (for new nodes with no stable identity).
 * @returns {Buffer}
 */
function randomNodeId() {
  return crypto.randomBytes(ID_LENGTH_BYTES);
}

/**
 * Encode a Buffer node ID as a lowercase hex string (for display / JSON).
 * @param {Buffer} id
 * @returns {string}
 */
function idToHex(id) {
  return id.toString('hex');
}

/**
 * Decode a hex string back to a Buffer node ID.
 * @param {string} hex
 * @returns {Buffer}
 */
function hexToId(hex) {
  return Buffer.from(hex, 'hex');
}

// ─── XOR Distance Metric ─────────────────────────────────────────────────────

/**
 * Compute XOR distance between two 160-bit IDs.
 * Returns a Buffer of 20 bytes representing the distance.
 *
 * In Kademlia, "closeness" = small XOR value.
 *
 * @param {Buffer} idA
 * @param {Buffer} idB
 * @returns {Buffer}
 */
function xorDistance(idA, idB) {
  if (idA.length !== ID_LENGTH_BYTES || idB.length !== ID_LENGTH_BYTES) {
    throw new Error(`Node IDs must be ${ID_LENGTH_BYTES} bytes each`);
  }
  const result = Buffer.allocUnsafe(ID_LENGTH_BYTES);
  for (let i = 0; i < ID_LENGTH_BYTES; i++) {
    result[i] = idA[i] ^ idB[i];
  }
  return result;
}

/**
 * Compare two XOR distances (Buffers).
 * Returns:
 *   -1 if distA < distB  (A is closer)
 *    0 if distA === distB
 *    1 if distA > distB  (B is closer)
 *
 * @param {Buffer} distA
 * @param {Buffer} distB
 * @returns {-1|0|1}
 */
function compareDistances(distA, distB) {
  for (let i = 0; i < ID_LENGTH_BYTES; i++) {
    if (distA[i] < distB[i]) return -1;
    if (distA[i] > distB[i]) return  1;
  }
  return 0;
}

/**
 * Given a reference node ID and a list of candidate node descriptors,
 * sort the candidates by XOR distance (closest first).
 *
 * @param {Buffer}   referenceId
 * @param {Array<{id: Buffer}>} nodes
 * @returns {Array<{id: Buffer}>}
 */
function sortByDistance(referenceId, nodes) {
  return [...nodes].sort((a, b) => {
    const dA = xorDistance(referenceId, a.id);
    const dB = xorDistance(referenceId, b.id);
    return compareDistances(dA, dB);
  });
}

/**
 * Determine which k-bucket index (0–159) a node belongs to,
 * given the XOR distance from our own ID.
 *
 * The bucket index = position of the highest set bit in the distance.
 * Bucket 0 → distance in [2^0, 2^1)
 * Bucket 159 → distance in [2^159, 2^160)
 *
 * @param {Buffer} distance  — output of xorDistance()
 * @returns {number}  0–159, or -1 if distance is zero (same node)
 */
function bucketIndex(distance) {
  for (let byte = 0; byte < ID_LENGTH_BYTES; byte++) {
    const b = distance[byte];
    if (b !== 0) {
      // Find the highest set bit in this byte
      for (let bit = 7; bit >= 0; bit--) {
        if (b & (1 << bit)) {
          return (ID_LENGTH_BYTES - 1 - byte) * 8 + bit;
        }
      }
    }
  }
  return -1; // Distance is zero → same node
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  ID_LENGTH_BITS,
  ID_LENGTH_BYTES,
  generateNodeId,
  randomNodeId,
  idToHex,
  hexToId,
  xorDistance,
  compareDistances,
  sortByDistance,
  bucketIndex,
};
