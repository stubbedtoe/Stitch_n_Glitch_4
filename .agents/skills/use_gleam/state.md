# State: pure-functional threading and OTP actors

Gleam has no shared mutable state. Two models cover most programs:

1. **Pure-functional state threading** — state is a value; functions take it in
   and return a new copy. Works everywhere, both targets.
2. **OTP actors (Erlang target only)** — state lives inside a process that
   reacts to messages. Needed for concurrency, shared services, and fault
   tolerance.

Pick the purely functional model by default. Reach for actors when you have
*shared, concurrent* state (a database pool, a hot cache, a subscription
registry) or want supervised, restartable processes. See
[`std-lib.md`](std-lib.md) for the package decision; `gleam_otp` is the official
binding, **Erlang target only**.

## Pure-functional state threading

State is just a custom type. Updates are functions returning a new value.

```gleam
pub type Cart {
  Cart(items: List(#(String, Int)), total: Int)
}

pub fn new() -> Cart {
  Cart(items: [], total: 0)
}

pub fn add_item(cart: Cart, name: String, price: Int) -> Cart {
  Cart(items: [#(name, price), ..cart.items], total: cart.total + price)
}

pub fn remove_last(cart: Cart) -> Cart {
  case cart.items {
    [] -> cart
    [#(_, price), ..rest] -> Cart(items: rest, total: cart.total - price)
  }
}
```

Note the `#(...)` tuple syntax inside the list — tuples are written `#(a, b)`,
parentheses alone do not form a tuple.

There is no "current state" to corrupt and no locking to reason about — every
call returns a fresh value and the caller decides what to do with it. The
"loop" that processes a stream of events is just a fold:

```gleam
import gleam/list

pub fn final_state(initial: Cart, events: List(Event)) -> Cart {
  list.fold(events, initial, apply_event)
}

fn apply_event(cart: Cart, event: Event) -> Cart {
  case event {
    Add(name, price) -> add_item(cart, name, price)
    RemoveLast -> remove_last(cart)
  }
}
```

Where several fallible steps must share state, keep it explicit rather than
smuggling it through a monad — Gleam is deliberately simple, and threading a
`(state, value)` pair or nesting via `use` stays readable. Favour small functions
that take and return the state record over big `case` expressions.

## OTP actors (Erlang target)

An **actor** is a process owning state, driven by a pure message handler. It is
the Gleam-idiomatic replacement for "mutable object + methods": you send it
messages, it updates its state, optionally replies.

This is the verified `gleam_otp` v1 pattern (from its README):

```gleam
import gleam/erlang/process.{type Subject}
import gleam/otp/actor

pub type Message {
  Add(Int)
  Get(Subject(Int))
}

pub fn main() {
  // Build an actor: initial state + a message handler, then start it
  let assert Ok(actor) =
    actor.new(0)
    |> actor.on_message(handle_message)
    |> actor.start

  // Fire-and-forget messages
  actor.send(actor.data, Add(5))
  actor.send(actor.data, Add(3))

  // Send a message and block for a reply, passing a reply Subject in the message
  assert actor.call(actor.data, waiting: 10, sending: Get) == 8
}

pub fn handle_message(state: Int, message: Message) -> actor.Next(Int, Message) {
  case message {
    Add(i) -> {
      let state = state + i
      actor.continue(state) // keep running with updated state
    }
    Get(reply) -> {
      actor.send(reply, state) // answer the reply Subject
      actor.continue(state)
    }
  }
}
```

Key points:

- **`actor.new(initial_state)` → `actor.on_message(handler)` → `actor.start`**
  configures and starts an actor; `start` returns `Result(actor.Actor(a, msg), a)`.
- **`actor.continue(state)`** finishes a message handling round; the actor's
  state becomes the returned value. **`actor.stop()`** ends the actor (handling
  no further messages); `actor.stop_abnormal(reason)` ends it and propagates a
  failure to linked processes.
- **`actor.send(actor.data, message)`** posts a message, fire-and-forget.
  **`actor.call(actor.data, waiting: ms, sending: message)`** posts a message and
  blocks (up to `waiting:`) for the reply the handler sends to the reply subject.
