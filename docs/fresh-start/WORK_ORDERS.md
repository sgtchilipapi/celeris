# Fresh Start Work Orders

Read these first:

- [MVP_SPEC.md](./MVP_SPEC.md)
- [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md)

This document turns the implementation plan into ordered work orders that an agent can execute sequentially.

## Operating Rules

- Implement in order unless a later work order explicitly says otherwise.
- Treat each work order as a vertical slice.
- Land database schema, API routes, SDK changes, frontend changes, tests, and docs needed for that slice together.
- Do not leave behind temporary alternate flows unless they are required inside the same work order.
- The reference frontend must consume the browser SDK through its public API.
- Manual Sui publish, `initialize_app`, and program registration remain part of the MVP and must be documented rather than fully automated away.

## Sequence Summary

| WO | Title | Primary Outcome | Depends On |
| --- | --- | --- | --- |
| `FS-00` | Workspace Bootstrap | Monorepo skeleton, Express, Next.js, Prisma, shared packages, test harness | none |
| `FS-01` | Developer App Setup | Developer auth, app creation, sponsor-wallet provisioning, program registration, action config | `FS-00` |
| `FS-02` | Hosted Player Auth And zkLogin Identity | Real Google login, zkLogin wallet identity, player session, browser SDK auth flow | `FS-00`, `FS-01` |
| `FS-03` | Credits And Mock Checkout | Catalog, balance, checkout flow, persistent credit ledger | `FS-01`, `FS-02` |
| `FS-04` | Sponsored Say Hello And Feed | Move package finalization, canonical tx builder, sponsor-sign flow, completion, app-wide feed | `FS-01`, `FS-02`, `FS-03` |
| `FS-05` | SDK Consumer Hardening And Walkthrough | Public SDK integration proof, walkthrough, regression suite, final polish | `FS-00`, `FS-01`, `FS-02`, `FS-03`, `FS-04` |

## Dependency Map

```text
FS-00 -> FS-01
FS-00 -> FS-02

FS-01 -> FS-02
FS-01 -> FS-03
FS-01 -> FS-04

FS-02 -> FS-03
FS-02 -> FS-04

FS-03 -> FS-04

FS-00 -> FS-05
FS-01 -> FS-05
FS-02 -> FS-05
FS-03 -> FS-05
FS-04 -> FS-05
```

## `FS-00` Workspace Bootstrap

### Objective

Stand up the monorepo, package boundaries, runtime bootstraps, and shared tooling so the rest of the MVP can be implemented without reworking infrastructure.

### In Scope

- workspace package structure
- TypeScript project references or equivalent workspace config
- `apps/api` Express bootstrap
- `apps/web` Next.js bootstrap
- `packages/db` Prisma bootstrap
- `packages/shared` bootstrap for env parsing and shared schemas
- `packages/sdk-browser` and `packages/sdk-server` package skeletons
- base logging, error handling, and health endpoints
- initial test harness

### Out Of Scope

- developer auth flows
- player auth flows
- checkout
- Sui execution

### Implementation Checklist

- Create the repo shape described in `IMPLEMENTATION_PLAN.md`.
- Configure workspace scripts for:
  - `dev`
  - `build`
  - `typecheck`
  - `test`
  - Prisma generation and migration
- Add Express app bootstrap with:
  - request ID middleware
  - JSON parsing
  - centralized error middleware
  - `/health`
- Add Next.js App Router shell with:
  - demo route group
  - hosted-auth route group
  - basic layout and env bootstrap
- Add initial Prisma schema and migration workflow.
- Add shared env validation in `packages/shared`.
- Add package exports for `sdk-browser` and `sdk-server`, even if methods are placeholders.
- Add test runners for unit, API integration, and frontend tests.

### Deliverables

- working monorepo layout
- generated Prisma client
- healthy API and web bootstraps
- compileable SDK packages
- passing bootstrap test suite

### Acceptance Criteria

- `npm run dev` starts both API and web apps.
- `npm run typecheck` passes.
- `prisma migrate dev` works against a local Postgres database.
- `GET /health` succeeds.
- browser and API test harnesses can run at least one smoke test each.

### Verification

- boot apps locally
- verify Prisma generate and migrate
- run smoke tests for API and web startup

## `FS-01` Developer App Setup

### Objective

Enable a developer to create a new app in Celeris, provision its sponsor wallet, register Sui package metadata, configure `say_hello`, and produce the public config needed by a frontend app.

### In Scope

- developer sign-up and sign-in
- developer bearer-token auth
- app creation and fetch routes
- sponsor-wallet provisioning and retrieval
- program registration and retrieval
- `say_hello` action pricing/config route
- developer setup UI in Next.js
- server SDK for provisioning

### Out Of Scope

- player login
- player credits
- on-chain execution

### Data Model

