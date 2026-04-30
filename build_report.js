const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, HeadingLevel, BorderStyle, WidthType,
  ShadingType, VerticalAlign, PageNumber, PageBreak, LevelFormat,
  TabStopType, TabStopPosition, TableOfContents
} = require('docx');
const fs = require('fs');

// ─── Color Palette ────────────────────────────────────────────────────────────
const C = {
  navy:      '1B3A5C',
  blue:      '2E75B6',
  lightBlue: 'D6E4F0',
  teal:      '1F7A8C',
  tealLight: 'D0EAF0',
  gray:      '4A4A4A',
  lightGray: 'F2F2F2',
  midGray:   'CCCCCC',
  white:     'FFFFFF',
  accent:    '00B0D7',
  green:     '1A7A4A',
  greenLight:'D4EDDA',
  amber:     'C47A00',
  amberLight:'FFF3CD',
  red:       'A02020',
  redLight:  'FADBD8',
};

// ─── Border helpers ───────────────────────────────────────────────────────────
const border1 = (color = C.midGray) => ({ style: BorderStyle.SINGLE, size: 1, color });
const noBorder = () => ({ style: BorderStyle.NONE, size: 0, color: C.white });
const allBorders = (color = C.midGray) => ({
  top: border1(color), bottom: border1(color),
  left: border1(color), right: border1(color)
});
const noBorders = () => ({
  top: noBorder(), bottom: noBorder(),
  left: noBorder(), right: noBorder()
});

// ─── Paragraph helpers ────────────────────────────────────────────────────────
const sp = (before = 0, after = 120) => ({ spacing: { before, after } });

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new TextRun({ text, bold: true, size: 36, color: C.navy, font: 'Arial' })],
    ...sp(360, 180),
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: C.blue, space: 1 } },
  });
}

function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [new TextRun({ text, bold: true, size: 28, color: C.blue, font: 'Arial' })],
    ...sp(240, 120),
  });
}

function h3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    children: [new TextRun({ text, bold: true, size: 24, color: C.teal, font: 'Arial' })],
    ...sp(180, 80),
  });
}

function body(text, opts = {}) {
  return new Paragraph({
    children: [new TextRun({ text, size: 22, font: 'Arial', color: C.gray, ...opts })],
    ...sp(0, 120),
    alignment: AlignmentType.JUSTIFIED,
  });
}

function bold(text) {
  return new TextRun({ text, bold: true, size: 22, font: 'Arial', color: C.gray });
}

function bodyRuns(runs) {
  return new Paragraph({
    children: runs,
    ...sp(0, 120),
    alignment: AlignmentType.JUSTIFIED,
  });
}

function bullet(text, level = 0) {
  return new Paragraph({
    numbering: { reference: 'bullets', level },
    children: [new TextRun({ text, size: 22, font: 'Arial', color: C.gray })],
    ...sp(0, 80),
  });
}

function numbered(text, level = 0) {
  return new Paragraph({
    numbering: { reference: 'numbers', level },
    children: [new TextRun({ text, size: 22, font: 'Arial', color: C.gray })],
    ...sp(0, 80),
  });
}

function pageBreak() {
  return new Paragraph({ children: [new PageBreak()] });
}

function blankLine() {
  return new Paragraph({ children: [new TextRun('')], spacing: { before: 0, after: 160 } });
}

// ─── Caption helper ───────────────────────────────────────────────────────────
function caption(text) {
  return new Paragraph({
    children: [new TextRun({ text, size: 18, italics: true, color: '666666', font: 'Arial' })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 40, after: 180 },
  });
}

// ─── Info box ─────────────────────────────────────────────────────────────────
function infoBox(label, lines, fillColor = C.lightBlue, borderColor = C.blue) {
  const rows = [];
  // Header row
  rows.push(new TableRow({
    children: [new TableCell({
      borders: allBorders(borderColor),
      shading: { fill: borderColor, type: ShadingType.CLEAR },
      margins: { top: 80, bottom: 80, left: 160, right: 160 },
      width: { size: 9360, type: WidthType.DXA },
      children: [new Paragraph({
        children: [new TextRun({ text: label, bold: true, size: 22, color: C.white, font: 'Arial' })],
      })],
    })]
  }));
  // Content rows
  lines.forEach(line => {
    rows.push(new TableRow({
      children: [new TableCell({
        borders: allBorders(borderColor),
        shading: { fill: fillColor, type: ShadingType.CLEAR },
        margins: { top: 60, bottom: 60, left: 160, right: 160 },
        width: { size: 9360, type: WidthType.DXA },
        children: [new Paragraph({
          children: [new TextRun({ text: line, size: 20, font: 'Arial', color: C.gray })],
          spacing: { before: 0, after: 60 },
        })],
      })]
    }));
  });
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [9360],
    rows,
  });
}

// ─── Two-column comparison table ──────────────────────────────────────────────
function twoColTable(headers, rows2, col1 = 4680, col2 = 4680) {
  const tableRows = [];
  // Header
  tableRows.push(new TableRow({
    tableHeader: true,
    children: headers.map((h, i) => new TableCell({
      borders: allBorders(C.blue),
      shading: { fill: C.navy, type: ShadingType.CLEAR },
      width: { size: i === 0 ? col1 : col2, type: WidthType.DXA },
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 20, color: C.white, font: 'Arial' })] })],
    }))
  }));
  // Data rows
  rows2.forEach((row, ri) => {
    tableRows.push(new TableRow({
      children: row.map((cell, i) => new TableCell({
        borders: allBorders(C.midGray),
        shading: { fill: ri % 2 === 0 ? C.white : C.lightGray, type: ShadingType.CLEAR },
        width: { size: i === 0 ? col1 : col2, type: WidthType.DXA },
        margins: { top: 60, bottom: 60, left: 120, right: 120 },
        children: [new Paragraph({ children: [new TextRun({ text: cell, size: 20, font: 'Arial', color: C.gray })] })],
      }))
    }));
  });
  return new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: [col1, col2], rows: tableRows });
}

// ─── Three-column table ───────────────────────────────────────────────────────
function threeColTable(headers, rows3) {
  const w = [2800, 3280, 3280];
  const tableRows = [];
  tableRows.push(new TableRow({
    tableHeader: true,
    children: headers.map((h, i) => new TableCell({
      borders: allBorders(C.blue),
      shading: { fill: C.navy, type: ShadingType.CLEAR },
      width: { size: w[i], type: WidthType.DXA },
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 20, color: C.white, font: 'Arial' })] })],
    }))
  }));
  rows3.forEach((row, ri) => {
    tableRows.push(new TableRow({
      children: row.map((cell, i) => new TableCell({
        borders: allBorders(C.midGray),
        shading: { fill: ri % 2 === 0 ? C.white : C.lightGray, type: ShadingType.CLEAR },
        width: { size: w[i], type: WidthType.DXA },
        margins: { top: 60, bottom: 60, left: 120, right: 120 },
        children: [new Paragraph({ children: [new TextRun({ text: cell, size: 20, font: 'Arial', color: C.gray })] })],
      }))
    }));
  });
  return new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: w, rows: tableRows });
}

// ─── ASCII-art diagram in monospace box ──────────────────────────────────────
function diagramBox(title, lines) {
  const rows = [];
  rows.push(new TableRow({
    children: [new TableCell({
      borders: allBorders(C.teal),
      shading: { fill: C.teal, type: ShadingType.CLEAR },
      margins: { top: 80, bottom: 80, left: 160, right: 160 },
      width: { size: 9360, type: WidthType.DXA },
      children: [new Paragraph({
        children: [new TextRun({ text: title, bold: true, size: 22, color: C.white, font: 'Arial' })],
      })],
    })]
  }));
  lines.forEach(line => {
    rows.push(new TableRow({
      children: [new TableCell({
        borders: allBorders(C.teal),
        shading: { fill: '1A1A2E', type: ShadingType.CLEAR },
        margins: { top: 20, bottom: 20, left: 200, right: 200 },
        width: { size: 9360, type: WidthType.DXA },
        children: [new Paragraph({
          children: [new TextRun({ text: line, size: 18, font: 'Courier New', color: '00D4FF' })],
          spacing: { before: 0, after: 20 },
        })],
      })]
    }));
  });
  return new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: [9360], rows });
}

