(() => {
  const RESULT_START = "[LOCAL WEB AGENT RESULT]";
  const RESULT_END = "[/LOCAL WEB AGENT RESULT]";
  const LOG_PREFIX = "[LWA][Content]";

  const processedRequests = new Set();
  const nodeHashes = new WeakMap();
  let scanTimer = null;

  function log(...args) {
    console.log(LOG_PREFIX, ...args);
  }

  function simpleHash(value) {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  function findComposer() {
    const selectors = [
      "textarea",
      "div[contenteditable='true'][role='textbox']",
      "div[contenteditable='true']"
    ];

    for (const selector of selectors) {
      const elements = [...document.querySelectorAll(selector)];
      const visible = elements.find((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && !element.closest("[hidden]");
      });
      if (visible) return visible;
    }

    return null;
  }

  function serializeResult(message, tool) {
    const status = message.ok ? "success" : "error";
    const body = message.ok
      ? JSON.stringify(message.result ?? {}, null, 2)
      : JSON.stringify(message.error ?? {}, null, 2);

    return `${RESULT_START}\nrequest_id: ${message.request_id}\ntool: ${tool}\nstatus: ${status}\n\n${body}\n${RESULT_END}\n\nДальше`;
  }

  function insertIntoTextarea(element, text) {
    const existing = element.value || "";
    element.focus();
    element.value = existing ? `${existing}\n\n${text}` : text;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.setSelectionRange(element.value.length, element.value.length);
  }

  function insertIntoContentEditable(element, text) {
    element.focus();

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);

    selection.removeAllRanges();
    selection.addRange(range);

    const existing = element.textContent?.trim();
    const prefix = existing ? "\n\n" : "";
    const node = document.createTextNode(`${prefix}${text}`);

    range.insertNode(node);
    range.collapse(false);

    selection.removeAllRanges();
    selection.addRange(range);

    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: text
    }));
  }

  function insertResult(message, tool) {
    const composer = findComposer();
    if (!composer) {
      log("Composer not found");
      return false;
    }

    const text = serializeResult(message, tool);

    if (composer instanceof HTMLTextAreaElement) {
      insertIntoTextarea(composer, text);
    } else {
      insertIntoContentEditable(composer, text);
    }

    return true;
  }

  async function autoSendIfEnabled(mode) {
    if (mode !== "auto") return;

    await new Promise((resolve) => setTimeout(resolve, 150));

    const buttons = [...document.querySelectorAll("button")];
    const sendButton = buttons.find((button) => {
      const label = `${button.getAttribute("aria-label") || ""} ${button.textContent || ""}`.toLowerCase();
      return /send|отправ/.test(label) && !button.disabled;
    });

    if (sendButton) {
      sendButton.click();
      return;
    }

    const composer = findComposer();
    if (composer instanceof HTMLTextAreaElement) {
      composer.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        bubbles: true
      }));
    }
  }

  function getAssistantMessages() {
    return Array.from(
      document.querySelectorAll('[data-message-author-role="assistant"]')
    );
  }

  function extractBalancedJson(text, startIndex) {
    const first = text[startIndex];

    if (first !== "[" && first !== "{") {
      return null;
    }

    const stack = [first === "[" ? "]" : "}"];
    let inString = false;
    let escaped = false;

    for (let i = startIndex + 1; i < text.length; i++) {
      const ch = text[i];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === "\\") {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }

      if (ch === "[") {
        stack.push("]");
        continue;
      }

      if (ch === "{") {
        stack.push("}");
        continue;
      }

      if (ch === "]" || ch === "}") {
        if (stack[stack.length - 1] !== ch) {
          return null;
        }

        stack.pop();

        if (stack.length === 0) {
          return text.slice(startIndex, i + 1).trim();
        }
      }
    }

    return null;
  }

  function extractJsonBlocks(text) {
    const blocks = [];
    const seen = new Set();

    function addBlock(source, raw, startIndex = -1) {
      const value = String(raw || "").trim();
      if (!value || seen.has(value)) return;

      seen.add(value);
      blocks.push({
        source,
        startIndex,
        text: value
      });
    }

    const fenced = /```(?:json|JSON)?\s*([\s\S]*?)```/g;
    let match;

    while ((match = fenced.exec(text)) !== null) {
      addBlock("code-fence", match[1], match.index);
    }

    for (let i = 0; i < text.length; i++) {
      if (text[i] !== "[" && text[i] !== "{") continue;

      const raw = extractBalancedJson(text, i);
      if (!raw) continue;

      try {
        JSON.parse(raw);
      } catch {
        continue;
      }

      addBlock("raw-json", raw, i);
    }

    return blocks;
  }

  function normalizeToolRequest(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    if (typeof value.request_id !== "string" || !value.request_id.trim()) {
      return null;
    }

    if (typeof value.tool !== "string" || !value.tool.trim()) {
      return null;
    }

    if (
      value.args !== undefined &&
      (!value.args || typeof value.args !== "object" || Array.isArray(value.args))
    ) {
      return null;
    }

    return {
      request_id: value.request_id.trim(),
      tool: value.tool.trim(),
      args: value.args && typeof value.args === "object" ? value.args : {}
    };
  }

  function extractToolRequests(text) {
    const requests = [];
    const seen = new Set();

    for (const block of extractJsonBlocks(text)) {
      let value;

      try {
        value = JSON.parse(block.text);
      } catch {
        continue;
      }

      const candidates = Array.isArray(value) ? value : [value];

      for (const candidate of candidates) {
        const request = normalizeToolRequest(candidate);
        if (!request) continue;

        if (seen.has(request.request_id)) continue;
        seen.add(request.request_id);
        requests.push(request);
      }
    }

    return requests;
  }

  async function forwardToolRequest(request) {
    if (processedRequests.has(request.request_id)) {
      return;
    }

    processedRequests.add(request.request_id);

    log("Tool request detected:", request);

    try {
      const response = await chrome.runtime.sendMessage({
        type: "lwa_request",
        request: {
          request_id: request.request_id,
          tool: request.tool,
          args: request.args,
          tab_id: typeof chrome.tabs === "undefined" ? undefined : undefined
        }
      });

      if (!response?.ok) {
        console.error(
          LOG_PREFIX,
          "Background rejected tool request:",
          response?.error || "Unknown error"
        );
      }
    } catch (error) {
      console.error(LOG_PREFIX, "Failed to forward tool request:", error);
    }
  }

  async function processAssistantMessage(node) {
    const text = (node.innerText || node.textContent || "").trim();
    if (!text) return;

    const hash = simpleHash(text);
    if (nodeHashes.get(node) === hash) return;
    nodeHashes.set(node, hash);

    const requests = extractToolRequests(text);

    if (requests.length === 0) return;

    log(`Found ${requests.length} tool request(s)`);

    for (const request of requests) {
      await forwardToolRequest(request);
    }
  }

  async function scanAll() {
    const messages = getAssistantMessages();

    for (const node of messages) {
      await processAssistantMessage(node);
    }
  }

  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      scanAll().catch((error) => {
        console.error(LOG_PREFIX, "DOM scan failed:", error);
      });
    }, 300);
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "lwa_result") return;

    if (insertResult(message.result, message.tool)) {
      autoSendIfEnabled(message.mode).catch((error) => {
        console.error(LOG_PREFIX, "Auto-send failed:", error);
      });
    }
  });

  const observer = new MutationObserver(() => {
    scheduleScan();
  });

  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true
  });

  chrome.runtime.sendMessage({
    type: "lwa_content_ready"
  }).catch(() => {});

  log("Content script started");
  scheduleScan();
})();
