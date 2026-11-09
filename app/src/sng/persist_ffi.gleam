//// IndexedDB persistence seam for the M1 shell slice (guarantees
//// LibraryPersists, CrashRecovery, UndoPersists at the browser level).
////
//// spike3 pattern: the opaque browser handle (the IDB database) never crosses
//// into Gleam. The domain's persist.serialize output is stored as one
//// string record; on boot the stored string (or null when absent/corrupt)
//// comes back through a callback and is fed to persist.deserialize. The app
//// saves after every committed operation, so a gesture is durable in
//// IndexedDB before it is acknowledged (NFR-A3).
////
//// The callback receives a Dynamic because the JS side passes `null` for an
//// absent or unreadable record; decode it with decode.optional.

import gleam/dynamic.{type Dynamic}

@external(javascript, "./sng_persist_ffi.mjs", "load_store")
pub fn load(callback: fn(Dynamic) -> Nil) -> Nil

@external(javascript, "./sng_persist_ffi.mjs", "save_store")
pub fn save(payload: String) -> Nil
