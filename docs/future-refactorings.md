# Future Refactorings

This document captures significant architecture changes that are intentionally deferred beyond the current MVP.

These are not immediate implementation tasks. They are backlog candidates for future product and platform evolution.

## Backend-mediated Celeris integration

### Summary

One future refactoring is to change the primary runtime integration model from:

- `client -> Celeris`

to:

- `client -> developer backend -> Celeris`

In this model, the game client no longer talks to Celeris directly for player-facing gameplay flows. Instead, the developer backend becomes the primary caller of Celeris through a server-side SDK.

### Why this is being considered

The current MVP favors direct client integration because it reduces backend work for developers and keeps the demo simple.

However, a backend-mediated model offers architectural advantages:

- one consistent client integration path
- fewer frontend routing decisions
- cleaner trust boundaries
- better control over auth and abuse protection
- easier long-term expansion through a server-side SDK

### Why this is deferred

For the current MVP and demo, this change is largely invisible from the product surface while carrying meaningful implementation cost.

The current codebase is built around Celeris as the player-facing HTTP boundary for:

- session creation
- checkout session creation
- action execution
- some player-facing state lookups

Moving to a backend-mediated model would require substantial migration work across the API surface, demo app, tests, and auth model.

Because that migration does not materially improve the current demo experience by itself, it is intentionally deferred.

### Current implementation

Today the runtime flow is primarily:

1. `client -> Celeris`
2. `Celeris -> developer backend webhook`
3. `developer backend -> Celeris` approval response
4. `Celeris -> relayer / chain`
5. `Celeris -> client`

The developer backend currently acts as an approval callback target, not the main player-facing integration surface.

### Future target

The future target would look more like:

1. `client -> developer backend`
2. `developer backend -> Celeris SDK / API`
3. `Celeris` handles credits, payments, orchestration, and execution
4. `developer backend -> client`

This would make the developer backend the single gameplay-facing server boundary.

### Recommended future migration strategy

When this refactor is eventually taken on, the safest path is likely:

1. Keep Celeris domain services intact.
2. Introduce a server-side SDK that wraps the existing Celeris API.
3. Build a sample backend that uses that SDK.
4. Move the demo client to the sample backend.
5. Deprecate direct browser-oriented Celeris flows gradually.
6. Revisit the auth and approval model after the caller migration is complete.

### Blast radius

This future refactor affects:

- public Celeris API semantics
- player session ownership
- checkout initiation path
- action execution entrypoints
- demo frontend architecture
- mock developer backend behavior
- test strategy and fixture setup
- documentation and onboarding model

The core domain services such as credits, pending actions, relayer handling, and asset recording should remain mostly reusable.

### Backlog status

Status: deferred future refactor

Priority: important architecture option, not part of current MVP execution