// ─── Section divider ─────────────────────────────────────────────────────────
function sectionBanner(text) {
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [9360],
    rows: [new TableRow({
      children: [new TableCell({
        borders: noBorders(),
        shading: { fill: C.navy, type: ShadingType.CLEAR },
        margins: { top: 120, bottom: 120, left: 240, right: 240 },
        width: { size: 9360, type: WidthType.DXA },
        children: [new Paragraph({
          children: [new TextRun({ text, bold: true, size: 32, color: C.white, font: 'Arial' })],
          alignment: AlignmentType.CENTER,
        })],
      })]
    })]
  });
}

// ─── Document assembly ───────────────────────────────────────────────────────
const children = [];

// ══════════════════════════════════════════════════════════════════════════════
// COVER PAGE
// ══════════════════════════════════════════════════════════════════════════════
children.push(
  new Paragraph({ children: [new TextRun('')], spacing: { before: 1440, after: 0 } }),
  new Paragraph({
    children: [new TextRun({ text: 'KADEMLIA-INSPIRED', bold: true, size: 64, color: C.navy, font: 'Arial' })],
    alignment: AlignmentType.CENTER, spacing: { before: 0, after: 80 },
  }),
  new Paragraph({
    children: [new TextRun({ text: 'PEER-TO-PEER COMMUNICATION SYSTEM', bold: true, size: 48, color: C.blue, font: 'Arial' })],
    alignment: AlignmentType.CENTER, spacing: { before: 0, after: 80 },
  }),
  new Paragraph({
    children: [new TextRun({ text: 'A Comprehensive Technical Report', size: 28, italics: true, color: C.teal, font: 'Arial' })],
    alignment: AlignmentType.CENTER, spacing: { before: 0, after: 720 },
  }),
  new Table({
    width: { size: 9360, type: WidthType.DXA }, columnWidths: [9360],
    rows: [new TableRow({ children: [new TableCell({
      borders: allBorders(C.blue),
      shading: { fill: C.lightBlue, type: ShadingType.CLEAR },
      margins: { top: 240, bottom: 240, left: 480, right: 480 },
      width: { size: 9360, type: WidthType.DXA },
      children: [
        new Paragraph({ children: [new TextRun({ text: 'Subject:', bold: true, size: 22, font: 'Arial', color: C.navy })], spacing: { before: 0, after: 60 } }),
        new Paragraph({ children: [new TextRun({ text: 'Distributed Systems / Peer-to-Peer Networking', size: 22, font: 'Arial', color: C.gray })], spacing: { before: 0, after: 120 } }),
        new Paragraph({ children: [new TextRun({ text: 'Technology Stack:', bold: true, size: 22, font: 'Arial', color: C.navy })], spacing: { before: 0, after: 60 } }),
        new Paragraph({ children: [new TextRun({ text: 'Node.js  |  WebRTC  |  WebSocket  |  Kademlia DHT  |  JavaScript', size: 22, font: 'Arial', color: C.gray })], spacing: { before: 0, after: 120 } }),
        new Paragraph({ children: [new TextRun({ text: 'Purpose:', bold: true, size: 22, font: 'Arial', color: C.navy })], spacing: { before: 0, after: 60 } }),
        new Paragraph({ children: [new TextRun({ text: 'Internship Project Documentation', size: 22, font: 'Arial', color: C.gray })], spacing: { before: 0, after: 60 } }),
      ],
    })]})],
  }),
  new Paragraph({ children: [new TextRun('')], spacing: { before: 720, after: 0 } }),
  new Paragraph({
    children: [new TextRun({ text: '2024', size: 26, color: C.gray, font: 'Arial' })],
    alignment: AlignmentType.CENTER, spacing: { before: 0, after: 0 },
  }),
  pageBreak(),
);

// ══════════════════════════════════════════════════════════════════════════════
// TABLE OF CONTENTS
// ══════════════════════════════════════════════════════════════════════════════
children.push(
  h1('Table of Contents'),
  blankLine(),
);
const tocEntries = [
  ['1.', 'Introduction', '3'],
  ['2.', 'Ideology', '5'],
  ['3.', 'Motivation', '7'],
  ['4.', 'Basic Requirements', '9'],
  ['5.', 'Understanding Different Terms', '11'],
  ['6.', 'Workflow', '15'],
  ['7.', 'How a Message and File is Transferred', '20'],
  ['8.', 'Limitations', '25'],
  ['9.', 'Conclusion', '27'],
  ['10.', 'Bibliography', '29'],
];
tocEntries.forEach(([num, title, pg]) => {
  children.push(new Paragraph({
    children: [
      new TextRun({ text: `${num}  ${title}`, size: 22, font: 'Arial', color: C.navy }),
      new TextRun({ text: '\t' + pg, size: 22, font: 'Arial', color: C.gray }),
    ],
    tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX, leader: 'dot' }],
    spacing: { before: 60, after: 60 },
  }));
});
children.push(pageBreak());

// ══════════════════════════════════════════════════════════════════════════════
// 1. INTRODUCTION
// ══════════════════════════════════════════════════════════════════════════════
children.push(
  sectionBanner('1. Introduction'),
  blankLine(),
  h1('1. Introduction'),
  body('The internet, as most people interact with it today, operates on a fundamentally centralised model. When you send a message on WhatsApp, watch a video on YouTube, or share a document over Google Drive, your data passes through corporate servers owned by large technology companies. These servers act as intermediaries, controlling the flow of information, enforcing policies, logging activity, and representing single points of failure.'),
  blankLine(),
  body('This project proposes and implements an alternative model: a fully decentralised, peer-to-peer (P2P) communication system inspired by the Kademlia Distributed Hash Table (DHT) algorithm. In this system, every participant is simultaneously a client and a server. There is no central authority routing messages or storing files. After an initial handshake, data travels directly and securely between browsers using WebRTC DataChannels.'),
  blankLine(),
  body('The system was built as an internship research project to explore the theoretical foundations of distributed systems and translate them into a working, browser-based application. It demonstrates that production-grade P2P communication — including real-time text messaging, file transfer, typing indicators, and broadcast messaging — is achievable using only native browser APIs and a minimal signalling server whose role terminates after the initial connection is established.'),
  blankLine(),
  h2('1.1  Scope of This Report'),
  body('This report documents the complete technical journey of building the system, from foundational theory to working implementation. It covers:'),
  bullet('The philosophical and ideological basis of decentralised networking'),
  bullet('The mathematical principles of Kademlia — XOR distance metric, k-bucket routing tables, and iterative node lookup'),
  bullet('The WebRTC protocol stack and how it enables secure, direct browser-to-browser communication'),
  bullet('The complete workflow from peer discovery to message and file delivery'),
  bullet('All technical challenges encountered during development, with detailed error analysis'),
  bullet('The limitations of the current implementation and directions for future work'),
  blankLine(),
  h2('1.2  What Makes This System Different'),
  twoColTable(
    ['Traditional Centralised System', 'Kademlia P2P System'],
    [
      ['Data passes through central servers', 'Data travels directly peer-to-peer'],
      ['Single point of failure', 'No central point of failure'],
      ['Provider can read/censor messages', 'End-to-end encrypted via DTLS (WebRTC)'],
      ['Scales with server capacity', 'Scales with number of peers'],
      ['Server outage = service outage', 'Network survives individual node failure'],
      ['Provider logs all activity', 'No activity logging after initial handshake'],
    ]
  ),
  blankLine(),
  caption('Table 1.1 — Centralised vs Decentralised communication model'),
  blankLine(),
  diagramBox('Figure 1.1 — System Architecture Overview', [
    '                                                                      ',
    '  Browser A          Signaling Server           Browser B             ',
    '  (Node: a3f9...)    ws://localhost:8765        (Node: 7e3a...)       ',
    '      |                     |                       |                 ',
    '      |---(1) register ---->|                       |                 ',
    '      |                     |<---- (1) register ----|                 ',
    '      |<-- (2) peer_joined--|-----(2) peer_joined-->|                 ',
    '      |                     |                       |                 ',
    '      |---(3) SDP offer ---->----(3) SDP offer ---->|                 ',
    '      |<-- (4) SDP answer --<---- (4) SDP answer ---|                 ',
    '      |<-- (5) ICE cands. -><---- (5) ICE cands. -->|                 ',
    '      |                     |                       |                 ',
    '      |    SERVER NO LONGER INVOLVED AFTER STEP 5   |                 ',
    '      |                                             |                 ',
    '      |<========= (6) Direct WebRTC DataChannel ====|                 ',
    '      |    Text / Files / Typing / Kademlia RPCs    |                 ',
    '      |                                             |                 ',
  ]),
  caption('Figure 1.1 — Signaling server is only used for initial handshake; all subsequent communication is direct'),
  pageBreak(),
);

