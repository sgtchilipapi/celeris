# Future Direction

This document captures a possible long-term product direction for Celeris beyond the current MVP.

It is not the current implementation. It is a proposed future model for reducing even more backend and integration work for game developers.

## Why this direction exists

Today, Celeris is primarily a backend service that handles:

- identity
- credits and payments
- pending action orchestration
- developer approval callbacks
- relayer submission
- asset recording

That works well for the MVP, but it still leaves developers with major integration choices:

- should the client call Celeris directly?
- should the client always call the developer backend first?
- where should action routing logic live?
- how much backend infrastructure should the developer still own?

The future direction described here aims to reduce that load further.

## The core idea

Celeris evolves from being only a backend API into a managed game backend platform.

Instead of asking developers to assemble:

- a backend server
- database plumbing
- client integration wiring
- Celeris orchestration logic

Celeris would generate and optionally host an opinionated project scaffold with those pieces already wired together.

The developer would primarily bring:

- game logic
- gameplay rules
- content
- custom action handling

Celeris would provide the infrastructure and default architecture around those pieces.

## Product model

The long-term model could look like this:

1. A developer creates an app in Celeris.
2. The developer configures pricing, actions, origins, and backend settings.
3. Celeris generates a working project scaffold from that configuration.
4. The scaffold includes the backend, frontend starter, database layer, and Celeris configuration.
5. The developer customizes game logic inside the generated structure.
6. Later dashboard changes, such as adding actions, can sync back into the project as code changes.

This gives developers a coherent starting point instead of a loose collection of APIs.

## Monorepo scaffold

A clean future scaffold would likely be a single project monorepo with:

- `backend/`
- `frontend/`
- `db/`
- root Celeris config files such as `celeris.json`

### `backend/`

Contains:

- game server routes
- auth/session glue
- action handlers
- Celeris integration
- approval/orchestration logic
- game-specific server modules

### `frontend/`

Contains:

- a client starter, likely beginning with Godot
- auth/session plumbing
- API client helpers
- action invocation helpers
- example scenes and UI stubs

### `db/`

Contains:

- migrations
- seeds
- base schema
- extension points for game-specific data

### Root Celeris config

Contains project-level metadata such as:

- app ID
- action definitions
- allowed origins
- environment linkage
- generation ownership metadata

## Backend opinion

The generated backend would not be an empty template. It would be an opinionated architecture for games using Celeris.

That would likely include:

- a default request pipeline
- standard action handler conventions
- built-in Celeris SDK usage
- event and action logging
- idempotent action execution patterns
- developer-owned handler stubs

The goal is to remove backend boilerplate, not just hand over an SDK.

## Database opinion

The future product becomes significantly stronger if database infrastructure is included by default.

That means not just “bring your own database,” but a usable base data model with conventions.

Examples of built-in concerns:

- players
- profiles
- inventories
- action logs
- reward claims
- custom game state tables or extension patterns

This would make the generated project feel like a working backend foundation rather than a thin wrapper around Celeris.

## Frontend opinion

A major part of this future vision is shipping a frontend skeleton, not only backend code.

The most compelling first candidate discussed was a Godot project starter with plumbing already in place.

That starter would likely include:

- sign-in flow
- session persistence
- API wiring
- action requests
- example UI flow for interacting with backend actions

This lets an indie developer open a ready project rather than integrate everything from scratch.

## Action-driven workflow

Actions remain the core unit of integration.

Developers define actions in Celeris, and those actions shape the generated project structure.

For example, adding an action could generate or update:

- backend handler stubs
- shared action manifests
- client-side action definitions

In a repo-based workflow, later dashboard changes should ideally become commits or pull requests rather than silent direct edits to developer code.

That keeps developer ownership and reviewability intact.

## Repo and packaging model

Several packaging models are possible:

- downloadable scaffold archive
- generated GitHub repository
- managed hosted backend
- repo-first with optional hosting later

The strongest likely path is:

1. generate a project repo from a template
2. bake in developer configuration
3. let later dashboard changes sync into the repo through commits or PRs
4. add optional managed hosting later

This keeps the developer in control while still giving Celeris a strong opinionated DX story.

## Hosting direction

Over time, Celeris could optionally move from “repo generator” to “managed runtime.”

That means developers could choose between:

- generating a repo and self-hosting
- generating a repo and deploying with a guided path
- letting Celeris host the opinionated backend directly

Managed hosting should be considered an expansion of the same architecture, not a separate product.

## Security and trust boundary implications

This future direction also clarifies the trust model.

Instead of forcing developers to choose between:

- direct client-to-Celeris integration
- fully custom developer backend integration

Celeris can provide the backend surface itself.

That allows:

- cleaner action routing
- fewer frontend branching decisions
- stronger server-side integration points
- simpler origin, auth, and abuse-control layering

For MVP, direct client access may still remain acceptable in some flows. Long term, the managed backend approach offers a cleaner overall architecture if Celeris chooses to own more of the integration surface.

## Product positioning

If Celeris moves in this direction, the positioning shifts.

It stops being only:

- a web3 backend API
- a relayer/payment/credits primitive

And becomes closer to:

> Celeris is a managed game backend platform that lets developers define player actions and game logic while Celeris handles identity, credits, orchestration, and on-chain execution.

In this framing:

- blockchain is an important capability
- backend reduction is the main product value
- action orchestration is the product center

## Practical phased path

A reasonable phased approach could be:

1. Keep strengthening the current Celeris core.
2. Add app-level security features such as origin allowlists.
3. Introduce an opinionated backend starter.
4. Add a frontend starter, likely Godot first.
5. Introduce a DB-backed scaffold with conventions.
6. Move to repo generation and sync workflows.
7. Add optional managed hosting later.

This preserves the current MVP while leaving room for Celeris to become a much more complete developer platform over time.

## Related future refactors

Some architecture changes are worth tracking separately from the long-term platform vision.

See [future-refactorings.md](future-refactorings.md) for deferred refactors such as moving from direct `client -> Celeris` flows toward `client -> developer backend -> Celeris SDK`.
