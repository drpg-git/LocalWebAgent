const RESULT_START = "[LOCAL WEB AGENT RESULT]";
const RESULT_END = "[/LOCAL WEB AGENT RESULT]";

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
  element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
}

function insertResult(message, tool) {
  const composer = findComposer();
  if (!composer) return false;

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
    composer.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "lwa_result") return;
  if (insertResult(message.result, message.tool)) {
    autoSendIfEnabled(message.mode).catch(() => {});
  }
});

chrome.runtime.sendMessage({ type: "lwa_content_ready" }).catch(() => {});