// ══════════════════════════════════════════════════════════════════════════════
// 2. IDEOLOGY
// ══════════════════════════════════════════════════════════════════════════════
children.push(
  sectionBanner('2. Ideology'),
  blankLine(),
  h1('2. Ideology'),
  body('The ideological foundation of this project is rooted in the cypherpunk movement and the original vision of the internet as a decentralised network of equal peers. Tim Berners-Lee, inventor of the World Wide Web, designed the web as a distributed system where any node could communicate with any other node without going through a central hub. The web we have today — dominated by a handful of platforms — is a departure from that original vision.'),
  blankLine(),
  body('Kademlia, published in 2002 by Petar Maymounkov and David Mazieres at New York University, operationalises this vision through mathematics. It provides a principled, provably efficient mechanism for nodes in a network to find each other, store data, and retrieve it — all without any central coordinator. This is not an idealistic fantasy: Kademlia powers BitTorrent (the largest file sharing network in history), the Ethereum blockchain peer discovery layer, and the IPFS distributed file system.'),
  blankLine(),
  h2('2.1  Core Principles'),
  bullet('Autonomy: Every node is equal. No node has special authority or privilege.'),
  bullet('Resilience: The network continues to function even when a majority of nodes fail or leave.'),
  bullet('Privacy: Communication is encrypted end-to-end. No intermediary can read the content.'),
  bullet('Openness: Any device that implements the protocol can participate without permission.'),
  bullet('Efficiency: Routing to any node in a network of N peers takes at most O(log N) hops.'),
  blankLine(),
  h2('2.2  The XOR Metric — A Mathematical Distance'),
  body('The most elegant idea in Kademlia is its choice of distance function. Rather than using geographic distance or network latency, Kademlia defines distance as the bitwise XOR (exclusive-or) of two node IDs:'),
  blankLine(),
  infoBox('XOR Distance Definition', [
    'distance(A, B) = A XOR B',
    '',
    'Example:',
    '  Node A ID:  1010 1100 0011 ...  (160-bit SHA-1 hash)',
    '  Node B ID:  1011 0100 1101 ...  (160-bit SHA-1 hash)',
    '  Distance:   0001 1000 1110 ...  (bitwise XOR)',
    '',
    'The "closer" two nodes are, the more leading bits they share.',
    'A node is at distance 0 only from itself.',
  ], C.lightBlue, C.blue),
  blankLine(),
  body('This choice has profound mathematical properties that make routing efficient and provably correct. XOR satisfies the triangle inequality, is symmetric, and is unidirectional — meaning for any node X and distance d, there is exactly one node Y such that distance(X, Y) = d. These properties guarantee that iterative lookups always converge.'),
  blankLine(),
  h2('2.3  Why This Project Matters Today'),
  body('In an era of increasing internet centralisation, surveillance capitalism, and platform censorship, tools that restore communication autonomy to individuals are more relevant than ever. This project is a working proof-of-concept that modern browsers — without any plugins, extensions, or installed software — can participate in a fully decentralised communication network.'),
  blankLine(),
  infoBox('Key Insight', [
    'After the initial WebRTC handshake (facilitated by a tiny signaling server),',
    'the server is completely uninvolved. Every message, every file, every byte',
    'travels directly and securely between peers. The server could be shut down',
    'and existing connections would continue uninterrupted.',
  ], C.tealLight, C.teal),
  blankLine(),
  pageBreak(),
);

// ══════════════════════════════════════════════════════════════════════════════
// 3. MOTIVATION
// ══════════════════════════════════════════════════════════════════════════════
children.push(
  sectionBanner('3. Motivation'),
  blankLine(),
  h1('3. Motivation'),
  body('This project was motivated by three converging interests: academic curiosity about distributed systems theory, practical frustration with the limitations of centralised communication tools, and a desire to build something that works in a real browser without requiring users to install anything.'),
  blankLine(),
  h2('3.1  Academic Motivation'),
  body('Kademlia is a foundational algorithm in computer science — covered in distributed systems courses at major universities — yet most students encounter it only as a paper or a lecture slide. The gap between understanding Kademlia theoretically and implementing it in a working system is substantial. This project bridges that gap by translating every concept into runnable JavaScript:'),
  blankLine(),
  threeColTable(
    ['Concept', 'Theory', 'This Implementation'],
    [
      ['160-bit node IDs', 'SHA-1 hash of arbitrary input', 'crypto.randomBytes(20) in browser'],
      ['XOR distance', 'Bitwise XOR of two IDs', 'xorDistance() in utils.js'],
      ['k-Buckets', '160 lists, k=20 peers each', 'RoutingTable class, 160 buckets'],
      ['LRS eviction', 'Evict least-recently-seen on bucket full', 'bucketIndex() + evictAndAdd()'],
      ['Iterative lookup', 'FIND_NODE with alpha=3 parallelism', 'lookup() in KademliaNode class'],
      ['STORE/FIND_VALUE', 'DHT key-value store', 'Planned extension'],
    ]
  ),
  blankLine(),
  caption('Table 3.1 — Mapping of Kademlia theory to implementation'),
  blankLine(),
  h2('3.2  Practical Motivation'),
  body('Existing P2P systems like BitTorrent require dedicated client software. IPFS has a steep setup curve. Matrix/Element, while federated, still depends on home servers. This project demonstrates that a zero-install, browser-native P2P communication system is achievable today, using WebRTC DataChannels which are supported in Chrome, Firefox, Safari, and Edge.'),
  blankLine(),
  h2('3.3  Engineering Motivation'),
  body('Building this system revealed a rich set of real-world engineering challenges that no textbook describes:'),
  bullet('WebRTC ICE negotiation and the mDNS candidate obfuscation problem in modern browsers'),
  bullet('Signal routing race conditions when both peers simultaneously attempt to initiate connections'),
  bullet('Infinite recursion from re-entrant close() calls in EventEmitter-based architectures'),
  bullet('SDP signalling state machine violations when duplicate answers arrive out of order'),
  bullet('DataChannel buffer management for large file transfers'),
  blankLine(),
  body('Each of these challenges required deep debugging with browser DevTools, systematic log analysis, and precise code fixes. This report documents all of them.'),
  blankLine(),
  diagramBox('Figure 3.1 — Project Motivation Matrix', [
    '                                                                      ',
    '          ACADEMIC              PRACTICAL          ENGINEERING        ',
    '          --------              ---------          -----------        ',
    '                                                                      ',
    '    Understand Kademlia     Zero-install P2P     Debug real WebRTC   ',
    '    DHT from theory to      in a browser         ICE/SDP issues      ',
    '    working code                                                      ',
    '                           No central server     Handle concurrent   ',
    '    Bridge the gap          after handshake       signaling races     ',
    '    between algorithm                                                 ',
    '    paper and system       End-to-end            Build resilient     ',
    '                           encryption by         retry + teardown    ',
    '    Demonstrate O(log N)   default via DTLS       logic              ',
    '    routing in practice                                               ',
    '                                                                      ',
  ]),
  caption('Figure 3.1 — Three dimensions of project motivation'),
  pageBreak(),
);

