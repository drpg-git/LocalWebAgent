const server = document.getElementById("server");
const project = document.getElementById("project");
const logs = document.getElementById("logs");
const current = document.getElementById("current");
const lastResult = document.getElementById("lastResult");
const token = document.getElementById("token");
const mode = document.getElementById("mode");
const save = document.getElementById("save");
const error = document.getElementById("error");

async function refresh() {
  const settings = await chrome.storage.local.get({ token: "", mode: "manual" });
  token.value = settings.token;
  mode.value = settings.mode;

  const response = await chrome.runtime.sendMessage({ type: "lwa_get_state" });
  if (!response?.ok) return;

  const state = response.state;
  server.textContent = state.connected ? "Connected" : state.connecting ? "Connecting" : "Disconnected";
  current.textContent = state.pending ? `${state.pending} pending` : "None";

  if (state.lastResult) {
    lastResult.textContent = state.lastResult.ok ? "Success" : "Error";
  }

  try {
    const url = `${state.server.replace(/^ws/, "http")}/status`;
    const result = await fetch(url, { signal: AbortSignal.timeout(1500) });
    if (result.ok) {
      const data = await result.json();
      project.textContent = data.project || "Not set";
      logs.textContent = data.logs ? "On" : "Off";
    }
  } catch {
    project.textContent = "Unavailable";
    logs.textContent = "Unavailable";
  }
}

save.addEventListener("click", async () => {
  error.textContent = "";
  await chrome.storage.local.set({ token: token.value.trim(), mode: mode.value });
  const response = await chrome.runtime.sendMessage({ type: "lwa_connect" });
  if (!response?.ok) {
    error.textContent = response?.error || "Connection failed";
  }
  await refresh();
});

refresh();
