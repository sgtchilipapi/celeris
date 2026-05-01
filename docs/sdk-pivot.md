# SDK-First Integration Pivot

This document captures the planned pivot from the current MVP integration model to an SDK-first product model.

It is not the current implementation.

The current MVP still uses:

- direct browser calls to Celeris for player-facing flows
- a mock developer backend webhook for demo action approval
- local Celeris-issued demo auth tokens

The target described here changes that direction.

## Decision Summary

Celeris should become available through SDKs that can be used from both frontend and backend environments.

The primary player-facing experience should use standard bearer user tokens.

For the demo, the mock developer backend should be removed and replaced by managed action execution inside Celeris.

For real integrations, developer backends should still be supported, but as one execution mode rather than the default demo architecture.

## Why This Pivot

The current MVP proves the domain model:

- user identity
- credits and payments
- pending action reservation
- transaction verification
- relayer submission
- asset recording

What it does not yet provide is a clean product surface for application developers.

Today the integration story still leaves key questions open:

- should a frontend call Celeris directly?
- should a backend always sit in front of Celeris?
- where should action routing logic live?
- how should auth work across browser and server environments?

An SDK-first model gives Celeris a clearer answer:

- browser clients use a player SDK
- game backends use a server SDK
- Celeris owns the player-facing platform boundary
- demo gameplay no longer depends on an external mock approval server

## Product Direction

The near-term product direction is:

1. expose a stable player-facing API
2. expose a separate developer/service API
3. ship browser and server SDKs over those APIs
4. verify standard user bearer tokens on the player surface
5. move demo action approval logic into managed Celeris handlers
6. keep developer webhook mode only as a compatibility path

This is different from a pure backend-mediated future where all gameplay traffic must flow through a developer-owned backend.

## Target Surfaces

### Player Surface

This surface is intended for browser, mobile, or game clients.

Characteristics:

- bearer user token required
- scoped to player-owned operations
- no developer secrets
- safe for frontend use

Examples:

- get current player identity
- get player balance
- get player assets
- create checkout session
- execute configured actions

### Developer Surface

This surface is intended for dashboards, internal tools, and game backends acting with developer privileges.

Characteristics:

- developer session or service credential required
- app and action management
- metrics and administrative access
- not callable with a plain player token

Examples:

- create app
- configure actions
- update app auth settings
- inspect metrics

### Service Surface

This surface is intended for inbound provider callbacks or internal service-to-service traffic.

Characteristics:

- provider-specific webhook verification or internal service auth
- never player-token-based

Examples:

- Stripe webhook ingestion
- internal action-provider calls

## Auth Model

The player-facing API should adopt standard bearer token verification rather than relying only on Celeris-issued local demo tokens.

### Player Auth

Celeris should support verification of standard JWT bearer tokens using issuer, audience, and JWKS configuration.

Each verified external identity should map to a canonical Celeris `userId`.

That means Celeris still owns internal identity records, while external identity providers own user authentication.

Recommended player auth rules:

- verify `iss`
- verify `aud`
- verify signature via JWKS
- extract stable subject claim, usually `sub`
- map `(issuer, subject)` to canonical Celeris `userId`
- treat `userId` as derived from the token, not from request body input

### Developer Auth

Developer and administrative operations should use a different auth model.

A player token must not authorize:

- app creation
- app updates
- action configuration
- metrics access
- webhook operations

Developer auth can be implemented as:

- developer session tokens
- service tokens
- API keys scoped to administrative operations

The exact credential form can evolve, but it should remain separate from player auth.

### Demo Auth

The local demo can continue to support Celeris-issued demo tokens for development convenience.

That path should be treated as a development mode, not the long-term platform contract.

## SDK Model

Two SDKs should be the primary integration surface.

### Browser SDK

The browser SDK should:

- accept an app ID and API base URL
- accept a token provider callback
- attach bearer tokens to player routes
- expose player-safe operations only

Examples:

- `me.get()`
- `credits.getBalance()`
- `payments.createCheckoutSession()`
- `actions.execute(actionId, payload)`

### Server SDK

The server SDK should:

- accept developer or service credentials
- expose app-management operations
- optionally support an on-behalf-of user mode for player actions

Examples:

- `apps.create()`
- `apps.configureAction()`
- `metrics.getAppMetrics()`
- `asUser(userToken).actions.execute(...)`

## API Direction

The route model should be split by audience instead of mixing player, developer, and service concerns under one flat namespace.

### Player API

Suggested shape:

- `GET /v1/me`
- `GET /v1/apps/:appId/me/balance`
- `GET /v1/apps/:appId/me/assets`
- `GET /v1/apps/:appId/catalog`
- `POST /v1/apps/:appId/checkout-sessions`
- `POST /v1/apps/:appId/actions/:actionId/execute`

### Developer API

Suggested shape:

- `POST /v1/developer/session`
- `GET /v1/developer/apps`
- `POST /v1/developer/apps`
- `PUT /v1/developer/apps/:appId`
- `POST /v1/developer/apps/:appId/actions`
- `PUT /v1/developer/apps/:appId/actions/:actionId`
- `DELETE /v1/developer/apps/:appId/actions/:actionId`
- `GET /v1/developer/apps/:appId/metrics`

### Service API

Suggested shape:

- `POST /v1/webhooks/stripe`
- internal-only action-provider routes as needed

## Action Execution Modes

Action execution should become explicit and configurable.

Recommended modes:

- `managed`
- `server`
- `webhook`

### Managed

Celeris owns the approval/build step for supported actions.

This is the target mode for the demo.

### Server

A developer backend uses a Celeris server SDK to approve or initiate actions without exposing secrets to the client.

This is the preferred custom-production integration path once the SDK exists.

### Webhook

Celeris calls an external developer webhook and receives an approval response.

This mode preserves compatibility with the current MVP design, but should stop being the default demo story.

## Demo Direction

The demo should stop depending on the mock developer backend.

Instead:

- `mint_item`
- `claim_rewards`
- `first_time_claim`

should run as managed Celeris actions for the demo app.

That gives the demo a cleaner story:

1. player authenticates with a standard user token or demo token
2. frontend uses the Celeris browser SDK
3. Celeris executes the configured managed action
4. credits, transactions, and assets are recorded inside Celeris

This makes the demo representative of the platform direction instead of representative of the legacy webhook seam.

## Migration Plan

### Phase 1

- introduce a token verifier abstraction
- add player-scoped `v1` routes
- derive player identity from bearer token instead of request body
- keep existing routes working during migration

### Phase 2

- introduce managed demo action execution
- remove the mock developer backend from the demo flow
- migrate the demo frontend to the browser SDK

### Phase 3

- add developer/service auth for administrative routes
- move dashboard data access to the developer API namespace

### Phase 4

- ship the server SDK
- keep webhook execution as compatibility mode
- migrate docs and examples to SDK-first integrations

## Non-Goals

This pivot does not mean:

- every real game can avoid having a backend forever
- player tokens can replace developer or service auth
- webhooks must disappear immediately
- arbitrary custom game logic can be hosted automatically on day one

The immediate goal is narrower:

- make Celeris consumable through SDKs
- make player auth standard
- make the demo independent of the mock developer backend

## Status

Status: planned pivot

Priority: high

Scope: API boundary, auth model, SDK surface, and demo architecture