// ══════════════════════════════════════════════════════════════════════════════
// 4. BASIC REQUIREMENTS
// ══════════════════════════════════════════════════════════════════════════════
children.push(
  sectionBanner('4. Basic Requirements'),
  blankLine(),
  h1('4. Basic Requirements'),
  h2('4.1  Hardware Requirements'),
  twoColTable(
    ['Component', 'Minimum Requirement'],
    [
      ['CPU', 'Any modern dual-core processor (2010 or newer)'],
      ['RAM', '2 GB minimum; 4 GB recommended for development'],
      ['Network', 'Any internet connection (Wi-Fi or Ethernet); same LAN for same-machine testing'],
      ['Storage', '50 MB for project files and Node.js dependencies'],
      ['Display', 'Any monitor capable of 1024x768 or higher resolution'],
    ]
  ),
  blankLine(),
  caption('Table 4.1 — Hardware requirements'),
  blankLine(),
  h2('4.2  Software Requirements'),
  twoColTable(
    ['Software', 'Version / Notes'],
    [
      ['Node.js', 'v18.0.0 or higher (required for --watch flag and native crypto)'],
      ['npm', 'v8.0.0 or higher (bundled with Node.js)'],
      ['Web Browser', 'Chrome 80+, Firefox 75+, Edge 80+, or Safari 15+'],
      ['Operating System', 'Windows 10+, macOS 10.15+, or Ubuntu 18.04+'],
      ['ws (npm package)', 'v8.16.0 — WebSocket server for signaling'],
      ['express (npm package)', 'v4.18.2 — HTTP server for static file serving'],
    ]
  ),
  blankLine(),
  caption('Table 4.2 — Software requirements'),
  blankLine(),
  h2('4.3  Browser Configuration'),
  body('One non-default browser setting is required for same-machine testing. By default, Chrome obfuscates local IP addresses in WebRTC ICE candidates using mDNS hostnames (e.g., abc123.local instead of 192.168.1.5). This prevents same-machine peers from discovering each other.'),
  blankLine(),
  infoBox('One-Time Chrome Configuration Required', [
    'Step 1: Open a new browser tab',
    'Step 2: Navigate to: chrome://flags/#enable-webrtc-hide-local-ips-with-mdns',
    'Step 3: Change the dropdown from "Default" to "Disabled"',
    'Step 4: Click the "Relaunch" button that appears at the bottom',
    'Step 5: Hard-refresh app tabs with Ctrl+Shift+R',
    '',
    'This is a one-time setting. It does not affect browser security for normal use.',
    'Without this change, WebRTC peers on the same machine cannot see each other.',
  ], C.amberLight, C.amber),
  blankLine(),
  h2('4.4  Network Requirements'),
  body('For same-machine testing (two browser tabs on one computer):'),
  bullet('No special network configuration needed after the Chrome flag change'),
  bullet('The signaling server runs on localhost:8765'),
  blankLine(),
  body('For cross-device testing (two different computers on the same Wi-Fi network):'),
  bullet('Both devices must be on the same local area network'),
  bullet('SIGNALING_URL in app.js must be changed from localhost to the host machine\'s LAN IP'),
  bullet('The host machine\'s firewall must allow inbound connections on port 8765'),
  blankLine(),
  body('For cross-network testing (devices on different networks across the internet):'),
  bullet('A TURN server is required for NAT traversal when direct connection fails'),
  bullet('Free TURN credentials available from metered.ca or similar providers'),
  bullet('STUN servers (Google, Cloudflare) are used for public IP discovery'),
  pageBreak(),
);

// ══════════════════════════════════════════════════════════════════════════════
// 5. UNDERSTANDING DIFFERENT TERMS
// ══════════════════════════════════════════════════════════════════════════════
children.push(
  sectionBanner('5. Understanding Different Terms'),
  blankLine(),
  h1('5. Understanding Different Terms'),
  body('This section defines all technical terminology used throughout the project. Understanding these terms precisely is essential to following the architecture and implementation discussions in later sections.'),
  blankLine(),

  h2('5.1  Distributed Hash Table (DHT)'),
  body('A Distributed Hash Table is a decentralised data structure that distributes the responsibility for storing and retrieving key-value pairs across all participating nodes. Unlike a traditional hash table stored on a single machine, a DHT spreads its contents across hundreds or thousands of nodes in a network, with each node responsible for a subset of the keyspace.'),
  blankLine(),
  diagramBox('Figure 5.1 — DHT Key Distribution', [
    '                                                                      ',
    '  Key "username:alice"                                                ',
    '        |                                                             ',
    '        v  SHA-1 hash                                                 ',
    '  Key ID: a3f9c2b1d456...  (160 bits)                                 ',
    '        |                                                             ',
    '        v  Kademlia routing                                           ',
    '  Stored on: Node whose ID is numerically closest to a3f9c2b1d456... ',
    '                                                                      ',
    '  To retrieve: ANY node can find this value by routing to a3f9...    ',
    '  No central index. No central authority.                             ',
    '                                                                      ',
  ]),
  caption('Figure 5.1 — DHT routes keys to their responsible nodes'),
  blankLine(),

  h2('5.2  Kademlia'),
  body('Kademlia is a specific DHT algorithm designed by Petar Maymounkov and David Mazieres (NYU, 2002). Its key innovation over earlier DHTs (Chord, Pastry, CAN) is the use of the XOR metric as its distance function, which gives it several desirable mathematical properties: symmetric routing, guaranteed convergence, and O(log N) lookup complexity.'),
  blankLine(),
  body('Kademlia defines four remote procedure calls (RPCs):'),
  bullet('PING — Check if a node is alive and reachable'),
  bullet('FIND_NODE(targetId) — Return the k nodes closest to targetId that the responder knows about'),
  bullet('STORE(key, value) — Ask a node to store a key-value pair'),
  bullet('FIND_VALUE(key) — Return the value for key, or k closest nodes if not found locally'),
  blankLine(),

  h2('5.3  WebRTC (Web Real-Time Communication)'),
  body('WebRTC is a collection of standards and APIs built into modern web browsers that enable direct, peer-to-peer communication between browsers without requiring a plugin or server relay. It provides:'),
  twoColTable(
    ['WebRTC Component', 'Purpose in This Project'],
    [
      ['RTCPeerConnection', 'Manages the full P2P connection lifecycle (ICE, DTLS, SCTP)'],
      ['RTCDataChannel', 'Bidirectional channel for sending text and binary data between peers'],
      ['DTLS (encryption)', 'All DataChannel traffic is DTLS-encrypted by the WebRTC specification'],
      ['ICE (connectivity)', 'Discovers viable network paths between two peers'],
      ['STUN', 'Discovers a peer\'s public IP address by querying an external server'],
      ['TURN', 'Relays traffic when direct connection is impossible (symmetric NAT)'],
      ['SDP (Session Description Protocol)', 'Describes the capabilities and connection parameters of each peer'],
    ]
  ),
  blankLine(),
  caption('Table 5.1 — WebRTC components and their roles'),
  blankLine(),

  h2('5.4  ICE (Interactive Connectivity Establishment)'),
  body('ICE is the protocol WebRTC uses to find a working network path between two peers who may be behind NAT routers, firewalls, or on different networks. ICE gathers "candidates" — potential addresses through which the peer can be reached — and systematically tests them until it finds a pair that works.'),
  blankLine(),
  twoColTable(
    ['ICE Candidate Type', 'Description'],
    [
      ['host', 'The device\'s local IP address (e.g., 192.168.1.5). Works when both peers are on the same LAN.'],
      ['srflx (server reflexive)', 'The public IP address discovered via a STUN server. Works for most home networks.'],
      ['prflx (peer reflexive)', 'Discovered during connectivity checks. Usually equivalent to srflx.'],
      ['relay', 'An address on a TURN server. Used as a last resort when all direct paths fail (symmetric NAT).'],
    ]
  ),
  blankLine(),
  caption('Table 5.2 — ICE candidate types in order of preference'),
  blankLine(),

  h2('5.5  SDP Offer/Answer'),
  body('SDP (Session Description Protocol) is a text format that describes the parameters of a WebRTC session — supported codecs, ICE credentials, DTLS fingerprint, etc. The offer/answer exchange is how two peers negotiate what they are both capable of before establishing a connection:'),
  numbered('Caller creates an SDP offer describing its capabilities'),
  numbered('Offer is transmitted to the remote peer via the signaling server'),
  numbered('Answerer inspects the offer and creates an SDP answer'),
  numbered('Answer is transmitted back via the signaling server'),
  numbered('Both peers have enough information to begin ICE negotiation'),
  blankLine(),

  h2('5.6  Signaling Server'),
  body('A signaling server is a temporary rendezvous point that helps two peers who have never communicated before exchange their SDP offers/answers and ICE candidates. It is not a relay — it only carries the small control messages needed to establish the WebRTC connection. Once the DataChannel opens, the signaling server is no longer involved.'),
  blankLine(),
  infoBox('Important Distinction', [
    'Signaling server  =  like a telephone operator connecting a call',
    'TURN server       =  like a relay station forwarding call audio',
    '',
    'The signaling server only handles ~10 small JSON messages per connection.',
    'After that, it is idle. The TURN server (if needed) relays actual data.',
    'This project\'s signaling server is ~100 lines of Node.js.',
  ], C.tealLight, C.teal),
  blankLine(),

  h2('5.7  k-Bucket'),
  body('A k-bucket is one of the 160 lists that make up a Kademlia routing table. Each bucket corresponds to a specific XOR distance range from the local node. Bucket i holds nodes whose IDs differ from the local node\'s ID at bit position i and agree on all higher bits. Each bucket holds at most k=20 nodes, sorted by last-seen time (most recently seen at the tail).'),
  blankLine(),
  diagramBox('Figure 5.2 — k-Bucket Structure', [
    '  Bit   Bucket   Distance Range         Max Nodes                     ',
    '  ---   ------   ---------------        ---------                     ',
    '  159     159    [2^159, 2^160)              20  (very far peers)      ',
    '  158     158    [2^158, 2^159)              20                        ',
    '  ...     ...    ...                        ...                        ',
    '    2       2    [2^2,   2^3  )              20                        ',
    '    1       1    [2^1,   2^2  )              20                        ',
    '    0       0    [2^0,   2^1  )              20  (very close peers)    ',
    '                                                                       ',
    '  Total: 160 buckets x 20 nodes = up to 3,200 known peers             ',
  ]),
  caption('Figure 5.2 — Each k-bucket covers a distinct region of the ID space'),
  blankLine(),

  h2('5.8  mDNS (Multicast DNS)'),
  body('mDNS is a protocol that allows devices on a local network to discover each other by hostname without a central DNS server. Chrome uses mDNS to obfuscate local IP addresses in WebRTC ICE candidates — instead of exposing 192.168.1.5, it generates a random hostname like abc123.local. While this protects user privacy from malicious websites, it also prevents same-machine WebRTC connections in development, requiring the Chrome flag workaround described in Section 4.'),
  pageBreak(),
);

