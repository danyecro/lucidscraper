const PORT = 3847;
let ws = null;

chrome.alarms.create('keepalive', { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener(() => {});

function updateStatus(status) {
  chrome.storage.local.set({ bridgeStatus: status });
}

function connect() {
  ws = new WebSocket(`ws://localhost:${PORT}`);

  ws.onopen = () => {
    console.log('[Bridge] Connected');
    updateStatus('connected');
  };

  ws.onmessage = async (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'CODES' && Array.isArray(msg.codes) && msg.codes.length > 0) {
        console.log('[Bridge] Received', msg.codes.length, 'codes — writing to storage');
        await chrome.storage.local.set({ bridgeQueue: msg.codes });
      }
    } catch (e) {
      console.error('[Bridge] onmessage error:', e);
    }
  };

  ws.onclose = () => {
    updateStatus('disconnected');
    setTimeout(connect, 3000);
  };

  ws.onerror = (e) => {
    console.error('[Bridge] WS error:', e.message);
    ws.close();
  };
}

connect();