- `DeveloperAccount`
- `DeveloperSession`
- `App`
- `ManagedAction`
- `SponsorWallet`
- `RegisteredProgram`

### Implementation Checklist

- Add Prisma models and migrations for the developer/app setup domain.
- Implement developer auth endpoints and bearer-token middleware.
- Implement developer app routes:
  - create app
  - list apps
  - get app
- Implement sponsor-wallet routes:
  - create or return existing sponsor wallet
  - fetch sponsor wallet
- Implement program registration routes:
  - register package and object IDs
  - fetch program registration
- Implement `say_hello` action config route.
- Add Sui ID validators in `packages/shared`.
- Implement setup console pages in Next.js for:
  - developer auth
  - app creation
  - sponsor-wallet provisioning
  - program registration
  - action configuration
- Implement matching methods in `sdk-server`.

### Deliverables

- persistent developer auth
- persistent app setup state
- minimal developer setup console
- server SDK methods for setup flow

### Acceptance Criteria

- a developer can sign up and sign in
- a developer can create a new app
- sponsor-wallet provisioning is idempotent
- malformed Sui package or object IDs are rejected
- `say_hello` action pricing persists and is returned correctly
- the setup console can drive the full developer setup flow against public APIs

### Verification

- API integration tests for each route
- UI test for developer setup flow
- manual check that a fresh database can reach "app configured and ready for player auth"

## `FS-02` Hosted Player Auth And zkLogin Identity

### Objective

Enable real Google sign-in on the hosted auth origin, derive a stable zkLogin wallet address, issue a player session, and make the browser SDK own the auth flow.

### In Scope

- login-request creation
- hosted auth start and callback flow
- Google token verification via JWKS
- stable salt and zkLogin address derivation
- prover adapter integration
- player session issuance
- browser SDK auth flow
- signed-in frontend state

### Out Of Scope

- credits
- checkout
- sponsored transactions

### Data Model

- `AuthLoginRequest`
- `PlayerIdentity`
- `PlayerSession`

### Implementation Checklist

- Add Prisma models and migrations for login requests, identities, and sessions.
- Implement `POST /v1/auth/login-requests`.
- Implement Google auth start and callback routes.
- Implement login-request expiry, redirect URI validation, and state validation.
- Implement Google ID-token verification with `jose` or equivalent.
- Implement stable salt derivation and zkLogin address derivation.
- Implement prover adapter via `CELERIS_ZKLOGIN_PROVER_ORIGIN`.
- Implement `POST /v1/auth/token` and `GET /v1/me`.
- Add hosted auth pages to Next.js.
- Add callback handling page on the demo origin.
- Implement browser SDK methods for:
  - start login
  - handle callback
  - exchange auth code
  - get current session
  - sign out
- Store zkLogin ephemeral material in `sessionStorage` only.

### Deliverables

- working hosted auth flow
- stable wallet identity
- player session support
- browser SDK auth integration

### Acceptance Criteria

- a player can sign in with real Google auth
- the same Google subject resolves to the same zkLogin wallet address on repeat sign-ins
- invalid or expired login requests are rejected
- browser auth state does not use `localStorage` for sensitive zkLogin material
- the Next.js app shows the authenticated wallet address after sign-in

### Verification

- API tests for login-request, callback, and token exchange
- browser SDK tests for auth orchestration
- manual sign-in test with real Google auth in a configured environment

## `FS-03` Credits And Mock Checkout

### Objective

Enable a signed-in player to view the app catalog, purchase credits through a hosted mock checkout flow, and see the updated persistent balance.

### In Scope

- catalog endpoint
- balance endpoint
- checkout session creation
- checkout completion
- append-only credit ledger
- Next.js checkout flow
- browser SDK balance and checkout helpers

### Out Of Scope

- sponsored `say_hello`
- transaction feed

### Data Model

- `CheckoutSession`
- `CreditLedgerEntry`

### Implementation Checklist

- Add Prisma models and migrations for checkout sessions and the credit ledger.
- Implement player app routes:
  - `GET /v1/apps/:appId/catalog`
  - `GET /v1/apps/:appId/balance`
  - `POST /v1/apps/:appId/checkout-sessions`
  - `POST /v1/apps/:appId/checkout-sessions/:checkoutSessionId/complete`
- Implement ledger writes for purchase events.
- Ensure balance is derived from ledger state, not duplicated mutable counters.
- Add hosted mock checkout pages in Next.js.
- Add player balance and action price display to the frontend.
- Implement browser SDK methods for:
  - get catalog
  - get balance
  - start checkout
  - complete or refresh after checkout

### Deliverables

- persistent purchase flow
- player balance UI
- browser SDK support for catalog and checkout

### Acceptance Criteria

- a signed-in player can start checkout
- completing checkout creates the correct credit ledger entries
- player balance updates after checkout completion
- repeated completion calls do not duplicate credits
- action price is displayed from the catalog response