// ══════════════════════════════════════════════════════════════════════════════
// 6. WORKFLOW
// ══════════════════════════════════════════════════════════════════════════════
children.push(
  sectionBanner('6. Workflow'),
  blankLine(),
  h1('6. Workflow'),
  body('This section describes the end-to-end workflow of the system, from the moment a user opens a browser tab to the moment two peers are exchanging messages directly. The workflow is divided into five phases.'),
  blankLine(),

  h2('6.1  Phase 1 — Node ID Generation'),
  body('When a user opens the application in a browser tab, the first action is to generate a unique 160-bit node ID. This ID is the node\'s identity in the Kademlia network. It is generated using the browser\'s built-in cryptographic random number generator:'),
  blankLine(),
  diagramBox('Figure 6.1 — Node ID Generation', [
    '  Browser opens http://localhost:8765                                  ',
    '       |                                                               ',
    '       v                                                               ',
    '  Check sessionStorage for existing node ID                           ',
    '       |                                                               ',
    '       |-- Not found ---> crypto.getRandomValues(new Uint8Array(20))  ',
    '       |                  Generate 20 random bytes (160 bits)         ',
    '       |                  Convert to 40-character hex string          ',
    '       |                  Store in sessionStorage                     ',
    '       |                       |                                      ',
    '       |-- Found ---------->   |                                      ',
    '       v                       v                                      ',
    '  nodeId = "a3f9c2b1d456789012345678901234567890abcd"  (example)      ',
    '                                                                       ',
    '  Each browser tab gets a unique node ID.                              ',
    '  ID persists within a session but resets on tab close.               ',
  ]),
  caption('Figure 6.1 — Node ID generation flow'),
  blankLine(),

  h2('6.2  Phase 2 — Signaling Server Connection'),
  body('With a node ID generated, the browser opens a WebSocket connection to the signaling server. The signaling server is a minimal Node.js application running on port 8765. It uses the ws library for WebSocket support and Express for HTTP.'),
  blankLine(),
  diagramBox('Figure 6.2 — Signaling Registration', [
    '  Browser                          Signaling Server                   ',
    '  (Tab 1: a3f9...)                 (ws://localhost:8765)              ',
    '       |                                  |                           ',
    '       |--- WebSocket connect() --------->|                           ',
    '       |--- { type:"register",            |                           ',
    '       |    nodeId:"a3f9..." } ---------->|  peers.set("a3f9...", ws) ',
    '       |                                  |                           ',
    '       |<-- { type:"registered",          |                           ',
    '       |    nodeId:"a3f9..." } -----------|                           ',
    '       |                                  |                           ',
    '       |--- { type:"peers" } ------------>|                           ',
    '       |<-- { type:"peers",               |                           ',
    '       |    list:[{nodeId, address}] } ---|  Returns current peers    ',
    '       |                                  |                           ',
  ]),
  caption('Figure 6.2 — Signaling server registration sequence'),
  blankLine(),

  h2('6.3  Phase 3 — Peer Discovery'),
  body('When a second browser tab opens and registers with the signaling server, both tabs are notified. The higher-ID node (determined by lexicographic comparison of the 40-character hex IDs) initiates the WebRTC connection. This asymmetry prevents both sides from simultaneously sending offers to each other, which would create a race condition.'),
  blankLine(),
  diagramBox('Figure 6.3 — Peer Discovery Logic', [
    '  Tab 1 (ID: "cc7c...")              Signaling Server                 ',
    '  Tab 2 (ID: "3942...")                                               ',
    '                                                                       ',
    '  Tab 2 opens and registers:                                          ',
    '  Server sends peer_joined to Tab 1:                                  ',
    '  { type:"peer_joined", nodeId:"3942..." }                            ',
    '                                                                       ',
    '  Tab 1 checks: "cc7c" > "3942" ?  YES                                ',
    '  Therefore Tab 1 initiates the WebRTC connection.                    ',
    '  Tab 2 will be the answerer.                                         ',
    '                                                                       ',
    '  Rule: Higher-ID node always initiates.                              ',
    '  This prevents double-offer race conditions.                         ',
  ]),
  caption('Figure 6.3 — Deterministic initiator selection prevents race conditions'),
  blankLine(),

  h2('6.4  Phase 4 — WebRTC Handshake (SDP + ICE)'),
  body('The WebRTC handshake is the most complex part of the workflow. It involves two interleaved processes: SDP negotiation (agreeing on session parameters) and ICE negotiation (finding a working network path).'),
  blankLine(),
  diagramBox('Figure 6.4 — Complete WebRTC Handshake', [
    '  Tab 1 (Caller)         Signaling Server        Tab 2 (Answerer)     ',
    '       |                       |                       |              ',
    '  createOffer()                |                       |              ',
    '  setLocalDescription(offer)   |                       |              ',
    '       |---{type:signal,       |                       |              ',
    '       |   payload:{type:offer,|                       |              ',
    '       |   sdp:...}} -------->.|-------- forward ----->|              ',
    '       |                       |             setRemoteDescription()   ',
    '       |                       |             createAnswer()           ',
    '       |                       |             setLocalDescription()    ',
    '       |                       |<-{payload:{type:answer,sdp:...}}-----|',
    '       |<----- forward --------|                       |              ',
    '  setRemoteDescription(answer) |                       |              ',
    '       |                       |                       |              ',
    '  ICE gathering begins on both sides simultaneously                   ',
    '       |                       |                       |              ',
    '       |---{payload:{type:ice, candidate:...}}-------->|              ',
    '       |<--{payload:{type:ice, candidate:...}}---------|              ',
    '       |      (multiple ICE candidates exchanged)      |              ',
    '       |                       |                       |              ',
    '  ICE finds working candidate pair                                    ',
    '  DTLS handshake (automatic, encrypted)                               ',
    '  SCTP (DataChannel transport) established                            ',
    '       |                                               |              ',
    '       |<====== RTCDataChannel OPEN ==================>|              ',
  ]),
  caption('Figure 6.4 — Full WebRTC offer/answer and ICE exchange sequence'),
  blankLine(),

  h2('6.5  Phase 5 — Kademlia Routing Table Update'),
  body('Once the DataChannel opens, the peer discovery module updates the Kademlia routing table, adding the new peer to the appropriate k-bucket based on the XOR distance between the two node IDs. This enables future Kademlia operations (FIND_NODE, STORE, FIND_VALUE) to route through these direct P2P connections instead of through the signaling server.'),
  blankLine(),
  body('The UI is updated: the new peer appears in the sidebar, the status dot turns green, and a system message is shown in the chat window. The system is now ready for P2P communication.'),
  pageBreak(),
);

