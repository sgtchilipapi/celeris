# Fresh Start Implementation Plan

This plan implements [MVP_SPEC.md](./MVP_SPEC.md) using a vertical-slice approach and the planned stack:

- Next.js for the public web surfaces
- Express.js for the JSON API
- Postgres for persistence
- Prisma for schema and query access
- TypeScript across all packages

## Objective

Build the MVP as one clean, demoable Sui path:

1. A developer creates a brand new app in Celeris.
2. The developer provisions a sponsor wallet.
3. The developer manually publishes and initializes the Move package.
4. The developer manually registers the Sui IDs into Celeris through the documented walkthrough.
5. The developer configures the paid `say_hello` action.
6. A frontend app consumes the Celeris browser SDK.
7. A player signs in with real Google + zkLogin.
8. The player buys credits.
9. The player executes sponsored `say_hello`.
10. The app-wide transaction feed shows the result.

## Planning Rules

- Build in vertical slices, not backend-first or frontend-first layers.
- Every slice must land database changes, Express routes, SDK changes, Next.js UI changes, tests, and docs needed for a runnable demo.
- Do not build temporary duplicate flows unless they are required for a safe cutover inside the same slice.
- The reference Next.js app must consume the browser SDK through its public package API, not through private imports into API internals.
- Manual Sui package publish and registration remain part of the MVP. The repo should help the operator perform them, but should not fully automate them away.

## Scope Decisions

These decisions make the MVP concrete and keep scope controlled:

- Player auth is real Google OAuth plus zkLogin.
- Developer auth is a simple email/password plus bearer-token flow for the MVP.
- The purchase flow is a hosted mock checkout flow implemented by Celeris, backed by the real credit ledger.
- One Next.js codebase serves two public surfaces:
  - the demo frontend origin
  - the hosted auth origin
- One Express service owns all JSON APIs and auth/session orchestration.
- One Postgres database stores all runtime state.
- The zkLogin prover is an external dependency reached by HTTP through `CELERIS_ZKLOGIN_PROVER_ORIGIN`.
- Sui package publish and `initialize_app` are manual operator steps documented in the walkthrough.

## Proposed Repo Shape

```text
apps/
  api/                  Express API
  web/                  Next.js app for demo UI and hosted auth UI
packages/
  db/                   Prisma schema, migrations, generated client
  shared/               shared types, zod schemas, Sui helpers, env parsing
  sdk-browser/          browser SDK used by the frontend app
  sdk-server/           server SDK for developer provisioning scripts and examples
sui/
  hello-celeris/        Move package
docs/
  fresh-start/
    MVP_SPEC.md
    IMPLEMENTATION_PLAN.md
```

## Runtime Topology

### Public origins

- `CELERIS_DEMO_FRONTEND_ORIGIN`
  - Next.js demo app where the player lands
- `CELERIS_HOSTED_AUTH_ORIGIN`
  - Next.js hosted auth UI for Google sign-in and redirect handling
- `API_ORIGIN`
  - Express JSON API

### Runtime responsibilities

- Next.js owns:
  - hosted auth pages
  - demo UI
  - mock checkout UI
  - callback pages that the browser SDK uses
- Express owns:
  - developer API
  - player API
  - Google OAuth orchestration
  - zkLogin proof and session orchestration
  - sponsor signing
  - reconciliation
- Postgres owns:
  - developer accounts
  - app config
  - wallet and session state
  - credit ledger
  - pending action reservations
  - transaction records

## Recommended Technical Conventions

- Use Next.js App Router.
- Use Express 5 with async handlers and centralized error middleware.
- Use Zod at all API boundaries.
- Use Prisma migrations only; do not hand-edit schema state in production.
- Store wallet addresses and object IDs in normalized lowercase form.
- Store credit amounts as integers.
- Store Sui digests, object versions, gas prices, and epochs as strings where lossless integer handling matters.
- Encrypt sponsor wallet secret material before persisting it.
- Keep player session tokens and zkLogin ephemeral material out of `localStorage`.
- Use `sessionStorage` for browser-side ephemeral zkLogin material and short-lived player auth state.

## Additional Runtime Config

`MVP_SPEC.md` already defines the core env contract. This implementation plan adds a few runtime values that will be required by the chosen stack:

- `DATABASE_URL`
- `CELERIS_APP_ENCRYPTION_KEY`
- `CELERIS_DEVELOPER_JWT_SECRET`
- `CELERIS_PLAYER_JWT_SECRET`
- `CELERIS_CHECKOUT_SUCCESS_URL`
- `CELERIS_CHECKOUT_CANCEL_URL`

These additions do not change product scope. They exist so the runtime can persist data safely and issue bearer tokens cleanly.

## Data Model Plan

### Developer and app setup

- `DeveloperAccount`
  - `id`, `email`, `passwordHash`, timestamps
- `DeveloperSession`
  - `id`, `developerId`, `tokenHash`, `expiresAt`, timestamps
- `App`
  - `id`, `developerId`, `name`, `slug`, `allowedChainId`, `authProvider`, timestamps
- `ManagedAction`
  - `id`, `appId`, `actionType`, `priceCredits`, `isEnabled`, timestamps
- `SponsorWallet`
  - `id`, `appId`, `chainFamily`, `network`, `address`, `encryptedSecret`, timestamps
- `RegisteredProgram`
  - `id`, `appId`, `chainFamily`, `network`, `packageId`, `appStateObjectId`, `authorityCapObjectId`, timestamps

### Player auth and identity

- `AuthLoginRequest`
  - `id`, `appId`, `nonce`, `state`, `redirectUri`, `extendedEphemeralPublicKey`, `maxEpoch`, `status`, `expiresAt`, timestamps
- `PlayerIdentity`
  - `id`, `issuer`, `subject`, `salt`, `walletAddress`, timestamps
- `PlayerSession`
  - `id`, `playerIdentityId`, `appId`, `walletAddress`, `chainId`, `tokenHash`, `expiresAt`, timestamps

### Credits and purchase flow

- `CheckoutSession`
  - `id`, `appId`, `walletAddress`, `credits`, `status`, `successRedirectUrl`, `cancelRedirectUrl`, timestamps
- `CreditLedgerEntry`
  - `id`, `appId`, `walletAddress`, `chainId`, `deltaCredits`, `reason`, `referenceType`, `referenceId`, timestamps

### Sponsored action flow

- `PendingActionReservation`
  - `id`, `appId`, `walletAddress`, `chainId`, `actionType`, `status`, `username`, `message`, `creditsReserved`, `transactionBytes`, `sponsorSignature`, `sponsorAddress`, `expiresAt`, `submittedDigest`, timestamps
- `SponsorGasCoinLock`
  - `id`, `appId`, `reservationId`, `objectId`, `version`, `digest`, `status`, `expiresAt`, timestamps
- `TransactionRecord`
  - `id`, `appId`, `walletAddress`, `chainId`, `actionType`, `username`, `message`, `digest`, `explorerUrl`, `status`, `confirmedAt`, timestamps

## Public API Plan

### Developer API

- `POST /v1/developer/sign-up`
- `POST /v1/developer/sign-in`
- `POST /v1/developer/sign-out`
- `POST /v1/developer/apps`
- `GET /v1/developer/apps`
- `GET /v1/developer/apps/:appId`
- `POST /v1/developer/apps/:appId/sponsor-wallet`
- `GET /v1/developer/apps/:appId/sponsor-wallet`
- `PUT /v1/developer/apps/:appId/program`
- `GET /v1/developer/apps/:appId/program`
- `PUT /v1/developer/apps/:appId/actions/say_hello`

### Player auth API

- `POST /v1/auth/login-requests`
- `GET /v1/auth/google/start`
- `GET /v1/auth/google/callback`
- `POST /v1/auth/token`
- `POST /v1/auth/logout`
- `GET /v1/me`

### Player app API

- `GET /v1/apps/:appId/catalog`
- `GET /v1/apps/:appId/balance`
- `GET /v1/apps/:appId/transactions`
- `POST /v1/apps/:appId/checkout-sessions`
- `POST /v1/apps/:appId/checkout-sessions/:checkoutSessionId/complete`
- `POST /v1/apps/:appId/actions/say_hello/execute`
- `POST /v1/apps/:appId/actions/say_hello/complete`

## SDK Plan

### Browser SDK

The browser SDK is the main integration surface that the developer frontend app consumes.

Target API shape:

- `createCelerisBrowserClient(config)`
- `client.auth.startLogin()`
- `client.auth.handleRedirectCallback()`
- `client.auth.getSession()`
- `client.auth.signOut()`
- `client.apps.getCatalog()`
- `client.credits.getBalance()`
- `client.credits.startCheckout()`
- `client.actions.sayHello({ username })`
- `client.transactions.list()`

