# SDK-First Integration Pivot

This document captures the pivot that moved Celeris from the original MVP integration model to an SDK-first product model.

It is now primarily historical context rather than the source of truth for the current runtime.
The current implementation already uses the hosted auth gateway, player and developer `v1` APIs, SDK entrypoints, managed demo actions, and wallet-native delivery records described here.

## Decision Summary

Celeris should become available through SDKs that can be used from both frontend and backend environments.

The primary player-facing experience should use Privy's embedded wallets for sign-up and sign-in, with Privy-authenticated bearer tokens on the player API.

Wallet addresses should become the primary player reference for:

- credit balances
- action execution context
- in-game asset delivery destinations

For the demo, the mock developer backend should be removed and replaced by managed action execution inside Celeris.

Asset custody should be removed from the target model.

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
- Privy owns player sign-up and embedded wallet authentication
- wallet addresses become the reference for credits and player-owned assets
- demo gameplay no longer depends on an external mock approval server

## Product Direction

The near-term product direction is:

1. expose a stable player-facing API
2. expose a separate developer/service API
3. ship browser and server SDKs over those APIs
4. use Privy's embedded wallets for player sign-up and sign-in
5. use player wallet addresses as the primary reference for credits and asset delivery
6. move demo action approval logic into managed Celeris handlers
7. keep developer webhook mode only as a compatibility path

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

- get current player wallet identity
- get player credits
- get player asset delivery history
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

## Identity and Asset Model

The player-facing product model should become wallet-native.

### Player Identity

Privy should own player sign-up and sign-in.

Celeris should consume the authenticated wallet address from the Privy session as the product-level player reference.

That means:

- credits are associated to wallet address
- player-scoped queries resolve against wallet address
- action execution uses wallet address as the player context
- any internal surrogate IDs remain implementation details and must not replace wallet address in the public contract

### Asset Delivery

The target asset model is non-custodial.

That means:

- in-game assets are delivered directly to the player's wallet
- Celeris records transaction and delivery metadata
- Celeris may expose delivery history and status
- Celeris does not hold player assets in custody

## Auth Model

The player-facing API should adopt Privy's embedded wallets sign-up/sign-in flow and Privy-authenticated bearer tokens rather than relying on Celeris-issued local demo tokens.

### Player Auth

Celeris should verify the authenticated Privy player session and resolve the wallet address associated with that session.

The wallet address becomes the product-level player identifier for credits and asset delivery.

Recommended player auth rules:

- verify Privy-authenticated bearer tokens on player routes
- resolve the active embedded wallet address from the authenticated session
- require a supported chain and wallet type for app execution
- treat wallet address as derived from the authenticated session, not from arbitrary request body input
- use wallet address as the reference for credits, action context, and asset destination

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

The demo should move to Privy's embedded wallet flow as part of this pivot.

If a temporary local fallback exists during migration, it should be treated as transitional only and not as the target platform contract.

## SDK Model

Two SDKs should be the primary integration surface.

### Browser SDK

The browser SDK should:

- accept an app ID and API base URL
- accept a Privy token provider callback
- expose the authenticated embedded wallet context
- attach bearer tokens to player routes
- expose player-safe operations only

Examples:

- `me.get()`
- `wallet.getPrimary()`
- `credits.getBalance()`
- `assets.getHistory()`
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
- `asUser(privyUserToken).actions.execute(...)`

## API Direction

The route model should be split by audience instead of mixing player, developer, and service concerns under one flat namespace.

### Player API

Suggested shape:

- `GET /v1/me`
- `GET /v1/apps/:appId/me/credits`
- `GET /v1/apps/:appId/me/asset-history`
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

Managed actions should direct any player-owned asset outputs to the authenticated player's wallet address.

### Server

A developer backend uses a Celeris server SDK to approve or initiate actions without exposing secrets to the client.

This is the preferred custom-production integration path once the SDK exists.

### Webhook

Celeris calls an external developer webhook and receives an approval response.

This mode preserves compatibility with the current MVP design, but should stop being the default demo story.

## Demo Direction

The demo should stop depending on the mock developer backend.

The demo should also stop depending on Celeris-managed custody semantics.

Instead:

- `mint_item`
- `claim_rewards`
- `first_time_claim`

should run as managed Celeris actions for the demo app.

That gives the demo a cleaner story:

1. player signs in through Privy's embedded wallet flow
2. frontend uses the Celeris browser SDK
3. Celeris executes the configured managed action
4. credits are recorded against the player's wallet address
5. assets are delivered directly to the player's wallet
6. Celeris records delivery and transaction metadata without custody

This makes the demo representative of the platform direction instead of representative of the legacy webhook seam.

## Migration Plan

### Phase 1

- introduce a Privy token verification and wallet-resolution abstraction
- add player-scoped `v1` routes
- derive wallet identity from authenticated Privy session instead of request body
- move player credit lookups to wallet-address-based references
- keep existing routes working during migration

### Phase 2

- introduce managed demo action execution
- remove the mock developer backend from the demo flow
- remove asset custody from the demo target model
- deliver demo assets directly to authenticated wallet addresses
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
- make Privy embedded wallets the player auth entrypoint
- make wallet addresses the player reference for credits and asset delivery
- make the demo independent of the mock developer backend
- remove asset custody from the target model

## Status

Status: planned pivot

Priority: high

Scope: API boundary, auth model, SDK surface, and demo architecture
