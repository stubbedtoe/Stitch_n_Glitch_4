---
name: use_gleam
description: Write, debug, and review Gleam code — a functional programming language that compiles to Erlang and JavaScript and runs on the BEAM. Use when the user is writing or reviewing Gleam modules — types and custom types, records and record updates, pattern matching and case expressions, pipelines, Result and Option handling, recursion, closures and higher-order functions, use-combinators, imports and module layout, pure-functional state threading, OTP actors and supervisors (gleam_otp), the standard library and ecosystem packages (gleam_stdlib, gleam_json, gleam_http, gleam_erlang, lustre, glisten, wisp), testing with gleeunit, the gleam CLI (gleam new, add, build, run, test, format, export), or the Erlang versus JavaScript targets — or when the user mentions Gleam, gleam_otp, gleeunit, lustre, or functional programming on the BEAM.
---

# Gleam Skill

Guidance for writing, reviewing, and tuning Gleam code. Gleam is a statically
typed functional programming language that compiles to Erlang and JavaScript
and runs on the BEAM (the Erlang virtual machine). This directory is split into
focused topic files; read the one(s) that match the task at hand instead of
this whole file.

## Verification rule (read first)

All code in these files is checked against the official Gleam sources:

- The language tour: [tour.gleam.run](https://tour.gleam.run) (the Gleam v1 language).
- The docs site: [gleam.run/documentation](https://gleam.run/documentation)
  (install guide, writing guide, command-line reference, conventions/patterns/anti-patterns,
  `gleam.toml` reference).
- HexDocs for the pinned package versions: `gleam_stdlib` v1, `gleam_otp` v1,
  `gleeunit` v1, `lustre` v5.

If a snippet depends on a third-party package, confirm the exact API against
the version actually in the user's `manifest.toml` (Gleam's lockfile) before
copying. **Never emit unverified APIs.**

## Two targets (mental model)

Gleam does not choose one runtime: your modules compile to **Erlang** (default;
runs on the BEAM, OTP 26+) and to **JavaScript** (Node, Deno, Bun, browsers).
Write once, compile to both.

- Default target is Erlang; set `target = "javascript"` in `gleam.toml` or pass
  `--target javascript` to pick JS (see [`setup.md`](setup.md)).
- Most of the stdlib is cross-target. Watch for the documented differences:
  `gleam/dynamic` representations (Erlang terms vs JS values), `gleam/io`
  behaviour, and packages that are explicitly single-target (e.g. server
  libraries like `glisten` or `mist`).
- Never claim a package works on both targets unless its docs say so. The sans-io
  pattern from [`architecture.md`](architecture.md) exists precisely to keep
  libraries target-agnostic.

## Topic index

| When the user asks about… | Read |
|---|---|
| Toolchain, installing Gleam/Erlang/Node, `gleam new`, project layout, `gleam.toml`, build/run/test/format commands, escripts | [`setup.md`](setup.md) |
| The language: modules & imports, functions, custom types, records & updates, pattern matching, `case`, pipelines, Result/Option, recursion & tail calls, `use`, full examples | [`fundamentals.md`](fundamentals.md) |
| What the standard library offers, which official `gleam-lang` packages exist, and the popular community ecosystem (lustre, glisten, wisp, …) | [`std-lib.md`](std-lib.md) |
| State, actors, `gleam_otp`, superstors, processes, pure-functional state threading | [`state.md`](state.md) |
| Project structure, layers, functional core / sans-io, module boundaries, naming, anti-patterns | [`architecture.md`](architecture.md) |
| BEAM/JS performance, recursion, efficient data structures, profiling | [`performance.md`](performance.md) |
| Testing modules with `gleeunit` on either target | [`testing.md`](testing.md) |
| Reviewing Gleam code (idiomaticity, exhaustiveness, correctness) | [`review.md`](review.md) |

## How to use

1. Identify the task category and read the matching file(s). A task like
   "build an HTTP server" usually needs `std-lib.md` (choose the package) +
   `state.md` (actors); "why is my loop slow" needs `performance.md`.
2. Follow the code patterns exactly as written — they use the current, verified
   Gleam API. Snippets are complete: imports included, `pub fn` with all type
   annotations.
3. When a snippet depends on a pinned dependency version (actors, Lustre
   components), verify against the user's `manifest.toml` before copying.

## Working style

- Show complete, runnable examples (imports included), then explain.
- Point out Gleam pitfalls proactively: an unhandled `case` clause, non-tail
  recursion, panicking in a library, unqualified imports, `panic`/`let assert`
  where a `Result` belongs.
- If a snippet uses an older API form, normalize to v1.x (see [`fundamentals.md`](fundamentals.md))
  rather than guessing.
- When behaviour depends on the target (Erlang vs JS), say so explicitly and
  verify against the docs rather than assuming parity.