The SDK must own:

- login-request creation
- zkLogin ephemeral state generation
- auth-code exchange
- player bearer token storage in session-scoped storage
- canonical `say_hello` transaction building
- sponsored transaction submission
- completion reporting

### Server SDK

The server SDK is smaller and exists mainly to support developer provisioning examples and scripts.

Target API shape:

- `createCelerisServerClient(config)`
- `developers.signUp()`
- `developers.signIn()`
- `apps.create()`
- `apps.get()`
- `apps.provisionSponsorWallet()`
- `apps.registerProgram()`
- `apps.configureSayHello()`

## Vertical Slice Plan

## Slice 0: Workspace Bootstrap

### Goal

Stand up the repo structure and shared runtime skeleton so later slices do not fight build tooling.

### Deliverables

- `apps/api` Express bootstrap
- `apps/web` Next.js bootstrap
- `packages/db` Prisma bootstrap
- `packages/shared` with env validation and shared schema helpers
- `packages/sdk-browser` and `packages/sdk-server` package skeletons
- base TypeScript configuration and workspace scripts

### Tasks

- Set up workspace package boundaries and TS project references.
- Create Express bootstrapping with:
  - request ID middleware
  - structured logger
  - centralized error handler
  - `/health`
- Create Next.js bootstrapping with:
  - App Router
  - auth UI route group
  - demo UI route group
- Add Prisma schema, migrations folder, and generated client workflow.
- Add test harness for:
  - unit tests
  - API integration tests
  - Next.js component or route tests

### Exit criteria

- `npm run dev` boots both apps.
- `prisma migrate dev` works.
- the SDK packages compile.
- health checks are green.

## Slice 1: Developer App Setup

### Goal

A developer can create a new app, provision its sponsor wallet, register the Sui program metadata, configure `say_hello`, and point a Next.js frontend app at that app's public config.

### Database work

- Add `DeveloperAccount`
- Add `DeveloperSession`
- Add `App`
- Add `ManagedAction`
- Add `SponsorWallet`
- Add `RegisteredProgram`

### Express work

- Implement developer sign-up and sign-in.
- Implement bearer-token auth middleware for developer routes.
- Implement app creation and fetch routes.
- Implement sponsor-wallet provisioning and read routes.
- Implement program registration and read routes.
- Implement `say_hello` action configuration route.
- Add Sui ID validation helpers in `packages/shared`.

### Next.js work

- Add a minimal setup console under a dedicated route group.
- Allow a developer to:
  - sign up
  - sign in
  - create an app
  - provision a sponsor wallet
  - enter `packageId`, `appStateObjectId`, and `authorityCapObjectId`
  - configure the `say_hello` price
- Add a simple frontend app config module that uses:
  - `appId`
  - `apiOrigin`
  - `hostedAuthOrigin`
  - `redirectUri`
  - optional `suiRpcOrigin`

### SDK work

- Implement server SDK methods for developer provisioning.
- Do not bypass the public developer API from the setup console.

### Test plan

- developer sign-up and sign-in
- app creation
- sponsor-wallet provisioning is idempotent
- malformed Sui IDs are rejected
- `say_hello` action config is persisted correctly

### Exit criteria

- A blank database can reach the state "brand new app created and configured in Celeris."
- The frontend app has enough public config to proceed to player auth in the next slice.

## Slice 2: Hosted Player Auth and zkLogin Wallet Identity

### Goal

A player can sign in with real Google auth on the hosted auth origin, return to the demo app, and see a stable zkLogin wallet address.

### Database work

- Add `AuthLoginRequest`
- Add `PlayerIdentity`
- Add `PlayerSession`

### Express work

- Implement `POST /v1/auth/login-requests`.
- Implement Google OAuth start and callback endpoints.
- Implement Google ID-token verification using JWKS.
- Implement stable salt derivation.
- Implement zkLogin address derivation.
- Implement prover adapter integration.
- Implement auth-code exchange returning:
  - player bearer token
  - wallet identity
  - zkLogin proof material needed for silent signing
- Implement `GET /v1/me`.

### Next.js work

- Add hosted auth login page on the auth origin.
- Add redirect/callback handling page on the demo origin.
- Add signed-in header state showing wallet address.
- Add logout flow.

