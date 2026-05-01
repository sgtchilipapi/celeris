# Future Refactorings

This document captures significant architecture changes that are intentionally deferred beyond the current MVP.

These are not immediate implementation tasks. They are backlog candidates for future product and platform evolution.

The current primary planned pivot is documented in [sdk-pivot.md](./sdk-pivot.md).

## SDK-First API Productization

### Summary

The primary next refactor is to turn Celeris into a cleaner API product with distinct player, developer, and service surfaces.

In this model:

- frontend clients use a player-safe browser SDK
- game backends use a developer/service SDK
- player-facing flows authenticate with standard bearer user tokens
- the demo no longer depends on an external mock developer backend

### Why this is being considered

The current MVP proves the domain logic, but its public boundary is still shaped around a local demo:

- mixed player and developer routes
- a mock developer webhook for action approval
- local Celeris-issued demo auth tokens
- flat route semantics that are not yet SDK-oriented

An SDK-first refactor would provide:

- one clear player integration path
- one clear developer/backend integration path
- safer auth boundaries
- better frontend ergonomics
- a demo architecture that matches the intended platform story

### Why this is deferred

This change affects nearly every boundary around the current system:

- API shape
- token verification
- checkout initiation
- action execution entrypoints
- dashboard auth
- demo frontend flow
- mock developer backend behavior
- documentation and tests

The core services should remain reusable, but the transport and auth layers need a meaningful redesign.

### Current implementation

Today the runtime flow is primarily:

1. `client -> Celeris`
2. `Celeris -> developer webhook`
3. `developer webhook -> Celeris` approval response
4. `Celeris -> relayer / chain`
5. `Celeris -> client`

The demo uses the external mock developer backend as part of the mint approval path.

### Future target

The target model is:

1. `client -> Celeris browser SDK -> Celeris player API`
2. `game backend -> Celeris server SDK -> Celeris developer API`
3. `Celeris` verifies user tokens and maps them to canonical `userId`
4. `Celeris` executes managed demo actions internally
5. optional custom integrations continue through server SDK or compatibility webhook mode

### Recommended future migration strategy

When this refactor is taken on, the safest path is likely:

1. Keep Celeris domain services intact.
2. Introduce a token verification abstraction.
3. Add `v1` player routes that derive identity from bearer tokens.
4. Add managed action execution for the demo.
5. Move the demo frontend to the browser SDK.
6. Add developer/service auth and a server SDK.
7. Keep webhook mode as a compatibility path during migration.

### Blast radius

This future refactor affects:

- public Celeris API semantics
- auth and identity ownership
- checkout session creation
- action execution entrypoints
- demo app architecture
- dashboard route protections
- mock developer backend behavior
- test strategy and fixture setup
- documentation and onboarding model

The core domain services such as credits, pending actions, relayer handling, and asset recording should remain mostly reusable.

### Backlog status

Status: active planned pivot

Priority: high

Primary reference: [sdk-pivot.md](./sdk-pivot.md)

## Managed Hosting and Scaffold Generation

### Summary

Beyond the SDK/auth pivot, Celeris may still evolve into a more opinionated managed platform.

That longer-term direction includes:

- generated backend and frontend scaffolds
- default database foundations
- shared project configuration
- optional repo sync and hosting

### Why this remains deferred

Those capabilities depend on first clarifying the API product boundary and auth model.

Without the SDK-first foundation, generated scaffolds would lock in unstable integration patterns.

### Backlog status

Status: deferred after SDK/API productization

Priority: important, but not first
