# Kademlia P2P Communication System
## Architecture & Design Documentation

> **Project type:** Internship / Research  
> **Stack:** Node.js · WebSocket · WebRTC · Kademlia DHT  
> **Goal:** Build a fully decentralized peer-to-peer messaging and file sharing system using Kademlia's distributed hash table for routing — operable in both simulated and real-world browser environments.

---

## 1. System Overview

This project implements a P2P communication platform inspired by Kademlia — the DHT algorithm powering BitTorrent, IPFS, and Ethereum's peer discovery. Unlike centralized chat systems, there is **no server that routes messages**. After an initial handshake, every bit of data flows directly between browsers over encrypted WebRTC data channels.

```
 Browser A ──────────────────────────────── Browser B
     │                                           │
     │  (1) Register nodeId via WebSocket        │
     │ ─────────────────────────────────────►    │
     │         Signaling Server                  │
     │ ◄─────────────────────────────────────    │
     │  (2) Exchange SDP offer/answer + ICE      │
     │                                           │
     │ ══════════ WebRTC DataChannel ═══════════ │
     │   (3) Text messages, files, typing         │
     │       (no server involved past this)      │
```

---

## 2. Component Architecture

### 2.1 Kademlia Engine (`/kademlia/`)

The mathematical core of the system. Three files, zero dependencies.

| File | Responsibility |
|------|---------------|
| `utils.js` | 160-bit node IDs via SHA-1, XOR distance metric, bucket index calculator |
| `routing-table.js` | 160 k-buckets (k=20 each), LRS eviction policy, closest-node queries |
| `node.js` | PING / FIND_NODE / STORE / FIND_VALUE RPCs, iterative lookup algorithm |

**Key design decision:** The Kademlia layer is transport-agnostic. It accepts any object implementing `{ send(peer, msg): Promise }`. This means the same routing logic works over WebRTC data channels in the browser OR over TCP/UDP in Node.js.

#### XOR Distance Metric

Kademlia's genius is using XOR as its distance function:

```
distance(A, B) = A ⊕ B
```

Properties that make this work:
- **Symmetric:** `d(A,B) = d(B,A)` — distance is the same in both directions
- **Triangle inequality:** `d(A,C) ≤ d(A,B) ⊕ d(B,C)` — routing is always making progress
- **Unidirectional:** for any point X and distance d, there is exactly one point Y such that `d(X,Y) = d`

#### K-Bucket Routing Table

Each node maintains 160 buckets (one per bit of the 160-bit ID space). Bucket `i` holds nodes whose IDs differ from ours at bit position `i` and agree on all higher bits.

```
Bit position  Bucket  Covers nodes at distance
    0           0      [2^0,  2^1)  ← 1 node possible in this range
    1           1      [2^1,  2^2)
    ...
   159         159     [2^159, 2^160)
```

Each bucket holds at most k=20 nodes, sorted by last-seen time. When a bucket is full and a new node arrives, the Least-Recently-Seen head is pinged. If it responds, the new node is discarded (stable nodes are preferred). If it doesn't respond, it's evicted.

---

### 2.2 Signaling Server (`/signaling-server/`)

A minimal WebSocket relay, purpose-built for one job: exchange SDP and ICE candidates between two browsers that don't yet have a direct connection.

**Protocol:**
```
Client → Server: { type: 'register', nodeId: '<40 hex chars>' }
Client → Server: { type: 'signal',   to: '<nodeId>', payload: <SDP|ICE> }
Client → Server: { type: 'peers' }

Server → Client: { type: 'registered', nodeId }
Server → Client: { type: 'signal', from: '<nodeId>', payload }
Server → Client: { type: 'peers', list: [{nodeId, address}] }
Server → Client: { type: 'peer_joined', nodeId }
Server → Client: { type: 'peer_left',   nodeId }
```

**After handshake:** The server is completely out of the picture. Messages and files travel directly between browsers.

---

### 2.3 P2P Core (`/p2p-core/`)

The WebRTC layer, organized into three single-responsibility modules.

#### `peer-connection.js` — WebRTC Lifecycle

Wraps `RTCPeerConnection`. Handles the awkward ceremony of WebRTC setup:

```
Caller                          Answerer
  │                                 │
  ├─ createOffer()                  │
  ├─ setLocalDescription(offer)     │
  ├──────── signal: offer ─────────►│
  │                                 ├─ setRemoteDescription(offer)
  │                                 ├─ createAnswer()
  │                                 ├─ setLocalDescription(answer)
  │◄──────── signal: answer ────────┤
  ├─ setRemoteDescription(answer)   │
  │                                 │
  │◄═══ ICE candidates (both ways) ═╪══► [STUN servers resolve public IPs]
  │                                 │
  │◄══════ RTCDataChannel open ═════╪════► ready for P2P traffic
```