### SDK work

- Generate zkLogin ephemeral keypair and randomness.
- Store ephemeral secret material in `sessionStorage`.
- Start hosted login.
- Handle callback completion.
- Exchange auth code for player session.
- Store the player bearer token in session-scoped storage.

### Test plan

- same Google subject returns same wallet address across repeat logins
- login-request expiry is enforced
- redirect URI validation is enforced
- browser storage does not persist sensitive material to `localStorage`
- `/v1/me` reflects the authenticated player session

### Exit criteria

- A player can sign in through the Next.js app and see the stable Sui wallet address.
- The browser SDK owns the full login flow.

## Slice 3: Credits and Purchase Flow

### Goal

A signed-in player can buy credits through a hosted mock checkout flow and see the updated balance in the frontend app.

### Database work

- Add `CheckoutSession`
- Add `CreditLedgerEntry`

### Express work

- Implement `GET /v1/apps/:appId/catalog`.
- Implement `GET /v1/apps/:appId/balance`.
- Implement `POST /v1/apps/:appId/checkout-sessions`.
- Implement `POST /v1/apps/:appId/checkout-sessions/:checkoutSessionId/complete`.
- Implement append-only credit ledger writes for:
  - purchase
  - future reserve
  - future capture
  - future release

### Next.js work

- Add a hosted mock checkout page.
- Redirect the player from the demo app to checkout and back.
- Refresh balance after checkout success.
- Show action pricing from the catalog response.

### SDK work

- Implement catalog fetch.
- Implement balance fetch.
- Implement checkout session creation and redirect helpers.

### Test plan

- checkout session creation
- checkout completion creates the right credit ledger entries
- balance query reflects ledger state
- repeat completion calls are idempotent

### Exit criteria

- A signed-in player can buy credits and see the new balance without manual database changes.

## Slice 4: Sponsored `say_hello` and Transaction Feed

### Goal

A player with credits can execute `say_hello` on Sui testnet through the sponsored transaction flow and see the result in the app-wide feed.

### Database work

- Add `PendingActionReservation`
- Add `SponsorGasCoinLock`
- Add `TransactionRecord`

### Sui and shared package work

- Finalize the Move package for:
  - `initialize_app`
  - `say_hello`
- Add shared TS helpers for:
  - address and object ID validation
  - username normalization
  - canonical `say_hello` transaction construction
  - exact-match transaction validation

### Express work

- Implement `POST /v1/apps/:appId/actions/say_hello/execute`.
- Implement `POST /v1/apps/:appId/actions/say_hello/complete`.
- Implement `GET /v1/apps/:appId/transactions`.
- Implement sponsor gas coin selection and locking.
- Implement credit reserve on `execute`.
- Implement sponsor signing.
- Implement credit capture or release on completion.
- Implement digest verification against Sui RPC.
- Implement a lightweight reconciliation loop for `submitted` records that are not final yet.

### Next.js work

- Add username entry form.
- Add execute button and pending state.
- Add app-wide transaction feed with:
  - wallet address
  - username
  - rendered message
  - status
  - timestamp
  - Explorer link

### SDK work

- Build canonical `say_hello` transaction kind.
- Call execute route.
- Add zkLogin user signature.
- Submit directly to Sui RPC.
- Call completion route.
- Refresh balance and feed after execution.

### Test plan

- invalid transaction kinds are rejected
- credits are reserved before sponsor signing
- failed submission releases credits
- successful submission records digest and explorer URL
- feed order is newest first
- 101st greeting is rejected by the Move package

### Exit criteria

- A player can execute paid `say_hello` end to end.
- The resulting transaction appears in the app-wide feed.

## Slice 5: SDK Consumer Hardening, Walkthrough, and Regression

### Goal

Turn the reference implementation into a real developer-integration demo and finish the operational surface needed to run the MVP from scratch.

### Deliverables

- The Next.js app consumes only public browser SDK APIs for player flows.
- The setup console and walkthrough support the end-to-end demo path.
- Regression coverage exists for each major slice.
- The manual Sui registration flow is documented step by step.

### Express work

- Tighten DTO schemas and response contracts.
- Add structured audit logging around:
  - developer sign-in
  - sponsor-wallet provisioning
  - program registration
  - checkout completion
  - transaction execution
- Add admin-safe health diagnostics for auth, prover, and Sui RPC connectivity.

