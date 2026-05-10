// WARNING: Using a Discord user token (selfbot) violates Discord ToS.
// Your account may be banned. Use at your own risk.

const { WebSocket, WebSocketServer } = require('ws');
const fs = require('fs');

const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));

if (!config.token || config.token === 'your-discord-user-token-here') {
  console.error('[!] Set your token in config.json first.');
  process.exit(1);
}

const codeRegex = new RegExp(config.codePattern || 'LBOX-[A-Z0-9]{18}', 'g');
const channelIds = new Set(config.channelIds || []);
const PORT = config.port || 3847;
const BUFFER_MS = 500;

let codeBuffer = [];
let bufferTimer = null;

function bufferCode(code) {
  if (!codeBuffer.includes(code)) codeBuffer.push(code);
  clearTimeout(bufferTimer);
  bufferTimer = setTimeout(() => {
    const batch = codeBuffer.splice(0);
    for (let i = batch.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [batch[i], batch[j]] = [batch[j], batch[i]];
    }
    console.log(`[+] Sending ${batch.length} shuffled codes`);
    broadcast(batch);
  }, BUFFER_MS);
}

// --- WebSocket server for the Chrome extension ---
const wss = new WebSocketServer({ port: PORT });
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(`[WS] Extension connected (${clients.size} client(s))`);
  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[WS] Extension disconnected (${clients.size} client(s))`);
  });
});

wss.on('listening', () => console.log(`[WS] Server listening on ws://localhost:${PORT}`));

function broadcast(codes) {
  const msg = JSON.stringify({ type: 'CODES', codes });
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

// --- Minimal Discord Gateway client ---
const GATEWAY = 'wss://gateway.discord.gg/?v=10&encoding=json';

function connectGateway() {
  let heartbeatTimer = null;
  let sequence = null;

  const gw = new WebSocket(GATEWAY);

  gw.on('message', (raw) => {
    const { op, d, s, t } = JSON.parse(raw);
    if (s !== null) sequence = s;

    if (op === 10) {
      // HELLO — start heartbeat and identify
      heartbeatTimer = setInterval(() => {
        gw.send(JSON.stringify({ op: 1, d: sequence }));
      }, d.heartbeat_interval);

      gw.send(JSON.stringify({
        op: 2,
        d: {
          token: config.token,
          intents: 512, // GUILD_MESSAGES
          properties: { os: 'windows', browser: 'Chrome', device: '' },
        },
      }));
    } else if (op === 0) {
      if (t === 'READY') {
        console.log(`[Discord] Logged in as ${d.user.username}#${d.user.discriminator}`);
        console.log(`[Discord] Watching ${channelIds.size} channel(s): ${[...channelIds].join(', ')}`);
      } else if (t === 'MESSAGE_CREATE') {
        if (!channelIds.has(d.channel_id)) return;
        const matches = d.content.match(codeRegex);
        if (!matches) return;
        for (const code of matches) bufferCode(code);
      }
    } else if (op === 7) {
      // Reconnect requested
      gw.close();
    } else if (op === 9) {
      console.error('[Discord] Invalid session — check your token.');
      process.exit(1);
    }
  });

  gw.on('close', () => {
    clearInterval(heartbeatTimer);
    console.log('[Discord] Disconnected, reconnecting in 5s...');
    setTimeout(connectGateway, 5000);
  });

  gw.on('error', (err) => {
    console.error('[Discord] Gateway error:', err.message);
  });
}

connectGateway();
