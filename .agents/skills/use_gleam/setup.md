# Setup: toolchain, project scaffold, structure

Getting a Gleam project compiling and running.

## Toolchain

You need the `gleam` command-line tool, plus a runtime for the target you
compile to:

- **Erlang target (default)** — Erlang/OTP (the stdlib documents support for
  OTP 26+).
- **JavaScript target** — Node.js (default runtime), or Deno/Bun (`gleam run
  --runtime deno`, `gleam run --runtime bun`).

Install `gleam` with your OS package manager or a version manager — see
https://gleam.run/install for the exact per-OS command (macOS Homebrew
`brew install gleam`, asdf, or the prebuilt binaries).

Check everything with:

```sh
gleam --version
erl -version        # Erlang target only
node --version      # JavaScript target only
```

## Creating a project

```sh
gleam new my_project
cd my_project
```

This creates *a Gleam package*:

```
my_project/
├── .github/workflows/test.yml   # CI that runs `gleam test`
├── .gitignore
├── README.md
├── gleam.toml
├── manifest.toml                # locked dependency versions (commit this)
├── src/
│   └── my_project.gleam         # must hold `pub fn main()` to be runnable
└── test/
    └── my_project_test.gleam    # test runner entry point
```

- `gleam new gleam-my-project --name my_project` lets the directory name differ
  from the package name.
- `gleam new --template javascript` pre-configure the JavaScript target.
- `gleam new --skip-github` skips the `.github/` directory.

The three source directories and their import rules:

- `src/` — the package itself; may import from dependencies and `src/` only.
- `test/` — tests; may import anything.
- `dev/` — development tooling (code generators, helper scripts); may import
  anything.

## Running

```sh
gleam run                  # run main() in the package-named module
gleam run -m other/module  # run a different module's main
gleam run --target javascript    # compile + run on Node (use deno/bun via --runtime)
```

## gleam.toml

Generated roughly as:

```toml
name = "my_project"
version = "1.0.0"

[dependencies]
gleam_stdlib = ">= 1.0.0 and < 2.0.0"

[dev_dependencies]
gleeunit = ">= 1.0.0 and < 2.0.0"
```

- Version constraints are ranges (`">= 1.0.0 and < 2.0.0"`); Hex uses semantic
  versioning.
- `gleam add <package>@<major>` adds a dependency with the right constraint
  (`gleam add gleam_otp@1`); `gleam add --dev wibble` adds a dev dependency;
  `gleam remove` removes.
- `manifest.toml` locks exact versions. **Commit it.** Update with
  `gleam deps update` (or `gleam update`).
- Path and git dependencies are supported in `gleam.toml`:

```toml
[dependencies]
my_other_package = { path = "../my_other_package" }
my_library = { git = "git@github.com:my-project/my-library", ref = "a8b3c5d82" }
```

- JavaScript target configuration:

```toml
target = "javascript"

[javascript]
runtime = "nodejs"   # nodejs | deno | bun
```

- Tool config for other tools goes under `[tools.$TOOL_NAME]` (e.g. a lustre dev
  server), not in separate config files — see the conventions doc.

## Everyday commands

| Command | What it does |
|---|---|
| `gleam build` | Compile (download + compile deps). `--target javascript`, `--warnings-as-errors` for CI. |
| `gleam check` | Type-check only, no codegen — fast in-development validity check. |
| `gleam run` | Build and run (see flags above). |
| `gleam test` | Run the test module (`my_project_test`) — see [`testing.md`](testing.md). |
| `gleam format` | The canonical formatter. `gleam format --check` is the CI gate. **Always run it before finishing.** |
| `gleam add` / `gleam remove` | Manage dependencies. |
| `gleam deps update` / `gleam deps outdated` / `gleam deps tree` | Dependency bookkeeping. |
| `gleam docs build` | Build HTML docs from your code documentation (`--open` to view). |
| `gleam export escript` | Bundle (Erlang target) into a single runnable file `./my_project`. |
| `gleam export erlang-shipment` | Erlang target: deployable directory of bytecode + config + start script. |
| `gleam shell` | Erlang REPL with your package loaded (Erlang syntax, not Gleam). |
| `gleam clean` | Remove build artefacts. |
| `gleam dev` | Run the `my_project_dev` dev module (for dev tooling). |

## .gitignore

`gleam new` provides one. At minimum:

```gitignore
/build/
/deps/
*.beam
```

Do **not** ignore `manifest.toml` — it should be committed.

## Next steps

- First module, types, and pattern matching: see [`fundamentals.md`](fundamentals.md).
- Choosing packages and the standard library: see [`std-lib.md`](std-lib.md).
- State, actors (Erlang target): see [`state.md`](state.md).