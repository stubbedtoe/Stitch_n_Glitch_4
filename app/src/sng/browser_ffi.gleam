//// Browser platform bindings for the M1 shell slice. Thin FFI adapters
//// (spike3 pattern): the Gleam MVU app owns all state; these functions only
//// bridge to browser APIs that Lustre events cannot reach (clock, online
//// state, file bytes, downloads, service worker registration).

import gleam/dynamic.{type Dynamic}

/// Current epoch milliseconds (Timestamp in the domain).
@external(javascript, "./sng_browser_ffi.mjs", "now_ms")
pub fn now_ms() -> Int

/// navigator.onLine at call time.
@external(javascript, "./sng_browser_ffi.mjs", "online")
pub fn online() -> Bool

/// Register the app-shell service worker (guarantee OfflineCapable).
@external(javascript, "./sng_browser_ffi.mjs", "register_service_worker")
pub fn register_service_worker(path: String) -> Nil

/// Subscribe to connectivity transitions. `deadline_ms` is
/// config.offline_indicator_deadline: the poll fallback guarantees the
/// indicator surfaces within the deadline even if the online/offline events
/// are not delivered. Calls on_change only when the value actually changes.
@external(javascript, "./sng_browser_ffi.mjs", "watch_connectivity")
pub fn watch_connectivity(on_change: fn(Bool) -> Nil, deadline_ms: Int) -> Nil

/// Dispatch an end-of-gesture message whenever the pointer is released or
/// cancelled anywhere in the window (a stroke may end outside a cell).
@external(javascript, "./sng_browser_ffi.mjs", "watch_pointer_end")
pub fn watch_pointer_end(dispatch: fn() -> Nil) -> Nil

/// Read the file chosen in the import-image input as raw bytes. The
/// on_file callback receives a Dynamic decoding to {name, bytes} where bytes
/// is a List(Int) (see ImportedFile in sng.gleam). Idempotent per element.
@external(javascript, "./sng_browser_ffi.mjs", "attach_file_input")
pub fn attach_file_input(input_id: String, on_file: fn(Dynamic) -> Nil) -> Nil

/// Download text content as a local file (the M1 PDF export placeholder).
/// Nothing is transmitted: the file is built from an object URL.
@external(javascript, "./sng_browser_ffi.mjs", "download_text")
pub fn download_text(filename: String, content: String) -> Nil