// ══════════════════════════════════════════════════════════════════════════════
// 7. MESSAGE AND FILE TRANSFER
// ══════════════════════════════════════════════════════════════════════════════
children.push(
  sectionBanner('7. Message and File Transfer'),
  blankLine(),
  h1('7. How a Message and File is Transferred from One Peer to Another'),
  body('All data transfer in this system happens over RTCDataChannel — a bidirectional, ordered, reliable channel layered on top of SCTP (Stream Control Transmission Protocol) within the WebRTC stack. Both text messages and files use the same channel, distinguished by a JSON envelope with a type field.'),
  blankLine(),

  h2('7.1  The Message Protocol'),
  body('Every piece of data sent over the DataChannel is a JSON string with the following envelope structure:'),
  blankLine(),
  diagramBox('Figure 7.1 — Message Protocol Envelope', [
    '  Text Message:                                                        ',
    '  {                                                                    ',
    '    "type":  "text",                                                   ',
    '    "id":    "k7x9d2f1" + timestamp_base36,   // unique message ID    ',
    '    "from":  "a3f9c2b1d456...",               // sender node ID       ',
    '    "body":  "Hello, world!",                 // message content      ',
    '    "ts":    1701234567890                    // Unix timestamp ms    ',
    '  }                                                                    ',
    '                                                                       ',
    '  Typing Indicator:                                                    ',
    '  {                                                                    ',
    '    "type": "typing",                                                  ',
    '    "from": "a3f9c2b1d456..."                                         ',
    '  }                                                                    ',
  ]),
  caption('Figure 7.1 — JSON envelope used for all DataChannel messages'),
  blankLine(),

  h2('7.2  Text Message Flow — Step by Step'),
  body('The following describes exactly what happens when a user types "Hello!" and presses Enter:'),
  blankLine(),
  numbered('User presses Enter in the textarea'),
  numbered('sendMessage() is called in app.js'),
  numbered('The active peer or broadcast mode is checked'),
  numbered('DataChannelManager.sendText("Hello!") is called'),
  numbered('A JSON envelope is constructed with a unique ID and timestamp'),
  numbered('channel.send(JSON.stringify(envelope)) is called — this is the native RTCDataChannel send method'),
  numbered('The browser\'s WebRTC stack serialises the string to bytes'),
  numbered('DTLS encrypts the bytes — the signaling server cannot see this data'),
  numbered('SCTP delivers the bytes reliably, in order, to the remote peer'),
  numbered('The remote peer\'s RTCDataChannel fires an onmessage event'),
  numbered('DataChannelManager._handleMessage() parses the JSON'),
  numbered('The "text" event is emitted with { id, from, body, ts }'),
  numbered('app.js appendMessage() renders the bubble in the chat window'),
  blankLine(),
  diagramBox('Figure 7.2 — Text Message Transfer', [
    '  Tab 1 (Sender)                               Tab 2 (Receiver)       ',
    '       |                                              |               ',
    '  User types "Hello!"                                |               ',
    '  sendMessage()                                       |               ',
    '  DataChannelManager.sendText("Hello!")              |               ',
    '  JSON.stringify({type:"text", body:"Hello!", ...})  |               ',
    '  channel.send(jsonString)                           |               ',
    '       |                                              |               ',
    '       |== DTLS encrypted bytes over SCTP ===========>|               ',
    '       |   (No server involved — direct path)         |               ',
    '                                                      |               ',
    '                                              onmessage event fires   ',
    '                                              JSON.parse(event.data)  ',
    '                                              emit("text", {body,...}) ',
    '                                              appendMessage() renders  ',
    '                                              bubble in chat window   ',
  ]),
  caption('Figure 7.2 — Direct peer-to-peer text message flow'),
  blankLine(),

  h2('7.3  File Transfer — The Chunking Protocol'),
  body('Files cannot be sent as a single DataChannel message because browsers enforce a maximum message size (typically 256 KB, but varies by implementation). For reliable cross-browser compatibility, this system chunks all files at 16 KB per chunk, regardless of the file type or size.'),
  blankLine(),
  body('The file transfer protocol uses four message types:'),
  blankLine(),
  diagramBox('Figure 7.3 — File Transfer Protocol Messages', [
    '  1. file_start:                                                       ',
    '  { type:"file_start", id:"abc123", from:"a3f9...",                   ',
    '    name:"photo.jpg", size:524288, mimeType:"image/jpeg",             ',
    '    totalChunks:32 }                                                  ',
    '                                                                       ',
    '  2. file_chunk (repeated for each chunk):                            ',
    '  { type:"file_chunk", id:"abc123", index:0, data:"<base64>" }        ',
    '  { type:"file_chunk", id:"abc123", index:1, data:"<base64>" }        ',
    '  ... (32 chunks for a 512 KB file at 16 KB per chunk)               ',
    '                                                                       ',
    '  3. file_end:                                                         ',
    '  { type:"file_end", id:"abc123" }                                    ',
    '                                                                       ',
    '  4. file_abort (if cancelled):                                        ',
    '  { type:"file_abort", id:"abc123", reason:"User cancelled" }         ',
  ]),
  caption('Figure 7.3 — Four-message file transfer protocol'),
  blankLine(),

  h2('7.4  File Transfer Flow — Complete Sequence'),
  blankLine(),
  diagramBox('Figure 7.4 — Complete File Transfer Sequence', [
    '  Sender                                        Receiver              ',
    '       |                                              |               ',
    '  User clicks paperclip button                        |               ',
    '  File picker opens, user selects "photo.jpg"        |               ',
    '  onFileSelected() reads File object                  |               ',
    '  DataChannelManager.sendFile(file)                  |               ',
    '       |                                              |               ',
    '       |--- { type:"file_start",                      |               ',
    '       |     name:"photo.jpg", size:524288,           |               ',
    '       |     totalChunks:32 } ======================>|               ',
    '       |                                    appendFileProgress()      ',
    '       |                                    progress bar appears      ',
    '       |                                              |               ',
    '  Read chunk[0] from File.slice(0, 16384)            |               ',
    '  Convert to base64 via FileReader                   |               ',
    '       |--- { type:"file_chunk", index:0,            |               ',
    '       |     data:"<16KB base64>" } ================>|               ',
    '       |                                    chunks[0] = data          ',
    '       |                                    progress: 3%              ',
    '       |                                              |               ',
    '  [... repeat for chunks 1 through 31 ...]            |               ',
    '       |                                              |               ',
    '       |--- { type:"file_end", id:"abc123" } =======>|               ',
    '                                                      |               ',
    '                                            Reassemble all chunks     ',
    '                                            new Blob([...chunks])     ',
    '                                            URL.createObjectURL(blob) ',
    '                                            Render download link      ',
  ]),
  caption('Figure 7.4 — File chunking, transmission, and reassembly'),
  blankLine(),

  h2('7.5  File Reassembly'),
  body('On the receiver\'s side, chunks arrive as base64-encoded strings and are stored in a sparse array indexed by chunk number. This design handles out-of-order delivery correctly — if chunk[3] arrives before chunk[2], it is stored at index 3 and the array is sorted when all chunks have arrived.'),
  blankLine(),
  body('Once the file_end message arrives, the receiver reconstructs the file:'),
  numbered('All base64 chunks are decoded to Uint8Array byte arrays using atob()'),
  numbered('The arrays are assembled into a Blob with the original MIME type'),
  numbered('URL.createObjectURL(blob) generates a local download URL'),
  numbered('A file bubble is rendered in the chat with a "Save" link'),
  blankLine(),

  h2('7.6  Broadcast Mode'),
  body('When no specific peer is selected and the user selects "Broadcast all" in the sidebar, messages and files are sent to every connected peer simultaneously. The DataChannelManager.sendText() and sendFile() methods are called once per connection. Each peer receives the message independently through its own private DataChannel.'),
  blankLine(),
  infoBox('Security Note', [
    'All DataChannel traffic is DTLS-encrypted by the WebRTC specification.',
    'This is mandatory — there is no way to disable it. Even if someone',
    'intercepted the packets between two peers, they would see only encrypted',
    'ciphertext. The signaling server never sees message content at any point.',
  ], C.greenLight, C.green),
  pageBreak(),
);