STUN servers used: `stun.l.google.com:19302` and `stun.cloudflare.com:3478` — these help discover public IP addresses for NAT traversal but never see payload data.

#### `data-channel.js` — Message & File Protocol

Implements a lightweight framing protocol over the raw `RTCDataChannel`:

```
Text message:    { type:'text',       id, from, body, ts }
File start:      { type:'file_start', id, from, name, size, mimeType, totalChunks }
File chunk:      { type:'file_chunk', id, index, data: <base64> }
File end:        { type:'file_end',   id }
Typing signal:   { type:'typing',     from }
```

Files are chunked at 16 KB (safe limit for all browser implementations), reassembled in-order on the receiving end, and delivered as `Blob` objects with a generated `objectURL` for download.

#### `peer-discovery.js` — Orchestration

Ties signaling + WebRTC + Kademlia together:

1. Connects to signaling server
2. Registers node ID
3. Fetches existing peer list
4. Initiates WebRTC connections (lower-ID node always initiates to avoid double-offers)
5. Routes incoming signals to the correct `PeerConnection` instance
6. Exposes `broadcast()`, `sendTo()`, `sendFileTo()` to the UI layer

---

### 2.4 Frontend (`/frontend/`)

A single-page app with no framework dependencies.

- **`index.html`** — semantic structure: header, sidebar (peer list + DHT stats), main chat area
- **`style.css`** — dark industrial theme using CSS custom properties; JetBrains Mono + Space Mono typefaces; CSS animations for message entry and toast notifications
- **`app.js`** — generates/restores a persistent session node ID, wires `PeerDiscovery` events to DOM updates, handles text/file sending with real-time progress indicators

---

## 3. Data Flow Diagrams

### 3.1 Peer Discovery Flow

```
New browser opens page
        │
        ▼
Generate 160-bit node ID (random, stored in sessionStorage)
        │
        ▼
Connect to Signaling Server (WebSocket)
        │
        ├─ Register nodeId
        ├─ Receive: list of currently online peers
        │
        ▼
For each peer in list:
  Lower-ID node initiates → createOffer() → signal via server
  Higher-ID node receives offer → acceptOffer() → signal answer back
        │
        ▼
ICE negotiation (STUN) ──► Direct P2P connection established
        │
        ▼
RTCDataChannel open ──► Kademlia routing table updated
```

### 3.2 File Transfer Flow

```
Sender                    DataChannel              Receiver
  │                           │                       │
  ├─ file_start ──────────────►────────────────────► render progress bar
  │                           │                       │
  ├─ file_chunk[0] ──────────►────────────────────► store chunk[0]
  ├─ file_chunk[1] ──────────►────────────────────► store chunk[1]
  │        ...                                        ...
  ├─ file_chunk[N] ──────────►────────────────────► store chunk[N]
  │                           │                       │
  ├─ file_end ───────────────►────────────────────► reassemble Blob
                                                      generate objectURL
                                                      render download link
```

---

## 4. Security Notes

| Concern | Status |
|---------|--------|
| WebRTC encryption | ✅ All P2P traffic is DTLS-encrypted by the WebRTC spec |
| Signaling security | ⚠️ Current server has no authentication — add WSS + tokens for production |
| Node ID forgery | ⚠️ Node IDs are self-generated; use public-key derived IDs for Sybil resistance |
| File content | ⚠️ No malware scanning — warn users before opening received files |

---

## 5. Running the Project

### Prerequisites
- Node.js ≥ 18
- Modern browser (Chrome, Firefox, Edge, Safari)

### Start the Signaling Server
```bash
cd signaling-server
npm install
npm start
# Server running on ws://localhost:8765
```

### Open the Frontend
Open `frontend/index.html` in two browser tabs (or two devices on the same network, replacing `localhost` with your LAN IP in `app.js`).

Both tabs will auto-discover each other and establish a direct P2P connection within a few seconds.

---

## 6. Extension Ideas

- **Persistent node identity** — derive node ID from a keypair stored in IndexedDB
- **DHT-based username directory** — use `put('username:alice', nodeId)` for name resolution
- **Group channels** — store channel member lists in the DHT
- **TURN server fallback** — for symmetric NAT environments where STUN alone fails
- **Message history** — persist chat to IndexedDB locally
- **Multi-hop routing** — route messages through intermediate Kademlia peers for anonymity
