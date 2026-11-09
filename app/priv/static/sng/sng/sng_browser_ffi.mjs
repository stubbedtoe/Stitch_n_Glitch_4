// Browser platform adapters for the M1 shell slice. Thin FFI only (spike3
// pattern): plain values cross the boundary; all state lives in Gleam.

export function now_ms() {
  return Date.now();
}

export function online() {
  return globalThis.navigator?.onLine ?? true;
}

// Registers the app-shell service worker; failures never block the app
// (OfflineCapable degrades gracefully if registration is unavailable).
export function register_service_worker(path) {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register(path).catch(() => {});
  }
}

// Fires on_change when connectivity transitions. The online/offline events
// cover the timely path; a slow poll (one config.offline_indicator_deadline)
// is the fallback so the indicator still surfaces within the deadline.
export function watch_connectivity(on_change, deadline_ms) {
  let last = online();
  const handler = () => {
    const current = online();
    if (current !== last) {
      last = current;
      on_change(current);
    }
  };
  window.addEventListener("online", handler);
  window.addEventListener("offline", handler);
  setInterval(handler, Math.max(deadline_ms, 1000));
}

export function watch_pointer_end(dispatch) {
  const handler = () => dispatch();
  window.addEventListener("pointerup", handler);
  window.addEventListener("pointercancel", handler);
}

// Reads the chosen file as raw bytes and reports {name, bytes}. The listener
// is attached once per element; re-attachment after re-renders is a no-op.
export function attach_file_input(input_id, on_file) {
  const input = document.getElementById(input_id);
  if (!input || input.dataset.sngAttached) return;
  input.dataset.sngAttached = "1";
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (!file) return;
    file
      .arrayBuffer()
      .then((buffer) => {
        on_file({ name: file.name, bytes: Array.from(new Uint8Array(buffer)) });
        input.value = "";
      })
      .catch(() => {});
  });
}

// Local download: an object-URL anchor click. No network transmission
// (contract LocalOnlyBoundary, rule ExportPdfPlaceholder).
export function download_text(filename, content) {
  const blob = new Blob([content], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
