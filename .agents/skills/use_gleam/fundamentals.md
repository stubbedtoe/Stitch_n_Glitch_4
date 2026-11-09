# Fundamentals: modules, types, functions, pattern matching

The core of the Gleam language. Read [`setup.md`](setup.md) first if the project
isn't compiling, and [`std-lib.md`](std-lib.md) when you need to know which
stdlib module has what. Every snippet below is verifiable against the tour
(tour.gleam.run) and the `gleam_stdlib` v1 docs.

## Big picture

Gleam is a **statically typed, pure-functional** language that compiles to
Erlang and JavaScript.

- Everything is an **expression** — there are no statements, no loops, no null.
- Values are **immutable**; functions take values and return new values.
- State is **explicit**: pass it in, get a new copy out (see
  [`state.md`](state.md)).
- No `null` and no exceptions: fallible functions return `Result`; optional
  values are `Option`.
- Recursion replaces loops; the BEAM optimises tail calls into loops
  ([`performance.md`](performance.md)).

## Modules and imports

A module is one `.gleam` file. The package's main module is named after the
package.

```gleam
// src/hello.gleam
import gleam/io

pub fn main() {
  io.println("Hello, Gleam!")
}
```

**Functions are always imported qualified** (qualified imports of functions and
constants is the documented convention):

```gleam
import gleam/list
import gleam/string

pub fn reverse(input: String) -> String {
  input
  |> string.to_graphemes
  |> list.reverse
  |> string.concat
}
```

Types *may* be imported unqualified; record constructors may too:

```gleam
import gleam/dict.{type Dict, type Key}

pub fn insert_into(dict: Dict(String, Int), key: String, value: Int) -> Dict(String, Int) {
  dict.insert(dict, key, value)
}
```

All module functions are annotated — arguments and return type:

```gleam
fn calculate_total(amounts: List(Int), service_charge: Int) -> Int {
  int.sum(amounts) * service_charge
}
```

## Literals and operators

```gleam
let integer = 42
let negative = -1
let float = 3.14
let string = "double quotes only"          // single quotes are chars, stay away
let bool = True                            // True / False — capitalised
let nothing = Nil                          // the unit type, like () in ML-ish languages

// Concatenate strings with <>
let combined = "a" <> "b"

// Ints: + - * / ; floats need the dotted operators: +. -. *.
let f = 3.0 +. 1.5
```

## Binding values

`let` binds an immutable value:

```gleam
let age = 30
let name = "Lucy"
let #(first, second) = #(1, 2)  // destructuring a tuple
```

Discard things you don't want by naming them `_` (or prefixing `_name`):

```gleam
let _ = expensive_call()
let _unused_but_named = 1
```

## Functions

### Named functions

```gleam
pub fn greeting(name: String) -> String {
  "Hello, " <> name <> "!"
}
```

### Anonymous functions

```gleam
let double = fn(x: Int) -> Int { x * 2 }
let doubled = double(4)   // 8
```

### Function captures

Build a function using a placeholder argument:

```gleam
let add_two = int.add(_, 2)   // fn(Int) -> Int, adds 2
```

### Higher order functions

```gleam
import gleam/list

pub fn double_all(numbers: List(Int)) -> List(Int) {
  list.map(numbers, fn(x) { x * 2 })
}
```

`list.map`, `list.filter`, `list.fold`, etc. take functions as arguments — this
is how you iterate instead of writing loops.

### Generic functions

```gleam
pub fn first_of_pair(pair: #(a, b)) -> a {
  pair.0
}
```

### Labelled arguments

Arguments can be labelled for clarity and are then usable either positionally or
by label — including in a "label shorthand" when the argument name matches the
record field:

```gleam
pub type User {
  User(name: String, age: Int)
}

// Labelled arguments:
pub fn make_user(name name: String, age age: Int) -> User {
  // label shorthand: `name:` is `name: name`
  User(name: name, age: age)
}

// positional and labelled calls are equivalent:
let a = make_user("Lucy", 30)
let b = make_user(name: "Lucy", age: 30)

// record construction also supports shorthand when a matching variable exists:
pub fn make_user_from(name: String, age: Int) -> User {
  User(name:, age:)
}
```

