# Kademlia P2P Communication System

A browser-based peer-to-peer chat and file sharing system using **Kademlia DHT** for routing and **WebRTC DataChannels** for direct peer communication. A minimal WebSocket signaling server bootstraps connections — after that, no server touches your data.

```
p2p-kademlia-project/
├── signaling-server/
│   ├── server.js          ← WebSocket signaling server (Node.js)
│   └── package.json
├── kademlia/
│   ├── utils.js           ← SHA-1 IDs, XOR distance, bucket index
│   ├── routing-table.js   ← 160 k-buckets, LRS eviction
│   └── node.js            ← PING / FIND_NODE / STORE / FIND_VALUE RPCs
├── p2p-core/
│   ├── peer-connection.js ← RTCPeerConnection wrapper
│   ├── data-channel.js    ← Text & chunked file transfer protocol
│   └── peer-discovery.js  ← Wires Kademlia + WebRTC + signaling
├── frontend/
│   ├── index.html         ← Chat UI
│   ├── app.js             ← UI controller
│   └── style.css          ← Dark industrial theme
├── docs/
│   └── architecture.md    ← Full system documentation
└── README.md
```

---

## Quick Start

### 1 — Start the signaling server

```bash
cd signaling-server
npm install
npm start
# Listening on ws://localhost:8765
# Frontend served at http://localhost:8765
```

### 2 — Open two browser tabs

Navigate both to `http://localhost:8765`

Each tab gets a random 160-bit Kademlia node ID. They discover each other via the signaling server, negotiate a WebRTC connection, and then communicate **directly** — no server relay.

### 3 — Send messages and files

Type in the chat box and hit **Enter**. Use the 📎 button to send any file (chunked at 16 KB, reassembled client-side). Open more tabs to test broadcast messaging.

---

## Testing on Two Devices (LAN)

Edit `SIGNALING_URL` in `frontend/app.js`:

```js
const SIGNALING_URL = `ws://YOUR_LAN_IP:8765`;
```

Then on both devices open `http://YOUR_LAN_IP:8765`.

---

## How It Works

1. **Browser opens** → generates a random 160-bit node ID
2. **Connects to signaling server** → registers node ID, gets peer list
3. **WebRTC handshake** → SDP offer/answer + ICE via signaling server
4. **Direct connection established** → signaling server is no longer involved
5. **Kademlia routing table** updated with each new peer
6. **Messages & files** flow over encrypted RTCDataChannel

For full architecture detail, see [`docs/architecture.md`](docs/architecture.md).

---

## Build Order (for learning / extending)

```
Step 1 → kademlia/utils.js          Pure math — XOR, SHA-1, bucket index
Step 2 → kademlia/node.js           KademliaNode class + 4 RPCs
Step 3 → kademlia/routing-table.js  K-bucket management
Step 4 → signaling-server/server.js WebSocket relay
Step 5 → p2p-core/peer-connection.js WebRTC setup
Step 6 → p2p-core/data-channel.js   Messaging + file chunking
Step 7 → p2p-core/peer-discovery.js Connect all layers
Step 8 → frontend/                  UI
```

---

## Dependencies

| Package | Used in | Purpose |
|---------|---------|---------|
| `ws` | signaling-server | WebSocket server |
| `express` | signaling-server | HTTP + static file serving |
| Browser APIs | frontend | WebRTC, Crypto, FileReader (no npm needed) |

---

## License

MIT
