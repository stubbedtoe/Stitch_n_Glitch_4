// IndexedDB persistence adapter for the M1 shell slice. Thin FFI adapter
// (spike3 pattern): the Gleam app owns all state and the serialized store
// string is the only thing that crosses this boundary. The database handle
// stays opaque in JS.
//
// Durability contract (CrashRecovery, NFR-A3): every committed gesture is
// written with a readwrite transaction before the UI acknowledges it, so the
// record on disk always reflects the last committed state.

const DB_NAME = "sng";
const DB_VERSION = 1;
const STORE = "store";
const KEY = "store";

let database = null;

function open() {
  if (database) return Promise.resolve(database);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => {
      database = request.result;
      resolve(database);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("indexeddb blocked"));
  });
}

// Calls on_result with the stored payload, or null when absent/unreadable
// (the Gleam side then boots with a fresh store via persist.deserialize).
export function load_store(on_result) {
  open()
    .then(
      (db) =>
        new Promise((resolve, reject) => {
          const request = db.transaction(STORE, "readonly").objectStore(STORE).get(KEY);
          request.onsuccess = () => resolve(request.result ?? null);
          request.onerror = () => reject(request.error);
        }),
    )
    .then((payload) => on_result(payload))
    .catch(() => on_result(null));
}

export function save_store(payload) {
  open()
    .then((db) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(payload, KEY);
    })
    .catch(() => {});
}
