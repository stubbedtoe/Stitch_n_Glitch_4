# Reviewing Gleam code

A structured pass for idiomatic, correct, and fast Gleam. Run this checklist
when asked to review a Gleam change or codebase; report findings in the format
at the bottom.

Start from [`fundamentals.md`](fundamentals.md) and
[`architecture.md`](architecture.md) — both encode the official conventions this
checklist applies.

## Scope & discovery

- Find `.gleam` files (`glob "**/*.gleam"`), plus `gleam.toml`/`manifest.toml`
  for the pinned target and dependency versions (`gleam_stdlib` v1, `gleam_otp`
  v1, `lustre` v5, …).
- Categorise: pure-domain modules, interface/IO modules, internalhelpers,
  tests, `main` entry points.
- Note the target(s) (`gleam.toml` `target` key) — a single-target package must
  not be reviewed as if it runs everywhere.

## Language & idioms

- [ ] Functions imported **qualified**; no `import gleam/list.{map}` style
  imports of functions/constants
- [ ] All function arguments **and return types** annotated
- [ ] Fallible functions return **`Result`**, never `Option` or a `panic`;
      `Option` only for genuinely-optional inputs/fields
- [ ] `case` handles each custom-type variant explicitly; no casual catch-all
      `_` that would hide future variants
- [ ] No **check-then-assert** (`if result.is_ok(x) { … let assert Ok(v) = x … }`;
      use `case`/`result.try`/`result.map`)
- [ ] No bool flags growing in records — custom types instead
      (`role: Student | Teacher`, not `is_student: Bool`)
- [ ] Records built/updated with `..` spread; record accessors used for reads
- [ ] No `todo as "…"` left in place; `panic`/`let assert` only at top-level
      application boundaries, never in libraries
- [ ] Pipes (`|>`) used rather than deeply nested calls, but not over-shaken

## Correctness & error handling

- [ ] `list.append(...)` not building lists in a loop (prepend-and-reverse);
      `string.length`/`slice`/`drop_*` not called per-item
- [ ] Recursion tail-safe (accumulator style) or the stdlib fold used — no
      unbounded stack growth on the JS target
- [ ] Decoders (see [`std-lib.md`](std-lib.md) `dynamic/decode`) cover every
      unknown-shape path; `decode.run` errors handled, not swallowed
- [ ] Integer/float division edge cases known (zero divisor returns `Error` from
      `int.divide`/`modulo`; plain `/` returns `0`) — code doesn't assume a crash
- [ ] Error types are descriptive custom types, not `Int`/bare strings

## Libraries & packaging

- [ ] No panics, no `let assert` (the OTP-library exception is justified if so)
- [ ] Modules live inside `src/<package>/`; no top-level `src/foo.gleam`
      namespace pollution, no namespace trespassing
- [ ] Module names singular; acronyms as single words (`json`, not `JSON`);
      no abbreviations in identifiers
- [ ] `x_to_y` / `try_` naming used appropriately; no pattern-style names
      (`monadic_bind`, `user_controller`)
- [ ] Public API minimal: only what's documented is exported; internals in
      `src/<package>/internal`
- [ ] Valid states encoded in types; invalid states impossible (no
      `Visitor(id: Some(1), email: None)` shapes)
- [ ] Sans-io respected where I/O is involved (pure request/response functions;
      caller sends) — the same library is usable on both targets
- [ ] Package choice follows [`std-lib.md`](std-lib.md): official `gleam-lang`
      packages preferred over community/wheel-reinvention

## State & concurrency (see [`state.md`](state.md))

- [ ] Pure threading used by default; actors only where shared/concurrent state
      or supervision is genuinely needed
- [ ] Actor handlers are pure `fn(state, message) -> Next(state, message)` and
      total; state-transition logic extracted into testable pure functions
- [ ] No actor started where a function call would do; no blocking long work
      inside a handler; no module-level mutable-state impostors
- [ ] Supervised services use `static_supervisor`/`factory_supervisor` child
      specs correctly (verified against the pinned `gleam_otp` docs)

## Targets

- [ ] No claim that a module runs on both targets unless all its imports do
      (`gleam_erlang`, `gleam_otp`, `gleam_fetch`, `glisten`… are single-target)
- [ ] No `Dynamic`-in-FFI typing antipattern; opaque types at FFI boundaries
- [ ] If it must be cross-target, check `gleam/test`/`build` against both targets
      in review

## Formatting & housekeeping

- [ ] `gleam format --check` clean (the formatter owns all whitespace/style)
- [ ] `manifest.toml` committed; version constraints are ranges (`>= 1 and < 2`)
- [ ] `gleam build --warnings-as-errors` passes; no compiler warnings ignored

## Report format

For each issue:

```text
src/my_app/invoice.gleam:32   ❌ [Critical] Non-tail recursion

Problem:  sum() recurses after the +, so large lists grow the stack
          (worst on the JS target).
Fix:      Carry an accumulator:
          fn do_sum(xs, acc) { case xs { [] -> acc
                            [h, ..t] -> do_sum(t, acc + h) } }
```

Severity guide: **Critical** (incorrect behaviour, crash, security) ·
**High** (perf or correctness risk) · **Medium** (convention/idiom) ·
**Low** (style/docs).

End with a summary: files reviewed, issues by severity, top 3 fixes to make
first, and the **patterns to keep** (e.g. "good sans-io split in the HTTP
client", "decoders cover all variants", "handlers are pure and unit-tested").