// ══════════════════════════════════════════════════════════════════════════════
// 8. LIMITATIONS
// ══════════════════════════════════════════════════════════════════════════════
children.push(
  sectionBanner('8. Limitations'),
  blankLine(),
  h1('8. Limitations'),
  body('This project is a working proof-of-concept that demonstrates the core principles of Kademlia-inspired P2P communication. However, it has several limitations that would need to be addressed before it could be deployed as a production system.'),
  blankLine(),

  h2('8.1  Technical Limitations'),
  blankLine(),
  twoColTable(
    ['Limitation', 'Description and Impact'],
    [
      ['No TURN server by default', 'When both peers are behind symmetric NAT (common on corporate networks and mobile hotspots), direct connection fails. A TURN relay server is needed. The code supports it but credentials must be configured manually.'],
      ['mDNS obfuscation', 'Chrome hides local IPs by default, requiring a one-time manual Chrome flag change for same-machine testing. This cannot be controlled programmatically.'],
      ['No persistent identity', 'Node IDs are generated randomly each session. There is no way to have a persistent identity or find a specific person by name without a separate directory service built on the DHT.'],
      ['File transfer backpressure', 'Large files (>100MB) can overflow the DataChannel buffer because chunks are sent without waiting for acknowledgement. A production implementation needs bufferedAmountLowThreshold backpressure.'],
      ['No message history', 'Messages are not persisted. Closing a browser tab loses all conversation history. IndexedDB could be used for local persistence.'],
      ['Max 20 peers (k-bucket limit)', 'The system is capped at MAX_CONNECTIONS=20 simultaneous WebRTC connections. Kademlia allows more, but each WebRTC connection has setup overhead.'],
    ]
  ),
  blankLine(),
  caption('Table 8.1 — Technical limitations'),
  blankLine(),

  h2('8.2  Security Limitations'),
  twoColTable(
    ['Limitation', 'Description'],
    [
      ['No Sybil resistance', 'Node IDs are self-generated. A malicious actor could generate many IDs close to a target to control a region of the keyspace (Sybil attack). Production systems derive IDs from public keys.'],
      ['Signaling server trust', 'The signaling server sees node IDs and can observe which nodes connect to which. It cannot see message content, but metadata is visible.'],
      ['No input sanitisation', 'While HTML is escaped in the chat display, the application does not validate received files for malware. Users should be warned before opening received files.'],
      ['No authentication', 'There is no way to verify that a peer claiming to have a certain node ID actually controls that ID. Public-key cryptography would address this.'],
    ]
  ),
  blankLine(),
  caption('Table 8.2 — Security limitations'),
  blankLine(),

  h2('8.3  Scalability Limitations'),
  body('The current implementation is designed for small networks of 2–20 peers. Scaling to hundreds of peers would require:'),
  bullet('Lazy WebRTC connection establishment — only connect to the closest k peers, not all of them'),
  bullet('Kademlia-based message routing — instead of direct DataChannel connections to all peers, route messages through multiple hops'),
  bullet('DHT-based presence — store peer availability in the DHT rather than relying on the signaling server\'s peer list'),
  blankLine(),

  h2('8.4  Bugs Encountered and Fixed'),
  body('The development process involved several non-trivial bugs, all of which were diagnosed and resolved:'),
  blankLine(),
  threeColTable(
    ['Bug', 'Root Cause', 'Fix Applied'],
    [
      ['Cannot set remote answer in state stable', 'SDP signals sent with inconsistent wrapping — some sent payload directly, others nested under payload key', 'Standardised all signaling.send() calls to use { type:"signal", payload:{...} } envelope'],
      ['too much recursion (infinite loop)', 'pc.close() fired onconnectionstatechange("closed") which called emit("close") which called _teardown() which called pc.close() again', 'Added _closing guard flag; null all event handlers before calling pc.close(); deleted from map before closing'],
      ['answer/ice dropping — no pc found', 'PeerConnection was registered in the map only on DataChannel open, not before the offer was sent — so answer arrived before the pc entry existed', 'Register pc in map immediately before sending offer; register before accepting offer too'],
      ['ICE fast-fail killing handshake', 'ICE "failed" state rejected the offer promise immediately when mDNS candidates were the only type, before the answer had time to arrive', 'Removed ICE failed fast-path; only resolve on DataChannel open; only reject on 60s timeout'],
      ['Identifier already declared', 'EventEmitter class defined at top level in all three JS files; collided when all loaded in same browser page', 'Wrapped all three files in IIFEs; exported only window.ClassName'],
      ['404 on p2p-core scripts', 'Express static middleware served only frontend/ folder; script tags referenced ../p2p-core/ which was outside the served root', 'Added app.use("/p2p-core", express.static(...)) line to server.js'],
    ]
  ),
  blankLine(),
  caption('Table 8.3 — Bugs encountered, root causes, and fixes'),
  pageBreak(),
);

// ══════════════════════════════════════════════════════════════════════════════
// 9. CONCLUSION
// ══════════════════════════════════════════════════════════════════════════════
children.push(
  sectionBanner('9. Conclusion'),
  blankLine(),
  h1('9. Conclusion'),
  body('This project successfully demonstrates that a fully decentralised, peer-to-peer communication system can be built using only modern browser APIs and a minimal signaling server. The system implements the core mathematical machinery of Kademlia — 160-bit XOR-metric node IDs, k-bucket routing tables, and iterative lookup — and layers WebRTC DataChannels on top to provide encrypted, direct peer-to-peer message and file transfer.'),
  blankLine(),
  body('The project was technically challenging in ways that went well beyond the textbook description of Kademlia. Real-world issues such as browser mDNS obfuscation, WebRTC signaling state machine violations, re-entrant event emitter loops, and concurrent signaling race conditions required systematic debugging, deep understanding of the WebRTC specification, and careful architectural thinking about when to register state and how to handle teardown safely.'),
  blankLine(),
  h2('9.1  What Was Achieved'),
  bullet('A working P2P chat and file transfer application running entirely in the browser'),
  bullet('Full implementation of the Kademlia XOR distance metric, k-bucket routing table, and LRS eviction policy'),
  bullet('A WebRTC connection layer with proper signaling state guards, ICE candidate buffering, and retry logic'),
  bullet('A 16 KB chunked file transfer protocol with base64 encoding, progress tracking, and Blob reassembly'),
  bullet('A clean dark-mode UI with broadcast/direct messaging, typing indicators, and file download links'),
  bullet('Complete documentation of all bugs encountered, with root cause analysis and fixes'),
  blankLine(),
  h2('9.2  Key Learnings'),
  body('The most important lessons from this project were:'),
  blankLine(),
  numbered('Distributed systems theory and distributed systems implementation are very different disciplines. Kademlia on paper is elegant. Kademlia in a browser, with WebRTC, with race conditions, with browser security restrictions, requires significantly more engineering.'),
  numbered('WebRTC is a complex protocol stack. Understanding the SDP offer/answer state machine, ICE candidate lifecycle, and the relationship between signaling state and connection state is essential to debugging P2P applications.'),
  numbered('Defensive coding — checking state before operations, using guard flags to prevent re-entrance, deleting state before closing to prevent loops — is not premature optimisation. It is required for correct concurrent code.'),
  numbered('Browser security features (mDNS obfuscation, origin restrictions) exist for good reasons but create friction for developers. Understanding why each restriction exists makes it easier to work around it correctly.'),
  blankLine(),
  h2('9.3  Future Work'),
  body('Several extensions would make this system production-ready:'),
  bullet('Persistent cryptographic identity using public-key derived node IDs stored in IndexedDB'),
  bullet('DHT-based username directory using STORE/FIND_VALUE RPCs'),
  bullet('Multi-hop message routing for larger networks where direct connections to all peers are impractical'),
  bullet('TURN server integration with automatic credential management'),
  bullet('DataChannel backpressure for reliable large-file transfer'),
  bullet('Message persistence in IndexedDB'),
  bullet('Mobile browser support (iOS Safari, Android Chrome)'),
  blankLine(),
  infoBox('Final Remark', [
    'The web was designed as a peer-to-peer medium. This project is a reminder',
    'that the technology to reclaim that original vision — private, direct,',
    'server-free communication between equals — exists today, in every modern',
    'browser, waiting to be used.',
  ], C.lightBlue, C.navy),
  pageBreak(),
);

