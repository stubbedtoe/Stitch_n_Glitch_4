import * as $dynamic from "../../gleam_stdlib/gleam/dynamic.mjs";
import {
  now_ms,
  online,
  register_service_worker,
  watch_connectivity,
  watch_pointer_end,
  attach_file_input,
  download_text,
} from "./sng_browser_ffi.mjs";

export {
  attach_file_input,
  download_text,
  now_ms,
  online,
  register_service_worker,
  watch_connectivity,
  watch_pointer_end,
};
