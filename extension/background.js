const DEFAULT_SERVER = "ws://127.0.0.1:8765/ws";

let socket = null;
let connecting = false;
let state = {
  connected: false,
  connecting: false,
  server: DEFAULT_SERVER,
  lastResult: null,
  pending: 0
};

const requests = new Map();

async function loadSettings() {
  return chrome.storage.local.get({
    token: "",
    server: DEFAULT_SERVER,
    mode: "manual"
  });
}

async function saveState() {
  await chrome.storage.local.set({ lwaState: state });
}

async function connect() {
  if (connecting || (socket && socket.readyState === WebSocket.OPEN)) return;

  connecting = true;
  state.connecting = true;
  await saveState();

  const settings = await loadSettings();
  state.server = settings.server || DEFAULT_SERVER;

  try {
    const url = new URL(state.server);
    if (settings.token) url.searchParams.set("token", settings.token);

    socket = new WebSocket(url.toString());

    socket.addEventListener("open", async () => {
      connecting = false;
      state.connecting = false;
      state.connected = true;
      await saveState();
      broadcastState();
    });

    socket.addEventListener("message", async (event) => {
      await handleServerMessage(event.data);
    });

    socket.addEventListener("close", async () => {
      socket = null;
      connecting = false;
      state.connecting = false;
      state.connected = false;
      await saveState();
      broadcastState();
      setTimeout(connect, 2000);
    });

    socket.addEventListener("error", async () => {
      state.connected = false;
      await saveState();
      broadcastState();
    });
  } catch {
    connecting = false;
    state.connecting = false;
    state.connected = false;
    await saveState();
    setTimeout(connect, 2000);
  }
}

async function handleServerMessage(raw) {
  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    return;
  }

  if (message.type !== "tool_result") return;

  const request = requests.get(message.request_id);
  requests.delete(message.request_id);
  state.pending = requests.size;
  state.lastResult = message;
  await saveState();

  if (!request) return;

  await sendResultToTab(request.tabId, message, request.tool, request.mode);
  broadcastState();
}

async function sendResultToTab(tabId, result, tool, mode) {
  if (!tabId) return;
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: "lwa_result",
      result,
      tool,
      mode
    });
  } catch {
    // Originating tab may have been closed or navigated away.
  }
}

async function sendRequest(request, senderTabId) {
  await connect();
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    throw new Error("LWA server is not connected");
  }

  const requestId = request.request_id || crypto.randomUUID();
  const settings = await loadSettings();
  const tabId = request.tab_id || senderTabId;
  const item = {
    request_id: requestId,
    tool: request.tool,
    args: request.args || {},
    tabId,
    mode: settings.mode || "manual"
  };

  requests.set(requestId, item);
  state.pending = requests.size;
  await saveState();

  socket.send(JSON.stringify({
    request_id: requestId,
    tool: request.tool,
    args: request.args || {}
  }));
  broadcastState();
  return requestId;
}

function broadcastState() {
  chrome.runtime.sendMessage({ type: "lwa_state", state }).catch(() => {});
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "lwa_request") {
    sendRequest(message.request, sender.tab?.id)
      .then((requestId) => sendResponse({ ok: true, request_id: requestId }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "lwa_connect") {
    connect().then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "lwa_get_state") {
    sendResponse({ ok: true, state });
    return true;
  }
});

connect();
