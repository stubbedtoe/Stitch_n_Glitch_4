# Performance: BEAM and JavaScript

Gleam is fast by default — the BEAM is a battle-tested VM, and most Gleam code
compiles to the same Erlang the ecosystem has tuned for decades. Optimisation is
about *not fighting the runtime*: choosing the right data structures, keeping
recursion tail-safe, and measuring before tuning.

## The mental model

On the Erlang target your code becomes BEAM bytecode; on the JS target it
becomes plain JavaScript. Both favour:

- **Immutability with structural sharing** — a "change" allocates the new spine,
  shares the rest (cheap for lists/records; O(1)-ish updates still cost the
  changed node).
- **Messages/values over shared mutable memory** — no locks; concurrency via
  processes on BEAM, via the event loop on JS.

So most "perf bugs" in Gleam are algorithmic (wrong data structure, accidental
O(n) in a loop) rather than micro-ones.

## Lists: the #1 trap

Gleam lists are singly-linked. **Prepend is O(1), prepend is O(n)-to-append.**

```gleam
// Bad: building a list by appending — O(n²)
let accumulate = fn(items: List(Int)) -> List(Int) {
  list.fold(items, [], fn(acc, x) { list.append(acc, [x]) })
}

// Good: prepend then reverse once
let accumulate = fn(items: List(Int)) -> List(Int) {
  items
  |> list.fold([], fn(acc, x) { [x, ..acc] })
  |> list.reverse
}
```

- Pattern `[head, ..tail]` in recursion is the idiomatic O(n) walk.
- `list.length`, `list.reverse` are natively optimized by the VM.
- Random access by index is O(n) — for VECTOR semantics you need
  `gleam/array`-style packages or `dict`/`set` for membership (see
  [`std-lib.md`](std-lib.md)); `dict.get`/`set.contains` beat linear scans for
  anything beyond tiny lists.

## Recursion and tail calls

The BEAM optimises **tail calls** into loops (constant stack). Non-tail
recursion grows the stack and, on the JS target, is the classic stack-overflow
cause.

```gleam
// Tail-recursive: last call is the recursive call → loop
pub fn length(items: List(a), acc: Int) -> Int {
  case items {
    [] -> acc
    [_, ..rest] -> length(rest, acc + 1)
  }
}
```

Accumulator style (threading `acc`) is the standard way to make recursion tail
on the BEAM. Note the stdlib `list.fold` etc. are already tail-recursive, so
prefer them to hand-rolled loops. Watch out for the stdlib functions documented
as *not* tail-recursive (e.g. `list.fold_right`) when lists are large — they
recursively build then evaluate.

## Strings and binaries

- `string` ops are grapheme-aware and therefore not always O(1): `string.length`,
  `string.slice`, `string.drop_start` all traverse. Avoid calling them inside
  per-item loops.
- Repeated concatenation with `<>` copies; use `gleam/string_tree` (Erlang:
  iolists) for building large strings incrementally, flatten once at the end.
- `BitArray` (`<<…>>`) is the binary type — for bytes, network protocols, file
  I/O. `<<>>` construction/growth is well-supported on the BEAM; use
  `gleam/bytes_tree` for the same rope trick on bytes.

## Choosing data structures (see [`std-lib.md`](std-lib.md) for packages)

| Access pattern | Reach for |
|---|---|
| Walk a whole collection, build results | `List` + `map`/`fold`/`filter` |
| Look up by key often | `gleam/dict` (map) |
| Membership tests / de-dup | `gleam/set` |
| Fixed-size random access, vectors | `gleam/array`-style community package (verify pinned version) |
| Growing strings/binaries | `gleam/string_tree` / `gleam/bytes_tree` |
| Shared counters/caches across processes | OTP actor + in-memory state, or ETS via `gleam_erlang` (confirm ETS API in your pinned `gleam_erlang`) |

## Async / process cost (Erlang target)

- Starting a process is cheap; consuming a message is cheap — but *each actor
  round-trip* is still far more than a function call. Batch reads (a `Get` that
  returns a snapshot) instead of thousands of tiny `Get`s per second.
- Don't ship giant payloads as messages if a shared `dict`/ETS lookup avoids it.
- Actors that need to fan out or backpressure: see
  [`state.md`](state.md) — keep handlers short, offload long work.

## JavaScript target notes

- Beware the ecosystem of unbounded `list.index_*`, `string.drop_*` per-item uses —
  JS never gets the VM shortcuts Erlang has, so big-list algorithms matter most
  here.
- `Dynamic`/decoders reflect the runtime's data (`String` is UTF-16 JS strings).
  Big decode trees on huge payloads can be slow; decode once at the boundary,
  keep typed data downstream.
- Node/Deno/Bun: I/O is fast *async*; don't block the event loop in a loop
  (same rule as any JS).

## Profiling

**Measure first** — guesswork is the usual mistake. On Erlang:

```sh
# gleam shell gives you an Erlang REPL with your modules loaded
gleam shell

# inside the shell or via rebar/escript scripts, use the standard tools:
:eprof.start()
:eprof.profile(fn() -> MyApp.run() end)
:eprof.analyze()
```

`:fprof` for function-level profiling, and observing `reductions` in
`:erlang.statistics` / observer for process load. The community `spectator`
package gives a BEAM observer-style UI.

On JavaScript: Node's `--cpu-prof`/`--heap-prof` and the devtools profiler
(Chrome) against a `--target javascript` build; keep the same "profile release
builds" rule.

## Budgets and habits

- Prefer algorithmic fixes (data structure / redundant work) over micro-tweaks.
- One-hot reads: a `set`/`dict` membership check replaces a `list.contains` scan.
- **Avoid repeated `length`/`slice`/`reverse` in loops** (halve the work with a
  fold-that-carries-index, e.g. `list.index_fold`).
- Reuse/immutability means allocation is cheap but not free — don't rebuild the
  same derived value (sorted list, joined string) on every call; compute once
  and pass down.
- Write the naive correct version first. Profile. Optimise only the measured hot
  spot, then re-profile.