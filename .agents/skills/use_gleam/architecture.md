# Architecture: modules, layers, functional core

How to structure Gleam code so it scales from script to product. Built on the
official conventions doc (gleam.run/documentation/conventions-patterns-and-anti-patterns)
— those rules are authoritative and repeated here for agent use.

## Module layout

Gleam has a **global module namespace** (inherited from the BEAM): two packages
defining the same module name collide and fail to compile. Therefore:

- Put your modules inside a directory named after the package: package `my_app`
  uses `src/my_app/…`. Do **not** drop modules like `distribution.gleam` at the
  top of `src/`.
- Never place modules inside someone else's top-level directory (no
  `src/lustre/…` in a package you don't own). "Namespace trespassing" is
  prohibited — the owners may reuse that dir.
- Name modules **singular** (`app/user`, `app/payment/invoice` — not
  `app/users`).
- If several modules are needed for one domain concept, consider whether one
  well-designed module would do — *fragmented modules* are an anti-pattern
  (especially common in AI-generated code).

Organise by **business domain**, never by design pattern or technical kind:

```text
src/my_app/
├── account.gleam          # account domain: types, functions
├── billing.gleam          # invoice domain
├── stock.gleam            # inventory domain
└── ...
```

```text
# Anti-pattern: grouping by pattern / kind
src/controllers/user_controller.gleam
src/decorator/user_decorator.gleam
src/models/user_model.gleam      # ❌ design-pattern/modelling grouping
src/constants/…
src/utilities/…
```

## Layered architecture

Keep a *functional core* separated from *effects*:

```text
domain       pure types + decision logic, no I/O           ← depends on nothing
application  orchestrates domain with services (sans-io)   ← depends on domain
interface    I/O: HTTP handlers, CLI, file access, ffi     ← depends on application
```

Dependencies point **inward** (toward pure domain). Every layer beneath a
module is still pure Gleam: the only real I/O points are `glam/io`-style
stdlib/FFI calls, which stay at the boundary.

```gleam
// src/my_app/domain/invoice.gleam — pure logic, no io, testable anywhere
pub type Invoice {
  Invoice(line_items: List(LineItem))
}

pub fn total(invoice: Invoice) -> Int {
  list.fold(invoice.line_items, 0, fn(acc, item) { acc + item.price })
}
```

## The sans-io pattern

For any code that touches the outside world (HTTP, files, sockets), split each
operation into a *pure builder* + *pure parser*, and hand the I/O to the caller
(official recommended pattern). This is how a library stays usable on **both
targets** and inside any framework.

```gleam
import gleam/http/request.{type Request}
import gleam/http/response.{type Response}

/// Build the request — pure data, no I/O.
pub fn create_user_request(name: String) -> Request(String) {
  request.new()
  |> request.set_method(Post)
  |> request.set_host("example.com")
  |> request.set_body(json.to_string(json.object([#("name", name)])))
  |> request.prepend_header("content-type", "application/json")
}

/// Parse the response — pure data, no I/O.
pub fn create_user_response(response: Response(String)) -> Result(User, ApiError) {
  case response.status {
    201 -> Ok(User(name: response.body))
    409 -> Error(UserNameAlreadyInUse)
    429 -> Error(RateLimitWasHit)
    code -> Error(GotUnexpectedResponse(code))
  }
}
```

The user (a server, a CLI, a Lustre app) sends the request and feeds the
response back in — you never depend on a concrete HTTP client or a Promise vs
Erlang-term representation. See the request/response types in
[`std-lib.md`](std-lib.md) (`gleam_http`).

## Internal modules

Modules named `<package>/internal` and `<package>/internal/*` are "private" —
usable by your package but not part of the public API, not documented, no
stability promises. Use them to share code between `src/` and `test/` without
public-API leakage (the official writing guide moves helper functions here so
tests can import them).

```gleam
// src/vars/internal.gleam
pub fn format_pair(name: String, value: String) -> String {
  name <> "=" <> value
}
```

`src/` can import dependencies, `src/`, and `src/<pkg>/internal`; it cannot
import `test/`, `dev/`, or dev-dependencies.

## Types as documentation

Model your domain with custom types so invalid states are impossible and the
compiler enforces your rules:

```gleam
// Bad: three implicit states, one of which is invalid (id without email …)
pub type Visitor {
  Visitor(id: Option(Int), email: Option(String))
}

// Good: compiler only allows the two real states
pub type Visitor {
  LoggedInUser(id: Int, email: String)
  Guest
}
```

Replace bools with descriptive custom types (`role: Role` with `Student`/
`Teacher`, never two unrelated bools). Name errors with descriptive variant
payloads (see [`state.md`](state.md) and the conventions doc).

## Naming conventions (enforced style)

- `snake_case` for variables, constants, functions; `PascalCase` for types and
  variants (compiler + formatter enforce most of this).
- **No abbreviations** — `capacity`, `offset`, `continuation`, never `cap`,
  `off`, `cnt`.
- Acronyms are single words: `json`, `html`, `base64` — not `JSON`, `HTM`ML`.
- Conversion functions: `x_to_y` (`json_to_string`, `date_to_rfc3339`); when the
  module name matches the type, drop the repeat: module `identifier`,
  function `to_string(id: Identifier)`.
- Fallible-style names: domain-appropriate (`parse_json`, `enqueue`); a
  special early-return result-handling version of a function may use `try_`
  (`try_map`) — never abstract names like `monadic_bind`.
- All function args and returns annotated (the formatter warns on missing).

## Anti-patterns to flag (from the official doc)

- **Abbreviations** — always write names in full.
- **Fragmented modules** — splitting a cohesive module into many tiny ones to
  "organise"; prefer fewer, well-designed modules.
- **Global namespace pollution / namespace trespassing** — modules outside the
  package dir, or inside another package's dir.
- **Grouping by design pattern** — `controllers/`, `services/`, `utilities/`
  as module boundaries (`app/stock`, `app/billing` instead).
- **Check-then-assert** — `if result.is_ok(data) { … let assert Ok(x) = data }`;
  use `case` or `result.try`/`result.map` so the compiler connects checking and
  use.
- **Using `dynamic` for FFI types** — don't type FFI boundaries as
  `Dynamic`; define an opaque type so wrong values are caught at the Gleam
  boundary instead of at runtime.
- **`panic`/`let assert` in libraries** — libraries must not panic. Return
  `Result`. (One exception: libraries *about* OTP, where supervision needs a
  crash to restart.)
- **Match-all catch-all clauses** as a habit — `case x { A -> …; _ -> … }`
  silently stops the compiler from guiding you when variants grow; enumerate
  variants.
- **Category-theory overuse** — no fancy generic abstractions; solve specific
  problems with specific code. Gleam is deliberately concrete.

## Project-scale guidance

- **Small (script / single module)** — one module, pure core + boundary
  functions.
- **Medium (a package)** — `src/<package>/` domain modules + `internal` +
  thin interface; add `test/` modules per domain (see
  [`testing.md`](testing.md)).
- **Large (many packages / apps)** — multi-package workspaces, one package per
  domain, an explicit `interface`/`web` package for HTTP (e.g. wisp/mist), and
  OTP supervision at the app root (Erlang target). See
  [`state.md`](state.md) for the process architecture.