## Pipelines

`|>` threads a value through functions (value becomes the **last** argument —
or a labelled argument if you label it):

```gleam
import gleam/string

pub fn slugify(title: String) -> String {
  title
  |> string.lowercase
  |> string.replace(each: " ", with: "-")
  |> string.trim
}
```

Pipelines are the idiomatic Gleam way to compose transformations; prefer them
over deeply nested calls.

## Custom types and records

Custom types are the way to model your domain (there are no classes; this is
data plus functions over it).

```gleam
pub type User {
  User(name: String, age: Int)    // a record variant
  Guest                           // a unit variant (like an enum case)
}

let admin = User("Lucy", 30)
let guest = Guest
```

Types are exhaustive in `case` — each variant can carry different fields:

```gleam
pub type Shape {
  Circle(radius: Float)
  Rectangle(width: Float, height: Float)
}

pub fn area(shape: Shape) -> Float {
  case shape {
    Circle(radius) -> 3.14159 *. radius *. radius
    Rectangle(width: w, height: h) -> w *. h
  }
}
```

### Generic custom types

```gleam
pub type Box(a) {
  Box(a)
  Empty
}
```

### Opaque types

Force construction through your functions (validation, invariants, builders):

```gleam
pub opaque type Percentage {
  Percentage(Int)
}

pub fn percent(value: Int) -> Result(Percentage, Nil) {
  case value < 0 || value > 100 {
    True -> Error(Nil)
    False -> Ok(Percentage(value))
  }
}
```

Consumers can pattern match or update a `Percentage`? No — outside the module
they can only use the functions you export. This is how you "make invalid states
impossible" (see [`architecture.md`](architecture.md)).

## Record accessors

`record.field` reads a field; pattern matching destructures:

```gleam
let user = User("Lucy", 30)
let the_name = user.name          // "Lucy"

case user {
  User(name: n, ..) -> n
}
```

## Record updates

Immutable updates copy the record changing only the given fields. For a
single-variant record this is direct; for a multi-variant type the compiler
needs a `case` to know which variant you're updating (a bare `User(..user, …)`
fails with "unsafe record update"):

```gleam
pub type Draft {
  Draft(title: String, body: String, published: Bool)
}

pub fn retitle(draft: Draft, new_title: String) -> Draft {
  Draft(..draft, title: new_title)
}

// Multi-variant: route through a case first
pub fn rename(user: User, new_name: String) -> User {
  case user {
    User(..) -> User(..user, name: new_name)
    Guest -> Guest
  }
}
```

## case expressions

`case` is Gleam's flow control: pattern matching + guards + exhaustiveness.

```gleam
pub fn describe(result: Result(Int, Nil)) -> String {
  case result {
    Ok(n) -> "Got " <> int.to_string(n)
    Error(Nil) -> "Nothing"
  }
}
```

```gleam
case int.remainder(n, 2) {
  Ok(0) -> "even"
  Ok(_) -> "odd"
  Error(_) -> "no parity"
}
```

### Guards

Narrow a pattern *without* binding new variables:

```gleam
case temperature {
  t if t < 0 -> "freezing"
  t if t < 20 -> "cold"
  _ -> "warm"
}
```

### Alternative patterns

Several patterns can branch to the same clause:

```gleam
case value {
  "a" | "b" -> "letter"
  _ -> "not a letter"
}
```

Multiple subjects can be matched on together (comma-separated subjects — this
is the current idiom; a `case #(a, b)` tuple works but the compiler suggests
removing the wrapper):

```gleam
case user, is_admin {
  User(..), True -> "admin user"
  User(..), False -> "regular user"
  Guest, _ -> "guest"
}
```

Lists support head/tail patterns:

```gleam
case list {
  [] -> "empty"
  [only] -> "one element"
  [first, second, ..rest] -> "two or more"
}
```

**Always handle every variant.** Gleam does not allow catch-all `_` as your main
clause when you can enumerate the variants — or rather, you *shouldn't* use it as
one. Prefer matching all variants explicitly so the compiler guides you through
refactors (see the anti-patterns in [`architecture.md`](architecture.md)).

