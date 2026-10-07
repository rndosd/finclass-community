// Imperative dialogs keep hooks, services and event handlers on the same UI.
// Each confirmation has its own result; duplicate clicks must not resume two mutations.
let queue = [];
let sequence = 0;
const listeners = new Set();
const notify = () => listeners.forEach((listener) => listener());
const cancelledResult = (type) => type === "confirm" ? false : type === "prompt" ? null : undefined;

export const subscribeAppDialogs = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const getAppDialog = () => queue[0] || null;

function requestDialog(type, message, options = {}) {
  const text = String(message ?? "");
  if (queue.some((request) => request.type === type && request.message === text)) {
    return Promise.resolve(cancelledResult(type));
  }
  return new Promise((resolve) => {
    queue = [...queue, { ...options, id: ++sequence, type, message: text, resolve }];
    notify();
  });
}

// Alerts retain the native void return contract (e.g. early validation returns).
export function appAlert(message, options) {
  requestDialog("alert", message, options);
}
export const appConfirm = (message, options) => requestDialog("confirm", message, options);
export const appPrompt = (message, defaultValue = "", options = {}) =>
  requestDialog("prompt", message, { ...options, defaultValue: String(defaultValue ?? "") });

export function resolveAppDialog(id, value) {
  const request = queue[0];
  if (!request || request.id !== id) return;
  queue = queue.slice(1);
  request.resolve(value);
  notify();
}

export function cancelAppDialogs() {
  const pending = queue;
  queue = [];
  pending.forEach((request) => request.resolve(cancelledResult(request.type)));
  notify();
}