- Handlers are **pure** `fn(state, message) -> actor.Next(state, message)` — no
  mutable globals, history is local to the handler. The actor framework loops
  over the mailbox for you.
- Messages are plain Gleam custom types; the type system guarantees what can be
  sent to an actor. This is why the `Get(Subject(Int))` reply channel is passed
  *inside* the message — the actor literally cannot reply to a caller that didn't
  give it a `Subject`.

### Processes and `Subject`

Under the hood Gleam uses `gleam/erlang/process` (Erlang target):

- **`Subject(a)`** — a typed mailbox address you can `process.send(subject, value)`
  to from anywhere. Pass it around (even inside messages) to build reply
  channels, exactly like the `Get(reply)` above.
- `process.spawn(...)` starts raw processes when you don't need OTP semantics.

### Supervision: static and factory supervisors

OTP's fault tolerance comes from **supervision trees**: supervisors start and
watch child processes, restarting them on crash. `gleam_otp` provides
`gleam/otp/static_supervisor` (fixed children, configured once) and
`gleam/otp/factory_supervisor` (start children on demand, e.g. one actor per
connection).

Verified `gleam_otp` v1.3 API — build a supervisor, add child specs, start it:

```gleam
import gleam/otp/actor
import gleam/otp/static_supervisor.{type Supervisor} as supervisor

pub fn start_supervisor() -> actor.StartResult(Supervisor) {
  supervisor.new(supervisor.OneForOne)
  |> supervisor.add(database_pool.supervised())
  |> supervisor.add(http_server.supervised())
  |> supervisor.start
}
```

- **`supervisor.new(strategy)`** starts a builder; strategies are `OneForOne`
  (restart only the crashed child — the default), `OneForAll`, `RestForOne`.
- **`supervisor.add(builder, child: …supervised())`** adds a child
  specification; each supervised module (actor, other supervisor, custom OTP
  service) exposes a `.supervised()` value of type `supervision.ChildSpecification`.
- **`supervisor.start`** opens the supervisor; `supervisor.supervised(builder)`
  turns this supervisor into a child of another — this is how you build trees,
  and it's preferred over starting unsupervised.
- **`supervisor.restart_tolerance(builder, intensity: n, period: s)`** caps
  restarts (defaults intensity max 2 per 5 s) to break crash loops.

> The exact function names here are pinned to `gleam_otp` v1.3.0. The
> `factory_supervisor` API and `actor.supervised()`-style helpers differ across
> peer versions; verify against your pinned `gleam_otp` HexDocs before writing
> supervisor code from memory.

### Actors and supervisors working together

A supervised service: a supervisor owns the actor; the rest of the app talks to
it only through its reply `Subject`. If the actor crashes, the supervisor
restarts it with the initial state configured by its child specification. The
handler logic stays pure and unit-testable; supervision controls *when* the
process restarts, not how messages are processed.

## Choosing a model

| Situation | Model |
|---|---|
| Form state, derived data, pure computations, most library code | Pure threading |
| Configuration loaded once, read everywhere | Pure value stored at startup / passed in (or a `Global`-style registry via a process) |
| Shared mutable counter, cache, registry across processes | Actor |
| Per-connection/fan-out work that must restart on failure | Factory supervisor + actors |
| HTTP request handlers, batch jobs, "just compute this" | Pure functions (with a libs-actor only if state must survive requests) |

## Pitfalls

- **Don't make everything an actor.** Process round-trips and mailbox queues add
  latency and complexity a pure function call doesn't have.
- **Don't put mutable/global state in a module `let`** as a stand-in — Gleam's
  `let` is immutable. State that must change over time belongs to a process or
  to explicitly threaded values.
- **Never block the actor for long.** Long work inside a handler delays every
  message; offload to a worker process if needed.
- **Keep handlers total and pure** so they are trivially unit-testable without
  starting an actor (see [`testing.md`](testing.md)).
- **Supervision replaces "crash-proofing".** Let an unrecoverable handler crash
  and be supervised rather than swallowing errors with panics masked as results.
  But do design descriptive `Result` error types for recoverable failures
  (see [`architecture.md`](architecture.md)).