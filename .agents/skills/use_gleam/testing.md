# Testing Gleam

The default test runner is **`gleeunit`** (created by `gleam new`). It runs on
both targets: `gleam test` (Erlang) or `gleam test --target javascript`
(JS, Node by default).

> Verify exact helper names against your pinned `gleeunit`. Everything below
> uses the v1 API that `gleam new` scaffolds.

## The shape of a test file

`gleam test` runs the `main` function of `<package>_test` (e.g. `my_project_test`).
Any **public function whose name ends in `_test`** is run as a test.

```gleam
// test/my_project_test.gleam
import gleeunit
import my_project

pub fn main() {
  gleeunit.main()
}

pub fn greet_test() {
  assert my_project.greet("Gleam") == "Hello, Gleam!"
}
```

- Tests `assert` on equality; a failing `assert` fails the test.
- Keep each test independent — no shared mutable state (there is none anyway:
  values are immutable).
- `gleam test` runs the whole module; individual filtering and ordering are
  handled by runner options in `gleeunit`/`gleam test` across versions — check
  the CLI (`gleam test --help`) rather than guessing flags.

## Testing internals without exposing them

Public API functions are importable from tests. To test helpers that are part of
the implementation (not the public API), keep them importable-but-internal via
the `<package>/internal` module:

```gleam
// src/my_project/internal.gleam
pub fn format_pair(name: String, value: String) -> String {
  name <> "=" <> value
}
```

```gleam
// test/my_project_test.gleam
import gleeunit
import my_project/internal

pub fn main() {
  gleeunit.main()
}

pub fn format_pair_test() {
  assert internal.format_pair("hello", "world") == "hello=world"
}
```

Internal modules are not part of the public API or docs, but `test/` can import
them. This is the sanctioned way to test non-exported logic without
`@internal` abuse.

## Testing with the source-directory rules

- `test/` may import from `src/`, `dev/`, and **all** dependencies
  (including dev-dependencies).
- `src/` may **not** import from `test/` or dev `test/` — keep tests out of the
  library itself.
- `dev/` is for development tooling (scripts, code generators), not tests.

## Testing state and actors

**Pure logic** — test functions that take/return state:

```gleam
import gleam/list
import gleeunit
import my_project
import my_project/internal

pub fn main() {
  gleeunit.main()
}

pub fn increment_test() {
  let start = my_project.new()
  let result =
    list.fold([1, 2, 3], start, fn(cart, _) { my_project.add_item(cart, "x", 10) })
  assert result.total == 30
}

pub fn decrement_at_zero_test() {
  let c = my_project.decrement(my_project.new())  // returns Result
  assert c == Error(Nil)
}
```

**Actors** — keep handlers thin over a pure transition function, and test the
pure function directly (no process):

```gleam
import gleeunit
import my_project

pub fn main() {
  gleeunit.main()
}

// my_project exposes the pure state-transition logic the handler calls:
//
//   pub fn apply(state: Int, message: Message) -> Result(Int, Nil) {
//     case message {
//       Add(i) -> Ok(state + i)
//       Dec if state > 0 -> Ok(state - 1)
//       Dec -> Error(AlreadyAtZero)
//     }
//   }

pub fn apply_test() {
  assert my_project.apply(0, Add(5)) == Ok(5)
  assert my_project.apply(0, Dec) == Error(AlreadyAtZero)
}
```

`actor.Next` is opaque, so the pattern is: put the state transition in a pure
`apply(state, message)` function, have the handler call it and wrap the result
in `actor.continue(state)` / `actor.stop()`. Test `apply`. See
[`state.md`](state.md).

## Integration / containers (Erlang target)

For services that need Postgres, Redis, etc., community packages wrap
Testcontainers (e.g. `testcontainers_gleam`) — spin real deps in Docker for
`test/` integration tests. This keeps `src/` free of test scaffolding.

## Property and randomised testing

For invariants, community property-testing packages exist (check
packages.gleam.run, and confirm the pinned version). The pattern with gleeunit:
generate inputs, call your pure function, `assert` the invariant holds for each
sample. Because Gleam values are immutable and functions are pure, this works
with zero special machinery.

## What to assert

- **Domain logic**: pure function results, invariants, error cases — exhaustively
  (`[]`, one item, many, empty-input edge).
- **Decoders**: feed crafted `Dynamic` values through your decoder and assert on
  the decoded record / error (see [`std-lib.md`](std-lib.md) `dynamic/decode`).
- **Bounds**: no negative totals, no missing required fields, quotas — test the
  boundaries your types *say* they enforce.
- **Don't** assert on formatting/styling or incidental ordering (dicts, sets are
  unordered — no order assertions).

## CI

`gleam new` generates `.github/workflows/test.yml` (installs Gleam + Erlang,
runs `gleam test`). Add `gleam format --check` and `gleam build --warnings-as-errors`
to CI to keep the codebase uniformly formatted and warning-free.