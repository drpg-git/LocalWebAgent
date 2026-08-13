const server =
  document.getElementById(
    "server"
  );

const project =
  document.getElementById(
    "project"
  );

const logs =
  document.getElementById(
    "logs"
  );

const current =
  document.getElementById(
    "current"
  );

const lastResult =
  document.getElementById(
    "lastResult"
  );

const token =
  document.getElementById(
    "token"
  );

const mode =
  document.getElementById(
    "mode"
  );

const save =
  document.getElementById(
    "save"
  );

const error =
  document.getElementById(
    "error"
  );

const queue =
  document.getElementById(
    "queue"
  );

function renderQueue(items) {
  queue.replaceChildren();

  if (!items.length) {
    return;
  }

  for (const item of items) {
    const card =
      document.createElement(
        "div"
      );

    card.className =
      "queue-item";

    const title =
      document.createElement(
        "strong"
      );

    title.textContent =
      item.tool ||
      "Unknown tool";

    const id =
      document.createElement(
        "div"
      );

    id.className =
      "queue-id";

    id.textContent =
      item.request_id ||
      "";

    const args =
      document.createElement(
        "pre"
      );

    try {
      args.textContent =
        JSON.stringify(
          item.args || {},
          null,
          2
        );
    } catch {
      args.textContent =
        String(
          item.args || {}
        );
    }

    const buttons =
      document.createElement(
        "div"
      );

    buttons.className =
      "queue-buttons";

    if (item.sent) {
      const sent =
        document.createElement(
          "span"
        );

      sent.textContent =
        "Отправлено на сервер";

      buttons.appendChild(
        sent
      );
    } else {
      const approve =
        document.createElement(
          "button"
        );

      approve.textContent =
        "Подтвердить";

      approve.addEventListener(
        "click",
        async () => {
          approve.disabled =
            true;

          error.textContent =
            "";

          try {
            const response =
              await chrome.runtime.sendMessage(
                {
                  type:
                    "lwa_approve",

                  request_id:
                    item.request_id
                }
              );

            if (
              !response ||
              !response.ok
            ) {
              throw new Error(
                response?.error ||
                "Не удалось подтвердить запрос"
              );
            }

            await refresh();
          } catch (e) {
            approve.disabled =
              false;

            error.textContent =
              e.message ||
              String(e);
          }
        }
      );

      const reject =
        document.createElement(
          "button"
        );

      reject.textContent =
        "Отклонить";

      reject.addEventListener(
        "click",
        async () => {
          reject.disabled =
            true;

          approve.disabled =
            true;

          error.textContent =
            "";

          try {
            const response =
              await chrome.runtime.sendMessage(
                {
                  type:
                    "lwa_reject",

                  request_id:
                    item.request_id
                }
              );

            if (
              !response ||
              !response.ok
            ) {
              throw new Error(
                response?.error ||
                "Не удалось удалить запрос"
              );
            }

            await refresh();
          } catch (e) {
            reject.disabled =
              false;

            approve.disabled =
              false;

            error.textContent =
              e.message ||
              String(e);
          }
        }
      );

      buttons.appendChild(
        approve
      );

      buttons.appendChild(
        reject
      );
    }

    card.appendChild(
      title
    );

    card.appendChild(
      id
    );

    card.appendChild(
      args
    );

    card.appendChild(
      buttons
    );

    queue.appendChild(
      card
    );
  }
}

async function refreshQueue() {
  const response =
    await chrome.runtime.sendMessage(
      {
        type:
          "lwa_get_queue"
      }
    );

  if (
    !response ||
    !response.ok
  ) {
    return;
  }

  const items =
    Array.isArray(
      response.queue
    )
      ? response.queue
      : [];

  renderQueue(items);

  current.textContent =
    items.length
      ? `${items.length} pending`
      : "None";
}

async function refresh() {
  error.textContent =
    "";

  const settings =
    await chrome.storage.local.get(
      {
        token: "",
        server:
          "ws://127.0.0.1:8765/ws",
        mode: "manual"
      }
    );

  token.value =
    settings.token || "";

  mode.value =
    settings.mode === "auto"
      ? "auto"
      : "manual";

  const response =
    await chrome.runtime.sendMessage(
      {
        type:
          "lwa_get_state"
      }
    );

  if (
    !response ||
    !response.ok
  ) {
    return;
  }

  const state =
    response.state || {};

  server.textContent =
    state.connected
      ? "Connected"
      : state.connecting
        ? "Connecting"
        : "Disconnected";

  current.textContent =
    state.pending
      ? `${state.pending} pending`
      : "None";

  if (
    state.lastResult
  ) {
    const result =
      state.lastResult;

    if (
      result.ok === false ||
      result.success === false
    ) {
      lastResult.textContent =
        "Error";
    } else {
      lastResult.textContent =
        "Success";
    }
  } else {
    lastResult.textContent =
      "None";
  }

  try {
    const base =
      (
        state.server ||
        settings.server
      )
        .replace(
          /^ws/,
          "http"
        )
        .replace(
          /\/ws\/?$/,
          ""
        );

    const statusResponse =
      await fetch(
        `${base}/status`,
        {
          signal:
            AbortSignal.timeout(
              1500
            )
        }
      );

    if (
      statusResponse.ok
    ) {
      const data =
        await statusResponse.json();

      project.textContent =
        data.project ||
        "Not set";

      logs.textContent =
        data.logs
          ? "On"
          : "Off";
    }
  } catch {
    project.textContent =
      "Unavailable";

    logs.textContent =
      "Unavailable";
  }

  await refreshQueue();
}

save.addEventListener(
  "click",
  async () => {
    error.textContent =
      "";

    const settings =
      await chrome.storage.local.get(
        {
          server:
            "ws://127.0.0.1:8765/ws"
        }
      );

    await chrome.storage.local.set(
      {
        token:
          token.value.trim(),

        server:
          settings.server,

        mode:
          mode.value === "auto"
            ? "auto"
            : "manual"
      }
    );

    const response =
      await chrome.runtime.sendMessage(
        {
          type:
            "lwa_connect"
        }
      );

    if (
      !response ||
      !response.ok
    ) {
      error.textContent =
        response?.error ||
        "Connection failed";
    }

    await refresh();
  }
);

chrome.runtime.onMessage.addListener(
  (message) => {
    if (
      message?.type ===
      "lwa_state"
    ) {
      refresh().catch(() => {});
    }

    if (
      message?.type ===
      "lwa_queue"
    ) {
      const items =
        Array.isArray(
          message.queue
        )
          ? message.queue
          : [];

      renderQueue(items);

      current.textContent =
        items.length
          ? `${items.length} pending`
          : "None";
    }
  }
);

refresh().catch(
  (error) => {
    console.error(
      "[LWA] Popup refresh error:",
      error
    );
  }
);