const DEFAULT_SERVER = "ws://127.0.0.1:8765/ws";

let socket = null;
let connectingPromise = null;
let reconnectTimer = null;

const state = {
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

function broadcastState() {
  chrome.runtime.sendMessage({
    type: "lwa_state",
    state: { ...state }
  }).catch(() => {});
}

function updatePendingState() {
  state.pending = requests.size;
}

function scheduleReconnect() {
  if (reconnectTimer !== null) return;

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect().catch(() => {});
  }, 2000);
}

async function connect() {
  if (socket && socket.readyState === WebSocket.OPEN) {
    return socket;
  }

  if (connectingPromise) {
    return connectingPromise;
  }

  connectingPromise = (async () => {
    const settings = await loadSettings();
    state.server = settings.server || DEFAULT_SERVER;
    state.connecting = true;
    await saveState();
    broadcastState();

    const url = new URL(state.server);
    if (settings.token) {
      url.searchParams.set("token", settings.token);
    }

    const ws = new WebSocket(url.toString());
    socket = ws;

    await new Promise((resolve, reject) => {
      let settled = false;

      const finishResolve = () => {
        if (settled) return;
        settled = true;
        resolve();
      };

      const finishReject = (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };

      ws.addEventListener("open", finishResolve, { once: true });
      ws.addEventListener("error", () => {
        finishReject(new Error("LWA WebSocket connection failed"));
      }, { once: true });
    });

    state.connected = true;
    state.connecting = false;
    await saveState();
    broadcastState();

    ws.addEventListener("message", (event) => {
      handleServerMessage(event.data).catch((error) => {
        console.error("[LWA] Failed to handle server message:", error);
      });
    });

    ws.addEventListener("close", () => {
      if (socket === ws) {
        socket = null;
      }

      state.connected = false;
      state.connecting = false;
      saveState().catch(() => {});
      broadcastState();
      scheduleReconnect();
    });

    ws.addEventListener("error", () => {
      state.connected = false;
      saveState().catch(() => {});
      broadcastState();
    });

    return ws;
  })();

  try {
    return await connectingPromise;
  } catch (error) {
    if (socket && socket.readyState !== WebSocket.OPEN) {
      socket = null;
    }

    state.connected = false;
    state.connecting = false;
    await saveState();
    broadcastState();
    scheduleReconnect();
    throw error;
  } finally {
    connectingPromise = null;
  }
}

async function handleServerMessage(raw) {
  let message;

  try {
    message = JSON.parse(raw);
  } catch {
    return;
  }

  if (message.type !== "tool_result") {
    return;
  }

  const request = requests.get(message.request_id);

  if (!request) {
    console.warn("[LWA] Unknown request_id:", message.request_id);
    return;
  }

  requests.delete(message.request_id);
  updatePendingState();
  state.lastResult = message;

  await saveState();

  await sendResultToTab(
    request.tabId,
    message,
    request.tool,
    request.mode
  );

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
    // The originating tab may have been closed or navigated away.
  }
}

async function sendRequest(request, senderTabId) {
  const ws = await connect();

  if (!ws || ws.readyState !== WebSocket.OPEN) {
    throw new Error("LWA server is not connected");
  }

  if (!request || typeof request.tool !== "string" || !request.tool) {
    throw new Error("Invalid LWA tool request");
  }

  const requestId = request.request_id || crypto.randomUUID();
  const settings = await loadSettings();
  const tabId = request.tab_id || senderTabId || null;

  const item = {
    request_id: requestId,
    tool: request.tool,
    args: request.args && typeof request.args === "object" ? request.args : {},
    tabId,
    mode: settings.mode || "manual"
  };

  requests.set(requestId, item);
  updatePendingState();
  await saveState();
  broadcastState();

  try {
    ws.send(JSON.stringify({
      request_id: requestId,
      tool: item.tool,
      args: item.args
    }));
  } catch (error) {
    requests.delete(requestId);
    updatePendingState();
    await saveState();
    broadcastState();
    throw error;
  }

  return requestId;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "lwa_request") {
    sendRequest(message.request, sender.tab?.id)
      .then((requestId) => {
        sendResponse({
          ok: true,
          request_id: requestId
        });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error.message || String(error)
        });
      });

    return true;
  }

  if (message?.type === "lwa_connect") {
    connect()
      .then(() => {
        sendResponse({ ok: true });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error.message || String(error)
        });
      });

    return true;
  }

  if (message?.type === "lwa_get_state") {
    sendResponse({
      ok: true,
      state: { ...state }
    });

    return true;
  }

  if (message?.type === "lwa_content_ready") {
    sendResponse({
      ok: true,
      state: { ...state }
    });

    return true;
  }
});

connect().catch(() => {});