### Verification

- API integration tests for checkout creation and completion
- frontend tests for checkout redirect and balance refresh
- manual test proving a signed-in player can buy credits end to end

## `FS-04` Sponsored Say Hello And Feed

### Objective

Enable a player with credits to execute sponsored `say_hello` on Sui testnet and see the resulting transaction in the app-wide feed.

### In Scope

- Move package finalization
- shared Sui helpers
- transaction-kind builder and validator
- execute and complete routes
- sponsor gas coin locking
- credit reserve, capture, release logic
- digest verification against Sui RPC
- reconciliation loop for pending submissions
- app-wide transaction feed
- browser SDK sponsored action flow
- frontend execution UI and feed

### Out Of Scope

- final walkthrough and regression hardening

### Data Model

- `PendingActionReservation`
- `SponsorGasCoinLock`
- `TransactionRecord`

### Implementation Checklist

- Finalize the Move package for `initialize_app` and `say_hello`.
- Add shared Sui helpers for:
  - package and object ID parsing
  - username normalization
  - canonical `say_hello` transaction construction
  - exact-match transaction validation
- Implement `POST /v1/apps/:appId/actions/say_hello/execute`.
- Implement `POST /v1/apps/:appId/actions/say_hello/complete`.
- Implement `GET /v1/apps/:appId/transactions`.
- Implement sponsor gas coin discovery, selection, and lock persistence.
- Reserve credits on execute.
- Sponsor-sign transaction bytes and return sponsorship payload.
- Verify digest through Sui RPC on completion.
- Capture or release credits based on final result.
- Add lightweight reconciliation for `submitted` records not yet final.
- Add frontend UI for:
  - username entry
  - execute action
  - pending and error states
  - app-wide transaction feed
- Implement browser SDK methods for sponsored `say_hello`.

### Deliverables

- real Move package behavior
- sponsored transaction pipeline
- app-wide transaction feed
- browser SDK action execution flow

### Acceptance Criteria

- invalid transaction kinds are rejected
- credits are reserved before sponsor signing
- failed submissions release credits
- successful submissions capture credits and record digest plus explorer URL
- the feed returns newest-first managed transactions
- the player can execute `say_hello` end to end from the Next.js app

### Verification

- unit tests for shared Sui helpers
- API tests for execute and complete flows
- integration tests for credit reservation and reconciliation
- manual test on Sui testnet showing a successful `say_hello`

## `FS-05` SDK Consumer Hardening And Walkthrough

### Objective

Turn the reference implementation into a clean developer-integration demo, lock the browser SDK as the public frontend contract, add the manual walkthrough, and finish regression coverage.

### In Scope

- SDK public API hardening
- removal of private integration shortcuts in the reference frontend
- walkthrough documentation
- health diagnostics for auth, prover, and Sui RPC
- structured audit logging
- end-to-end regression coverage

### Out Of Scope

- net-new product features beyond the MVP

### Implementation Checklist

- Remove any remaining direct API calls from the reference frontend that bypass the browser SDK for player flows.
- Freeze the minimal browser SDK config contract:
  - `appId`
  - `apiOrigin`
  - `hostedAuthOrigin`
  - `redirectUri`
  - optional `suiRpcOrigin`
- Add browser SDK error classes for:
  - auth failure
  - insufficient credits
  - sponsorship failure
  - transaction verification failure
- Add integration examples for a developer-owned frontend app.
- Tighten DTO schemas and API response contracts.
- Add structured audit logging for key setup and execution events.
- Add health diagnostics for:
  - Google auth configuration
  - prover availability
  - Sui RPC availability
- Write the manual walkthrough required by `MVP_SPEC.md`.
- Add end-to-end and regression coverage across all slices.

### Deliverables

- public browser SDK integration proof
- finalized walkthrough
- hardened API contracts
- regression suite for the full MVP path

### Acceptance Criteria

- the reference frontend consumes only the public browser SDK for player flows
- the walkthrough can take an operator from empty database to successful `say_hello`
- the browser SDK public config contract is documented and stable
- the regression suite covers setup, sign-in, purchase, execution, and feed retrieval
- the full MVP path is reproducible without undocumented manual steps

### Verification

- Playwright end-to-end tests for the main flow
- API integration tests against Postgres
- manual smoke test from a clean database and fresh app setup

## Global Definition Of Done

The full fresh-start implementation is complete only when:

- all six work orders are complete
- a brand new app can be created in Celeris
- the sponsor wallet can be provisioned and funded
- the Sui program can be manually published, initialized, and registered
- a frontend app consumes the browser SDK for player flows
- a player can sign in with real Google + zkLogin
- a player can buy credits
- a player can execute paid `say_hello`
- the app-wide transaction feed shows the result with an Explorer link
- `npm run typecheck` passes
- `npm test` passes
- the manual walkthrough has been executed successfully from a clean database