### Next.js work

- Remove any remaining direct API plumbing from demo pages that bypasses the SDK.
- Finalize UX for:
  - developer setup
  - player sign-in
  - purchase
  - `say_hello`
  - transaction feed

### SDK work

- Freeze the minimal public config contract.
- Add integration examples for a developer-owned Next.js frontend.
- Add browser SDK error classes for:
  - auth failures
  - insufficient credits
  - sponsorship failures
  - transaction verification failures

### Docs work

- Add the manual walkthrough required by `MVP_SPEC.md`.
- Include exact steps for:
  - env setup
  - database bootstrap
  - Google OAuth setup
  - prover startup
  - app creation
  - sponsor wallet funding
  - Move package publish
  - `initialize_app`
  - manual program registration
  - action configuration
  - frontend startup
  - sign-in, purchase, and `say_hello`

### Test plan

- API integration tests against a real Postgres test database
- Playwright end-to-end tests for the Next.js setup and player flows
- mocked automated tests for Google verifier, prover, and Sui RPC adapters
- manual smoke test against real Google auth and Sui testnet

### Exit criteria

- The walkthrough works from an empty database.
- The reference frontend app proves real SDK consumption.
- The regression suite covers the full MVP path.

## Cross-Cutting Implementation Details

## Authentication model

- Developer auth and player auth are separate concerns.
- Developer auth uses simple credentials plus bearer token.
- Player auth uses Google OAuth plus zkLogin plus player bearer token.
- Player identity is stable by `issuer + subject + salt -> walletAddress`.

## Session model

- Developer sessions are bearer tokens stored server-side as hashes.
- Player sessions are bearer tokens stored server-side as hashes.
- Browser-side player tokens are held in memory plus `sessionStorage`, never `localStorage`.

## Secret handling

- Sponsor wallet secrets are encrypted at rest.
- Google client secret stays server-side only.
- Raw Google ID tokens should not be persisted after verification.
- zkLogin ephemeral private keys stay in browser session storage only.

## Reconciliation model

- `execute` writes reservation state and reserves credits.
- `complete` moves a reservation to `submitted` or `failed`.
- If `submitted` cannot be finalized immediately, a reconciliation worker polls Sui RPC and settles:
  - `confirmed`
  - `failed`
- Credit ledger effects must be idempotent and reference-based.

## Testing Strategy

### Automated tests

- unit tests for validators, helpers, and services
- integration tests for Express + Prisma + Postgres
- browser and route tests for Next.js
- end-to-end tests for setup, login, purchase, and `say_hello`

### External dependency strategy

Automated tests should use adapters and test doubles for:

- Google JWKS verification
- zkLogin prover
- Sui RPC

Manual smoke tests should cover:

- real Google login
- real prover integration
- real Sui testnet execution

## Key Risks and Mitigations

### zkLogin flow complexity

Risk:
- hosted auth, prover inputs, and browser callback handling can drift if the browser SDK and API are built separately

Mitigation:
- ship Slice 2 as one slice owned by both API and SDK changes
- keep one canonical login-request schema in `packages/shared`

### Sponsor gas coin locking

Risk:
- double-use of the same gas coin across concurrent requests

Mitigation:
- persist coin locks in Postgres
- always lock by reservation ID with TTL
- release locks in completion and reconciliation paths

### Real Google auth in local development

Risk:
- callback URI and multi-origin auth setup is fragile

Mitigation:
- use one Next.js codebase with two local origins
- document exact localhost ports and Google callback URIs
- keep callback handling in one place

### SDK drift from reference app

Risk:
- the internal app starts depending on private modules instead of the public SDK

Mitigation:
- enforce package boundaries
- make Slice 5 explicitly remove private integration shortcuts

## Final Definition of Done

The implementation is complete only when all of the following are true:

- all six slices are complete
- the Move package is published and can be manually initialized
- a brand new app can be created in Celeris from the setup console or developer API
- the sponsor wallet can be provisioned and funded
- the Sui program can be manually registered against that app
- the Next.js frontend app consumes the browser SDK for player flows
- a player can sign in with real Google + zkLogin
- a player can buy credits
- a player can execute paid `say_hello`
- the transaction feed renders the resulting entry with Explorer link
- `npm run typecheck` passes
- `npm test` passes
- the manual walkthrough has been executed successfully from a clean database