## Recursion and tail calls

No loops — recurse. On the BEAM, a tail-call becomes a loop (constant stack):

```gleam
pub fn sum(numbers: List(Int)) -> Int {
  case numbers {
    [] -> 0
    [head, ..tail] -> head + sum(tail)
  }
}
```

`[head, ..tail]` recursion is the standard way to walk a list. Add an *accumulator
parameter* to make it tail-recursive (the recursive call is the last thing
evaluated, so no stack grows):

```gleam
pub fn sum(numbers: List(Int)) -> Int {
  do_sum(numbers, 0)
}

fn do_sum(numbers: List(Int), acc: Int) -> Int {
  case numbers {
    [] -> acc
    [head, ..tail] -> do_sum(tail, acc + head)
  }
}
```

## Result and Option

- **`Result(a, e)`** is `Ok(a)` or `Error(e)` — the return type of every
  fallible function. Use `Nil` as the error type when there's nothing to say.
- **`Option(a)`** is `Some(a)` or `None` — for *optional inputs and fields*, not
  for fallibility. Follow the conventions: a function that can fail returns
  `Result`, never `Option` and never a panic.

```gleam
// Good — fallible
pub fn first(list: List(a)) -> Result(a, Nil) {
  case list {
    [item, ..] -> Ok(item)
    _ -> Error(Nil)
  }
}
```

Prefer the combinators over nested cases (`result.map`, `result.try`,
`result.unwrap`, `result.lazy_or` — see [`std-lib.md`](std-lib.md)):

```gleam
import gleam/result

fn parse_port() -> Result(String, Nil) {
  Ok("8080")
}

let value = parse_port() |> result.unwrap(or: "8080")
```

### `use` — monadic flow without nesting

`use` lets you write `case`-style early-return chains in a block form. It's sugar
for nested anonymous functions — most common with `result.try`:

```gleam
import gleam/result

pub fn load_config() -> Result(Config, Nil) {
  use name <- result.try(fetch_name())
  use port <- result.try(fetch_port())
  Ok(Config(name:, port:))
}
```

The function passed to `use` is called with the extracted value(s); the block
continues with them in scope. This is the idiomatic way to write multi-step
fallible logic. (`result.try`'s function takes the unwrapped value and returns a
new result.)

The stdlib `bool.guard` gives you a "return early" form — `use` automatically
supplies the `otherwise` callback with the rest of the block:

```gleam
import gleam/bool

pub fn maybe_run(flag: Bool) -> Nil {
  use <- bool.guard(when: flag == False, return: Nil)
  io.println("flag is set")
}
```

## let assert, panic, todo

- `let assert Ok(x) = expr` — binder that crashes if the pattern doesn't match.
  Use only at the *top level of application code* where failure is truly
  impossible (e.g. `let assert Ok(_) = lustre.start(...)`). **Never in a
  library** (see [`architecture.md`](architecture.md)).
- `panic as "message"` — immediate crash with a message; same rules apply.
- `todo as "message"` — compile successfully but crash at runtime if reached;
  great while sketching, must be removed before shipping.

## A complete example

A counter that never goes negative, using the pieces above:

```gleam
// src/counter.gleam
import gleam/int
import gleam/io

pub type Counter {
  Counter(value: Int, label: String)
}

pub fn new() -> Counter {
  Counter(value: 0, label: "count")
}

pub fn increment(counter: Counter) -> Counter {
  Counter(..counter, value: counter.value + 1)
}

pub fn decrement(counter: Counter) -> Result(Counter, Nil) {
  case counter.value {
    0 -> Error(Nil)                 // cannot go below zero
    1 -> Ok(Counter(..counter, value: 0))
    n -> Ok(Counter(..counter, value: n - 1))
  }
}

pub fn display(counter: Counter) -> String {
  int.to_string(counter.value)
}

pub fn main() {
  let counter = new() |> increment |> increment
  case decrement(counter) {
    Ok(c) -> io.println("Counter: " <> display(c))
    Error(Nil) -> io.println("already at zero")
  }
}
```

Compose small pure functions; the message-passing/stateful universe (actors on
the Erlang target) lives in [`state.md`](state.md).