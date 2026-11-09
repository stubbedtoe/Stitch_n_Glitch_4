# The standard library and the Gleam ecosystem

What ships with Gleam, what the Gleam core team maintains, and what the
community has built. Read this when deciding **which module or package to use**
for a task; the "how to use it" details live in the other topic files.

> Verified against HexDocs at the pinned versions: `gleam_stdlib` v1.0.5,
> `gleam_otp` v1.3.0, `lustre` v5.7.1. If the user's `manifest.toml` pins a
> different version, confirm function names against that version before
> pasting. This file is the single source of truth for package/ecosystem
> decisions; other topic files link here instead of duplicating lists.

## `gleam_stdlib` — the standard library

Both targets (Erlang + JavaScript). Add it with `gleam add gleam_stdlib@1`
(it's added automatically by `gleam new`). The `gleam/…` modules:

| Module | What it provides |
|---|---|
| `gleam/list` | The workhorse collection: `map`, `filter`, `fold`, `reduce`, `each`, `append`, `prepend`, `reverse`, `take`/`drop`, `find`, `first`, `sort`, `group`, `chunk`, `unique`, `zip`, `try_map`, `index_map`, … `[head, ..tail]` list patterns are core syntax. |
| `gleam/dict` | Immutable hash maps: `new`, `insert`, `get` (returns `Result`), `upsert`, `delete`, `merge`, `keys`, `values`, `fold`, `from_list`/`to_list`. Not ordered; don't rely on iteration order. |
| `gleam/set` | Immutable sets (unique values): `new`, `insert`, `delete`, `contains`, union/intersect-style helpers. |
| `gleam/string` | UTF-8 / grapheme-aware text: `length` (graphemes, not bytes), `to_graphemes`, `split`, `split_once`, `join`, `uppercase`/`lowercase`, `trim*`, `contains`, `slice`, `replace`, `pad_*`, `repeat`, `inspect`. |
| `gleam/string_tree` | Rope-like efficient string building for repeated concatenation (`append` is O(1)); flatten once at the end. |
| `gleam/bit_array` | Binary data: the `<<…>>` bit-string syntax plus `from_string`, `to_string`, `slice`, `byte_size`, `concat`, `base16_encode/decode`, `base64_encode/decode`, `base64_url_encode/decode`. |
| `gleam/bytes_tree` | Rope-like efficient byte building, the `BitArray` analogue of `string_tree`. |
| `gleam/result` | Result combinators: `map`, `map_error`, `try` (prefix of `use`), `flatten`, `unwrap`, `lazy_unwrap`, `or`, `lazy_or`, `all`, `partition`, `try_recover`. |
| `gleam/option` | Optional values: `Some`/`None`, `map`, `then`, `unwrap`, `or`, `to_result`/`from_result`, `all`. For optional *inputs/storage*, not for fallible functions — those return `Result`. |
| `gleam/int` | Integer arithmetic and parsing: `parse`, `to_string`, `absolute_value`, `min`/`max`, `compare`, `is_odd`/`is_even`, `sum`/`product`, `random`, base conversions (`to_base_string`), bitwise ops. `int.divide`, `int.floor_divide`, `int.modulo`, `int.remainder` return `Result` and error on a zero divisor; the `/` operator itself returns `0` rather than crashing (Gleam has no partial operators). |
| `gleam/float` | Float math: `add` (`+.`), `parse`, `round`, `truncate`, `ceiling`/`floor`, `power`, `sum`, `random`, and `loosely_equals`/`loosely_compare` for tolerance checks. |
| `gleam/bool` | Boolean helpers: `and`/`or`/`negate` (function forms of `&&`/`\|\|`/`!`), `to_string`, and `guard`/`lazy_guard` for early-return in a `use` chain. |
| `gleam/order` | The `Order` type (`Lt`/`Eq`/`Gt`) used by `list.sort`/`int.compare`/`string.compare`. |
| `gleam/pair` | Two-element tuple (#(a, b)) helpers: `first`, `second`, `new`, `swap`, `map_first`, `map_second`. |
| `gleam/io` | Console output: `println`/`print` (+ `_error` variants). Erlang vs JS behaviour differs; see docs. |
| `gleam/dynamic` | Runtime-typed values (Erlang terms / JS values) and `Dynamic` data: `int`, `string`, `float`, `bool`, `list`, `tuple`, `map`, `classify`, `from_json`-style helpers. Never use `dynamic` for well-typed code. |
| `gleam/dynamic/decode` | **Decoders**: compose a `Decoder(a)` from primitives (`decode.string`, `decode.int`, `decode.bool`, `decode.list(…)`, `decode.field("name", decode.string)`, `decode.optional`, `decode.one_of`, `decode.at`, `decode.subfield`) and run it with `decode.run`. The language server has a "generate dynamic decoder" code action (see `dynamic/decode` docs). The canonical way to turn untyped JSON/FFI data into typed records. |
| `gleam/uri` | RFC 3986 URIs: `uri.parse`, `uri.to_string`, `uri.merge`, `uri.origin`, `uri.query_to_string`/`parse_query`, `uri.percent_encode`/`percent_decode`, `uri.path_segments`. |
| `gleam/function` | Function utilities — in v1.0.5 this is `identity`. |

Typical values used in combination: decoding untrusted input (JSON, JS/Erlang
interop). Two options, both verified against current docs:

- **Pure stdlib**: build/introspect `Dynamic` with `gleam/dynamic`
  (`dynamic.properties`, `dynamic.string`, …), then
  `decode.run(data, decoder)` into your typed records.
- **`gleam_json` v3**: `Json` is its own type, and `json.parse(from: raw, using: decoder)`
  combines parsing + decoding into one `Result` (wrapping `dynamic/decode`
  internally); `json.to_string`/`json.object`/`json.array` build values.

Check the major `gleam_json` version in the user's `manifest.toml` — the API has
changed across majors (this "borrows" the decoder flow rather than pinning
function names).

## The official `gleam-lang` packages (core team)

The Gleam core team maintains a shared foundation of packages beyond the
stdlib ("use the core libraries" — they are preferred over reimplementing or
over community duplicates). "Core libraries" per the conventions doc:

| Package | What it provides | Target notes |
|---|---|---|
| [`gleam_time`](https://hexdocs.pm/gleam_time) | Time handling: the `Timestamp` type, year/month/day/time, formatting helpers, `day_of_week`, `compare`, etc. | Both targets |
| [`gleam_json`](https://hexdocs.pm/gleam_json) | JSON encoding/decoding. The `Json` type plus builders (`json.object`, `json.string`, `json.int`, `json.array`…) and `json.to_string`. For typed decoding, `json.parse(from:, using: decoder)` (see the note below on major versions). | Both targets |
| [`gleam_http`](https://hexdocs.pm/gleam_http) | Types for HTTP requests/responses (`gleam/http/request`, `gleam/http/response`) used by clients & servers. Sans-io: build a request, parse a response, send via a target-specific client. | Both targets (pure types) |
| [`gleam_erlang`](https://hexdocs.pm/gleam_erlang) | Erlang/BEAM integration (Erlang target only): `gleam/erlang/process` (spawn, `Subject`, send/receive, timers), `gleam/erlang/atomics`, `gleam/erlang/charlist`, `gleam/erlang/map_functions`, `gleam/erlang/bit_generator`, ETS (`ets`), etc. | **Erlang only** |
| [`gleam_otp`](https://hexdocs.pm/gleam_otp) | OTP actors, supervisors, and system-processes on the BEAM: `gleam/otp/actor`, `gleam/otp/static_supervisor`, `gleam/otp/factory_supervisor`, `gleam/otp/system`, `gleam/otp/supervision`, `gleam/otp/port`. See [`state.md`](state.md). | **Erlang only** |
| [`gleam_javascript`](https://hexdocs.pm/gleam_javascript) | JavaScript/Browser APIs (JS target only): `gleam/javascript/array`, `gleam/javascript/promise`, `gleam/javascript/date`, `fetch`, `WeakMap`, etc. | **JavaScript only** |
| [`gleam_crypto`](https://hexdocs.pm/gleam_crypto) | Cryptography: random bytes, hash functions, HMAC, PBKDF2, AEAD/ciphers via platform primitives. | Both targets |
| [`gleam_fetch`](https://hexdocs.pm/gleam_fetch) | HTTP client on the JS target using the Fetch API (sans-io compatible with `gleam_http`). | **JavaScript only** |
| [`gleam_hackney`](https://hexdocs.pm/gleam_hackney) | HTTP client on Erlang using Hackney. | **Erlang only** |
| [`gleam_httpc`](https://hexdocs.pm/gleam_httpc) | HTTP client on Erlang using the built-in `httpc`. | **Erlang only** |
| [`gleam_elli`](https://hexdocs.pm/gleam_elli) | Run `gleam_http` services on the Elli web server (Erlang). | **Erlang only** |
| [`gleam_hexpm`](https://hexdocs.pm/gleam_hexpm) | Decoders for the Hex package-manager API. | Both targets |
| [`gleam_package_interface`](https://hexdocs.pm/gleam_package_interface) | Work with the JSON package interfaces produced by `gleam export package-interface`. | Both targets |

Common web-service stack on Erlang: `gleam_http` (types) + `gleam_elli` or a
community server (`mist`, `glisten`). On JavaScript: `gleam_http` + `gleam_fetch`,
or `glen`. Decision table for "which HTTP client": pick by target —
Erlang → `gleam_hackney`/`gleam_httpc`; JS → `gleam_fetch`. Keep request
building in `gleam_http` so the code stays portable (sans-io).

## Popular community packages

Not official, but the de-facto ecosystem. Verify the pinned version in
`manifest.toml` before copying any API. Grouped by purpose:

### Web UI (JavaScript frontends)
- **`lustre`** (v5) — the dominant frontend framework: Elm-style `init`/`update`
  (`Model`/`Message`)/`view`, server-side rendering, web components. Modules:
  `lustre`, `lustre/element/html`, `lustre/attribute`, `lustre/event`,
  `lustre/component`, `lustre/effect` (messengers). Add with `gleam add lustre@5`.
- `lustre_ui` — design-token components for Lustre; `lustre_dev_tools` — dev
  server with live reload (needs inotify-tools on Linux).
- `wisp` — a practical, batteries-included **web framework** (Routing, middleware,
  static files) on the Erlang target.
- `glisten` — a shiny TCP/SSL server (WebSockets, HTTP) on Erlang.
- `mist` — a minimal Erlang web server built on `glisten`.
- `glen` — a peaceful web framework targeting JavaScript.
- `plinth` — bindings to Node/browser platform APIs (file system, etc.) for JS.

### Databases & storage
- `sqlight` — SQLite from Gleam (Erlang).
- `squirrel` (or `parrot`) — type-safe SQL (compile-time query checking).
- `pog` — PostgreSQL client (Erlang, based on PGO).
- `mungo` — MongoDB driver.
- `cake` — SQL query builder (PostgreSQL/SQLite/MariaDB/MySQL).
- `simplifile` — cross-target file operations.
- `storail` — simple on-disk JSON data store.

### CLI & environment
- `argv` — cross-platform command-line arguments (used in the official writing
  guide).
- `envoy` — cross-platform environment variables.
- `glint` — command-line option parsing with flags.
- `gleam_community_ansi` — ANSI colours/control codes.
- `filepath` — cross-platform file-path manipulation.

### Testing
- `gleeunit` (by the Gleam creator, effectively standard) — see
  [`testing.md`](testing.md).
- `unitest` — test runner with random ordering, tagging, CLI filtering.
- `birdie` — snapshot testing.
- `testcontainers_gleam` — container-backed integration tests (Erlang).

### Formats, data, & utilities
- `toml` — pure-Gleam TOML parser; `cymbal` — YAML builder; `formal` — typed
  HTML form validation; `commonmark` — CommonMark parser (BEAM + JS).
- `youid` — generate/parse UUIDs.
- `glam` — pretty-print structured data; `glam`/`string_tree`-style helpers.
- `gleam_community_colour`, `gleam_community_maths` — community std flavour for
  colour and math types.

### Rule of thumb

- Prefer the official packages above community ones when both fit
  (`gleam_json` over a JSON parvenu, `gleam_otp` over bespoke actors).
- Prefer packages under the `gleam-lang` or `gleam-community` orgs first, then
  well-maintained community packages, then hand-rolled.
- Always check a package's page on packages.gleam.run (target support, recent
  releases, maintainers) before depending on it.