// ══════════════════════════════════════════════════════════════════════════════
// 10. BIBLIOGRAPHY
// ══════════════════════════════════════════════════════════════════════════════
children.push(
  sectionBanner('10. Bibliography'),
  blankLine(),
  h1('10. Bibliography'),
  blankLine(),
  h2('Primary Sources — Research Papers'),
  blankLine(),
);

const references = [
  ['[1]', 'P. Maymounkov and D. Mazieres', '"Kademlia: A Peer-to-peer Information System Based on the XOR Metric"', 'Proceedings of the 1st International Workshop on Peer-to-Peer Systems (IPTPS), 2002.', 'https://pdos.csail.mit.edu/~petar/papers/maymounkov-kademlia-lncs.pdf'],
  ['[2]', 'I. Stoica, R. Morris, D. Karger, M. F. Kaashoek, H. Balakrishnan', '"Chord: A Scalable Peer-to-peer Lookup Service for Internet Applications"', 'ACM SIGCOMM, 2001.', 'https://pdos.csail.mit.edu/papers/chord:sigcomm01/chord_sigcomm.pdf'],
  ['[3]', 'A. Rowstron and P. Druschel', '"Pastry: Scalable, Decentralized Object Location, and Routing for Large-Scale Peer-to-Peer Systems"', 'Middleware 2001, LNCS 2218, pp. 329-350, 2001.', ''],
  ['[4]', 'S. Ratnasamy, P. Francis, M. Handley, R. Karp, S. Shenker', '"A Scalable Content-Addressable Network"', 'ACM SIGCOMM, 2001.', ''],
];
references.forEach(([num, authors, title, venue, url]) => {
  children.push(
    new Paragraph({
      children: [
        new TextRun({ text: num + '  ', bold: true, size: 20, font: 'Arial', color: C.blue }),
        new TextRun({ text: authors + '. ', size: 20, font: 'Arial', color: C.gray }),
        new TextRun({ text: title + '. ', size: 20, font: 'Arial', italics: true, color: C.gray }),
        new TextRun({ text: venue, size: 20, font: 'Arial', color: C.gray }),
        ...(url ? [new TextRun({ text: '  ' + url, size: 18, font: 'Arial', color: C.blue })] : []),
      ],
      spacing: { before: 60, after: 120 },
      indent: { left: 360, hanging: 360 },
    })
  );
});

children.push(
  blankLine(),
  h2('WebRTC and Browser Standards'),
  blankLine(),
);

const webRefs = [
  ['[5]', 'W3C / IETF', '"WebRTC 1.0: Real-Time Communication Between Browsers"', 'W3C Recommendation, January 2021.', 'https://www.w3.org/TR/webrtc/'],
  ['[6]', 'IETF RFC 8445', '"Interactive Connectivity Establishment (ICE): A Protocol for Network Address Translator (NAT) Traversal"', 'IETF, July 2018.', 'https://tools.ietf.org/html/rfc8445'],
  ['[7]', 'IETF RFC 4566', '"SDP: Session Description Protocol"', 'IETF, July 2006.', 'https://tools.ietf.org/html/rfc4566'],
  ['[8]', 'IETF RFC 5389', '"Session Traversal Utilities for NAT (STUN)"', 'IETF, October 2008.', 'https://tools.ietf.org/html/rfc5389'],
  ['[9]', 'IETF RFC 5766', '"Traversal Using Relays around NAT (TURN)"', 'IETF, April 2010.', 'https://tools.ietf.org/html/rfc5766'],
];
webRefs.forEach(([num, authors, title, venue, url]) => {
  children.push(
    new Paragraph({
      children: [
        new TextRun({ text: num + '  ', bold: true, size: 20, font: 'Arial', color: C.blue }),
        new TextRun({ text: authors + '. ', size: 20, font: 'Arial', color: C.gray }),
        new TextRun({ text: title + '. ', size: 20, font: 'Arial', italics: true, color: C.gray }),
        new TextRun({ text: venue, size: 20, font: 'Arial', color: C.gray }),
        new TextRun({ text: '  ' + url, size: 18, font: 'Arial', color: C.blue }),
      ],
      spacing: { before: 60, after: 120 },
      indent: { left: 360, hanging: 360 },
    })
  );
});

children.push(
  blankLine(),
  h2('Books and Online Resources'),
  blankLine(),
);

const bookRefs = [
  ['[10]', 'M. van Steen and A.S. Tanenbaum', '"Distributed Systems"', '3rd Edition, 2017. Available at: https://www.distributed-systems.net'],
  ['[11]', 'Mozilla Developer Network', '"WebRTC API Documentation"', 'https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API'],
  ['[12]', 'Google Chrome Team', '"WebRTC Samples and Code Labs"', 'https://webrtc.github.io/samples/'],
  ['[13]', 'Ilya Grigorik', '"High Performance Browser Networking — Chapter 3: WebRTC"', "O'Reilly Media, 2013. Online: https://hpbn.co/webrtc/"],
  ['[14]', 'BitTorrent Enhancement Proposals', '"BEP 5: DHT Protocol (Kademlia-based)"', 'BitTorrent.org. https://www.bittorrent.org/beps/bep_0005.html'],
  ['[15]', 'IPFS Documentation', '"Kademlia DHT in libp2p"', 'https://docs.libp2p.io/concepts/routing/kademlia/'],
];
bookRefs.forEach(([num, authors, title, venue]) => {
  children.push(
    new Paragraph({
      children: [
        new TextRun({ text: num + '  ', bold: true, size: 20, font: 'Arial', color: C.blue }),
        new TextRun({ text: authors + '. ', size: 20, font: 'Arial', color: C.gray }),
        new TextRun({ text: title + '. ', size: 20, font: 'Arial', italics: true, color: C.gray }),
        new TextRun({ text: venue, size: 20, font: 'Arial', color: C.blue }),
      ],
      spacing: { before: 60, after: 120 },
      indent: { left: 360, hanging: 360 },
    })
  );
});

children.push(
  blankLine(),
  blankLine(),
  new Paragraph({
    children: [new TextRun({ text: '— End of Report —', size: 22, italics: true, color: C.gray, font: 'Arial' })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 480, after: 0 },
  }),
);

// ─── Build Document ───────────────────────────────────────────────────────────
const doc = new Document({
  styles: {
    default: { document: { run: { font: 'Arial', size: 22 } } },
    paragraphStyles: [
      {
        id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 36, bold: true, font: 'Arial', color: C.navy },
        paragraph: { spacing: { before: 360, after: 180 }, outlineLevel: 0 },
      },
      {
        id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 28, bold: true, font: 'Arial', color: C.blue },
        paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 1 },
      },
      {
        id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 24, bold: true, font: 'Arial', color: C.teal },
        paragraph: { spacing: { before: 180, after: 80 }, outlineLevel: 2 },
      },
    ],
  },
  numbering: {
    config: [
      {
        reference: 'bullets',
        levels: [{
          level: 0, format: LevelFormat.BULLET, text: '\u2022', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } },
        }, {
          level: 1, format: LevelFormat.BULLET, text: '\u25E6', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 1080, hanging: 360 } } },
        }],
      },
      {
        reference: 'numbers',
        levels: [{
          level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } },
        }],
      },
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1440, right: 1260, bottom: 1440, left: 1260 },
      },
    },
    headers: {
      default: new Header({
        children: [
          new Paragraph({
            children: [
              new TextRun({ text: 'Kademlia P2P Communication System — Technical Report', size: 18, font: 'Arial', color: C.gray }),
              new TextRun({ text: '\t', size: 18 }),
              new TextRun({ text: 'Page ', size: 18, font: 'Arial', color: C.gray }),
              PageNumber.CURRENT,
            ],
            tabStops: [{ type: TabStopType.RIGHT, position: 9360 }],
            border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: C.blue, space: 1 } },
            spacing: { before: 0, after: 120 },
          }),
        ],
      }),
    },
    children,
  }],
});

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(require('path').join(__dirname, 'report.docx'), buf);
  console.log('Report generated successfully.');
});
