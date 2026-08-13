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

async function loadRequests() {
  const data = await chrome.storage.local.get({
    lwaRequests: []
  });

  requests.clear();

  const saved = Array.isArray(data.lwaRequests)
    ? data.lwaRequests
    : [];

  for (const item of saved) {
    if (
      item &&
      typeof item.request_id === "string"
    ) {
      requests.set(
        item.request_id,
        item
      );
    }
  }

  updatePendingState();
}

async function saveRequests() {
  await chrome.storage.local.set({
    lwaRequests: Array.from(
      requests.values()
    )
  });
}

async function saveState() {
  await chrome.storage.local.set({
    lwaState: state
  });
}

function updatePendingState() {
  state.pending = requests.size;
}

function broadcastState() {
  chrome.runtime.sendMessage({
    type: "lwa_state",
    state: {
      ...state
    }
  }).catch(() => {});
}

function broadcastQueue() {
  chrome.runtime.sendMessage({
    type: "lwa_queue",
    queue: Array.from(
      requests.values()
    ).map((item) => ({
      ...item
    }))
  }).catch(() => {});
}

function scheduleReconnect() {
  if (reconnectTimer !== null) {
    return;
  }

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;

    connect().catch(() => {});
  }, 2000);
}

async function connect() {
  if (
    socket &&
    socket.readyState === WebSocket.OPEN
  ) {
    return socket;
  }

  if (connectingPromise) {
    return connectingPromise;
  }

  connectingPromise = (async () => {
    const settings =
      await loadSettings();

    state.server =
      settings.server ||
      DEFAULT_SERVER;

    state.connecting = true;

    await saveState();
    broadcastState();

    const url =
      new URL(state.server);

    if (settings.token) {
      url.searchParams.set(
        "token",
        settings.token
      );
    }

    const ws =
      new WebSocket(
        url.toString()
      );

    socket = ws;

    await new Promise(
      (resolve, reject) => {
        let finished = false;

        const success = () => {
          if (finished) {
            return;
          }

          finished = true;
          resolve();
        };

        const failure = () => {
          if (finished) {
            return;
          }

          finished = true;

          reject(
            new Error(
              "LWA WebSocket connection failed"
            )
          );
        };

        ws.addEventListener(
          "open",
          success,
          { once: true }
        );

        ws.addEventListener(
          "error",
          failure,
          { once: true }
        );
      }
    );

    state.connected = true;
    state.connecting = false;

    await saveState();
    broadcastState();

    ws.addEventListener(
      "message",
      (event) => {
        handleServerMessage(
          event.data
        ).catch((error) => {
          console.error(
            "[LWA] Server message error:",
            error
          );
        });
      }
    );

    ws.addEventListener(
      "close",
      () => {
        if (socket === ws) {
          socket = null;
        }

        state.connected = false;
        state.connecting = false;

        saveState().catch(() => {});
        broadcastState();

        scheduleReconnect();
      }
    );

    ws.addEventListener(
      "error",
      () => {
        state.connected = false;

        saveState().catch(() => {});
        broadcastState();
      }
    );

    return ws;
  })();

  try {
    return await connectingPromise;
  } catch (error) {
    if (
      socket &&
      socket.readyState !== WebSocket.OPEN
    ) {
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
    message =
      JSON.parse(raw);
  } catch {
    return;
  }

  if (
    message.type !==
    "tool_result"
  ) {
    return;
  }

  await loadRequests();

  const request =
    requests.get(
      message.request_id
    );

  if (!request) {
    console.warn(
      "[LWA] Unknown request:",
      message.request_id
    );

    return;
  }

  requests.delete(
    message.request_id
  );

  updatePendingState();

  state.lastResult =
    message;

  await saveRequests();
  await saveState();

  if (request.tabId) {
    try {
      await chrome.tabs.sendMessage(
        request.tabId,
        {
          type: "lwa_result",
          result: message,
          tool: request.tool,
          mode: request.mode
        }
      );
    } catch {
      // Вкладка могла быть закрыта.
    }
  }

  broadcastQueue();
  broadcastState();
}

async function sendToServer(item) {
  const ws =
    await connect();

  if (
    !ws ||
    ws.readyState !==
      WebSocket.OPEN
  ) {
    throw new Error(
      "LWA server is not connected"
    );
  }

  ws.send(
    JSON.stringify({
      request_id:
        item.request_id,

      tool:
        item.tool,

      args:
        item.args
    })
  );
}

async function sendRequest(
  request,
  senderTabId
) {
  await loadRequests();

  if (
    !request ||
    typeof request.tool !==
      "string" ||
    !request.tool
  ) {
    throw new Error(
      "Invalid LWA tool request"
    );
  }

  const requestId =
    request.request_id ||
    crypto.randomUUID();

  const settings =
    await loadSettings();

  const mode =
    settings.mode === "auto"
      ? "auto"
      : "manual";

  const tabId =
    request.tab_id ||
    senderTabId ||
    null;

  if (
    requests.has(requestId)
  ) {
    return requestId;
  }

  const item = {
    request_id:
      requestId,

    tool:
      request.tool,

    args:
      request.args &&
      typeof request.args ===
        "object" &&
      !Array.isArray(
        request.args
      )
        ? request.args
        : {},

    tabId:
      tabId,

    mode:
      mode,

    sent:
      false,

    createdAt:
      Date.now()
  };

  requests.set(
    requestId,
    item
  );

  updatePendingState();

  await saveRequests();
  await saveState();

  broadcastQueue();
  broadcastState();

  /*
   * MANUAL:
   * Только сохраняем запрос
   * в очередь.
   *
   * На сервер здесь НЕ отправляем.
   */
  if (mode === "manual") {
    return requestId;
  }

  /*
   * AUTO:
   * Сразу отправляем
   * на сервер.
   */
  try {
    await sendToServer(
      item
    );

    item.sent = true;

    await saveRequests();

    broadcastQueue();
    broadcastState();

    return requestId;
  } catch (error) {
    requests.delete(
      requestId
    );

    updatePendingState();

    await saveRequests();
    await saveState();

    broadcastQueue();
    broadcastState();

    throw error;
  }
}

async function approveRequest(
  requestId
) {
  await loadRequests();

  const item =
    requests.get(
      requestId
    );

  if (!item) {
    throw new Error(
      "Request not found"
    );
  }

  if (item.sent) {
    return;
  }

  await sendToServer(
    item
  );

  item.sent = true;

  await saveRequests();
  await saveState();

  broadcastQueue();
  broadcastState();
}

async function rejectRequest(
  requestId
) {
  await loadRequests();

  if (
    !requests.has(
      requestId
    )
  ) {
    throw new Error(
      "Request not found"
    );
  }

  requests.delete(
    requestId
  );

  updatePendingState();

  await saveRequests();
  await saveState();

  broadcastQueue();
  broadcastState();
}

chrome.runtime.onMessage.addListener(
  (
    message,
    sender,
    sendResponse
  ) => {

    if (
      message?.type ===
      "lwa_request"
    ) {
      sendRequest(
        message.request,
        sender.tab?.id
      )
        .then(
          (requestId) => {
            sendResponse({
              ok: true,
              request_id:
                requestId
            });
          }
        )
        .catch(
          (error) => {
            sendResponse({
              ok: false,
              error:
                error.message ||
                String(error)
            });
          }
        );

      return true;
    }

    if (
      message?.type ===
      "lwa_approve"
    ) {
      approveRequest(
        message.request_id
      )
        .then(() => {
          sendResponse({
            ok: true
          });
        })
        .catch(
          (error) => {
            sendResponse({
              ok: false,
              error:
                error.message ||
                String(error)
            });
          }
        );

      return true;
    }

    if (
      message?.type ===
      "lwa_reject"
    ) {
      rejectRequest(
        message.request_id
      )
        .then(() => {
          sendResponse({
            ok: true
          });
        })
        .catch(
          (error) => {
            sendResponse({
              ok: false,
              error:
                error.message ||
                String(error)
            });
          }
        );

      return true;
    }

    if (
      message?.type ===
      "lwa_get_queue"
    ) {
      loadRequests()
        .then(() => {
          sendResponse({
            ok: true,

            queue:
              Array.from(
                requests.values()
              ).map(
                (item) => ({
                  ...item
                })
              )
          });
        })
        .catch(
          (error) => {
            sendResponse({
              ok: false,
              error:
                error.message ||
                String(error)
            });
          }
        );

      return true;
    }

    if (
      message?.type ===
      "lwa_connect"
    ) {
      connect()
        .then(() => {
          sendResponse({
            ok: true
          });
        })
        .catch(
          (error) => {
            sendResponse({
              ok: false,
              error:
                error.message ||
                String(error)
            });
          }
        );

      return true;
    }

    if (
      message?.type ===
      "lwa_get_state"
    ) {
      loadRequests()
        .then(() => {
          sendResponse({
            ok: true,

            state: {
              ...state
            }
          });
        })
        .catch(
          (error) => {
            sendResponse({
              ok: false,
              error:
                error.message ||
                String(error)
            });
          }
        );

      return true;
    }

    if (
      message?.type ===
      "lwa_content_ready"
    ) {
      loadRequests()
        .then(() => {
          sendResponse({
            ok: true,

            state: {
              ...state
            }
          });
        })
        .catch(() => {
          sendResponse({
            ok: true,

            state: {
              ...state
            }
          });
        });

      return true;
    }
  }
);

loadRequests()
  .then(() => {
    return connect()
      .catch(() => {});
  })
  .catch(() => {
    return connect()
      .catch(() => {});
  });