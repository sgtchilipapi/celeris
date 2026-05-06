# Solana Devnet Hello Demo Plan

## Summary

This plan adds a real Solana devnet-backed demo slice to Celeris.

The player-facing demo is simplified to:

- hosted Celeris auth wrapping Privy
- wallet address display
- credit balance display
- a paid `say_hello` action
- an app-wide transaction feed with Solana Explorer links

This slice intentionally pivots from localnet to Solana devnet so:

- Privy support remains aligned with the supported Solana path
- external testers such as hackathon judges can use the same deployed demo
- transaction inspection works cleanly in Solana Explorer

The transaction responsibility split is:

- the frontend initiates the action
- Celeris authenticates, validates, and builds the transaction
- the per-project sponsor wallet pays SOL and signs as fee payer
- Celeris submits and confirms through the relayer path
- the Solana program mutates on-chain state

The sponsor wallet is per app, funded by the developer, and controlled by Celeris for managed execution.

## Product Decisions

- Chain target is Solana devnet, using `solana:103` in player policy and app configuration.
- The demo keeps one player surface only: `mock-game-frontend/`.
- The current RPG-style player demo is hard-cut to a simplified Hello Celeris demo.
- The demo action surface is hard-cut to:
  - `purchase_credits` through the existing mock Stripe checkout path
  - `say_hello` through a real Solana devnet transaction
- The player transaction panel shows all Celeris-submitted transactions for the app, not only the current player's transactions and not a chain-wide program scan.
- Program registration becomes a real backend capability, not a demo-script-only convention.
- One registered Solana program is supported per app in this slice.
- The implementation remains mostly manual:
  - add in-repo program source
  - add helper docs and scripts
  - do not add a one-command orchestrator for validator, deploy, app setup, and frontend boot

## Objective

Deliver a devnet-backed vertical slice where:

1. a developer deploys a Solana program to devnet
2. a developer creates a Celeris app
3. the developer registers the deployed program with Celeris
4. the developer configures a sponsor wallet for that app and funds it with SOL
5. the simplified browser demo signs players in through hosted Celeris auth
6. players purchase credits through the mock Stripe path
7. players execute a paid `say_hello` action
8. Celeris builds, sponsors, submits, and confirms a real devnet transaction
9. the frontend shows the resulting app transaction feed with Explorer links

## Work Order Sequence

Shared implementation context for all work orders:

- [SDH-context](./WORK_ORDERS/SDH-context.md)

| WO | Title | Primary Output | Depends On |
| --- | --- | --- | --- |
| [SDH-01](./WORK_ORDERS/SDH-01-anchor-hello-program.md) | Anchor hello program | in-repo devnet program, PDA rules, client helpers | none |
| [SDH-02](./WORK_ORDERS/SDH-02-program-registration-and-sponsor-wallet-foundations.md) | Program registration and sponsor wallet foundations | backend models and developer APIs for registered programs and sponsor wallets | SDH-01 |
| [SDH-03](./WORK_ORDERS/SDH-03-sponsored-devnet-relayer.md) | Sponsored devnet relayer | real Solana RPC submission with app sponsor-wallet signing | SDH-01, SDH-02 |
| [SDH-04](./WORK_ORDERS/SDH-04-say-hello-managed-action-and-player-feed.md) | Say hello managed action and player feed | paid `say_hello` execution and app-wide player transaction feed | SDH-01, SDH-02, SDH-03 |
| [SDH-05](./WORK_ORDERS/SDH-05-simplified-browser-demo.md) | Simplified browser demo | hard-cut `mock-game-frontend` to the Hello Celeris devnet flow | SDH-02, SDH-04 |
| [SDH-06](./WORK_ORDERS/SDH-06-manual-setup-and-regression.md) | Manual setup and regression | helper scripts, docs cleanup, regression suite, final canonical manual flow | SDH-01, SDH-02, SDH-03, SDH-04, SDH-05 |

## Transaction Lifecycle

### Sponsorship model

Each app gets one sponsor wallet.

The sponsor wallet must be treated as:

- a Celeris-controlled Solana keypair
- scoped to one app
- funded by the developer with devnet SOL
- used as fee payer for managed app transactions

This is required because the fee payer must sign on Solana.

The supported model in this slice is not:

- developer-owned external fee payer signing outside Celeris
- browser-signed player transactions
- mixed custody or delegated signing flows

### Runtime sequence

1. The player clicks `Say Hello Celeris` in the browser demo.
2. The browser SDK sends `POST /v1/apps/:appId/actions/say_hello/execute` with:
   - the Celeris player session bearer token
   - payload `{ username }`
3. Celeris authenticates the player session and derives wallet identity from the session.
4. Celeris validates:
   - action exists
   - action is managed
   - credits are sufficient
   - username is valid
   - app has a registered devnet program
   - app has an active sponsor wallet
   - sponsor wallet has enough SOL for fees
5. Celeris reserves credits.
6. Celeris builds the real Solana instruction and transaction for `say_hello`.
7. Celeris sets the sponsor wallet as fee payer.
8. The sponsor wallet signs the transaction.
9. Celeris submits the signed transaction to devnet RPC.
10. Celeris waits for confirmation or failure.
11. On success:
    - Celeris stores the real signature
    - Celeris stores the Explorer URL
    - Celeris captures credits
    - Celeris records the transaction in the app feed
12. On failure:
    - Celeris marks the transaction failed
    - Celeris releases reserved credits
    - Celeris records the failure in the transaction log

## On-Chain Program

Add an in-repo Anchor program for this slice.

### Program responsibilities

- maintain one app-scoped state account
- append greeting entries
- expose deterministic instruction interfaces for Celeris

### Program instructions

- `initialize_app`
  - initializes the app PDA-backed state account
  - binds the state to the Celeris app identifier and authority model used by this slice
- `say_hello`
  - accepts the player's wallet and username
  - appends a greeting entry

### Greeting entry shape

Each appended entry must record:

- player wallet address
- username
- rendered message
- created timestamp
- transaction signature is not stored on-chain; Celeris stores that off-chain

The rendered message is always:

- `"<username> says Hello Celeris!"`

The client must not submit arbitrary message text.

### Capacity rule

The app state vector should be capped to a fixed size for MVP safety.

For this slice:

- preallocate capacity for 100 greeting entries
- reject writes once full
- treat resizing, pagination, and archival as out of scope

## Backend Changes

### New domain concepts

Add first-class backend models for:

- `RegisteredProgram`
- `SponsorWallet`
- `AppTransactionFeedEntry` or equivalent transaction projection for player feed responses

### Registered program model

Add a model equivalent to:

- `appId`
- `chainFamily: "solana"`
- `cluster: "devnet"`
- `programId`
- `statePda`
- `createdAt`
- `updatedAt`

This is backend-owned data and must not live only in frontend config.

### Sponsor wallet model

Add a model equivalent to:

- `appId`
- `chainFamily: "solana"`
- `cluster: "devnet"`
- `publicKey`
- `status`
- `createdAt`
- `updatedAt`

The private key material must be treated as Celeris-controlled operational state.

For this MVP slice, the plan assumes:

- one sponsor wallet per app
- no wallet rotation flow
- no multi-wallet routing

### Action model changes

Add managed `say_hello` as the primary demo action.

The payload shape is:

- `{ username: string }`

Validation rules:

- trim before validation
- length `1..32`
- reject empty values after trim
- reject caller-supplied wallet address
- reject caller-supplied freeform message text

`say_hello` is a paid action and uses configured credits like other managed actions.

### Transaction model changes

The current transaction summary is mint-item-specific.

Generalize it to support at least:

- `say_hello`
- existing managed transaction-capable actions that remain in backend tests or compatibility paths during transition

For `say_hello`, transaction metadata must retain:

- action ID
- player wallet address
- username
- rendered message
- sponsor wallet public key
- Solana signature
- explorer URL
- status
- timestamps

### Relayer changes

Replace the current synthetic relayer payload model for this slice.

The real relayer path must:

- build a real Solana transaction through `@solana/web3.js`
- sign with the app sponsor wallet
- submit to a configurable devnet RPC endpoint
- poll or confirm against RPC
- return the real Solana signature as the provider transaction ID

The relayer must no longer assume one global generic signer for sponsored app actions.
It must resolve the correct app sponsor wallet on each `say_hello` execution.

### Backend services

Add or refactor service responsibilities so the runtime cleanly separates:

- program registration
- sponsor wallet management
- say-hello transaction building
- sponsor-wallet fee-payer signing
- transaction submission and confirmation
- player transaction feed projection

The managed action builder must stop returning a base64-encoded JSON placeholder for this path.
It should return a typed prepared Solana action or equivalent backend-native transaction input used by the relayer.

## API Changes

### Developer API

Add:

- `GET /v1/developer/apps/:appId/program`
- `PUT /v1/developer/apps/:appId/program`
- `GET /v1/developer/apps/:appId/sponsor-wallet`
- `POST /v1/developer/apps/:appId/sponsor-wallet`

Expected behavior:

- `PUT /program`
  - validates the devnet program ID
  - derives or validates the app state PDA
  - persists the registration
  - can initialize app state on chain when missing
- `POST /sponsor-wallet`
  - creates or provisions the Celeris-controlled sponsor wallet for the app
  - returns the public funding address and current status
- `GET /sponsor-wallet`
  - returns the sponsor wallet public key and funding status metadata

Extend:

- `GET /v1/developer/apps/:appId`

It must now include:

- registered program details
- sponsor wallet details
- action configuration including `say_hello`

### Player API

Keep:

- `POST /v1/apps/:appId/actions/:actionId/execute`

Add supported player action:

- `actionId = "say_hello"`

Add:

- `GET /v1/apps/:appId/transactions`

This endpoint returns the app-wide Celeris-submitted transaction feed.

The response must include enough data for the bottom player panel:

- transaction ID
- action ID
- Solana signature
- explorer URL
- player wallet address
- username
- rendered message
- status
- submitted timestamp
- confirmed timestamp if available

Extend:

- `GET /v1/apps/:appId/catalog`

It must include:

- the registered program summary
- the sponsor model only if safe to expose publicly
- the configured `say_hello` action metadata needed by the demo

Do not expose private sponsor-wallet secrets through any route.

## Frontend Changes

Hard-cut `mock-game-frontend/` to the simplified demo.

### Required UI

After login, the player sees:

- wallet address
- credit balance
- username input
- `Purchase Credits` button
- `Say Hello Celeris` button
- transaction feed panel at the bottom

### Required behavior

- sign in through the existing hosted Celeris auth flow
- use the browser SDK for all player API calls
- create checkout sessions through the existing mock Stripe path
- execute `say_hello` through the player API
- refresh balance and transaction feed after action success
- render Solana Explorer links for successful or submitted transactions

### Removed behavior

Remove the RPG-oriented player flow from the demo:

- characters
- quests
- claim-reward flow
- mint-item flow
- delivery-history-centric inventory presentation

The demo should optimize for one understandable end-to-end story:

- sign in
- buy credits
- say hello on chain
- inspect the transaction

### Frontend config

Shrink the standalone frontend config to public runtime values only.

It should carry:

- app ID
- app name
- API origin
- hosted auth origin
- redirect URI

Do not keep old RPG action IDs or placeholder program IDs in the default demo config.

The frontend should load action and program metadata from the player API rather than relying on stale local config.

## Tooling And Scripts

Add in-repo program and deploy helpers, but keep the workflow manual.

### Required additions

- Anchor workspace for the Hello Celeris program
- build and deploy instructions for devnet
- script or documented commands to:
  - deploy the program
  - register the deployed program with a Celeris app
  - provision the sponsor wallet
  - print the sponsor funding address

### Explicit non-goals

Do not add:

- local validator orchestration
- a one-command full demo bootstrapper for this slice
- localnet-only chain support

## Testing Plan

### Unit tests

- program registration validation
- sponsor wallet provisioning logic
- sponsor balance preflight behavior
- `say_hello` payload validation
- transaction builder output for devnet program calls
- explorer URL generation
- transaction feed projection formatting

### Integration tests

- developer creates app
- developer registers devnet program
- developer provisions sponsor wallet
- developer configures paid `say_hello`
- player completes mock checkout
- player executes `say_hello`
- Celeris reserves and captures credits on success
- Celeris releases credits on failure
- transaction record stores real-signature-shaped provider ID and explorer URL
- app-wide player feed returns the new transaction

### Manual smoke tests

1. Deploy Anchor program to Solana devnet.
2. Start API with hosted auth config.
3. Create a developer app.
4. Register the deployed program.
5. Provision the app sponsor wallet.
6. Fund the sponsor wallet with devnet SOL.
7. Start the standalone frontend.
8. Sign in through hosted Celeris auth.
9. Buy credits through the mock checkout path.
10. Execute `say_hello`.
11. Verify:
   - credits were debited
   - transaction appears in the bottom panel
   - Explorer link resolves on devnet
   - the on-chain greeting state was updated

## Acceptance Criteria

- The demo uses Solana devnet, not localnet.
- The player-facing demo has only wallet, credits, username, purchase, hello, and transaction-feed surfaces.
- `say_hello` creates a real Solana devnet transaction.
- The app sponsor wallet is the fee payer and signing sponsor for managed app transactions.
- Sponsor wallet funding is developer-visible and required before successful submission.
- The transaction feed in the player demo shows app-wide Celeris-submitted transactions with Explorer links.
- Program registration and sponsor-wallet setup are real backend concepts exposed through the developer API.
- The frontend never signs player transactions directly for this slice.
- The runtime never accepts caller-supplied wallet identity as the source of truth for player actions.

## Assumptions

- `solana:103` remains the supported chain ID for this devnet slice.
- One program per app is sufficient for this phase.
- One sponsor wallet per app is sufficient for this phase.
- Sponsor wallet rotation, withdrawal flows, and production-grade key management are out of scope for this MVP slice.
- The mock Stripe checkout remains acceptable for the demo purchase path.
- The player transaction feed is sourced from Celeris-stored managed transactions, not from a chain-wide indexer or explorer scrape.

## Work Order Files

- [SDH-context.md](./WORK_ORDERS/SDH-context.md)
- [SDH-01-anchor-hello-program.md](./WORK_ORDERS/SDH-01-anchor-hello-program.md)
- [SDH-02-program-registration-and-sponsor-wallet-foundations.md](./WORK_ORDERS/SDH-02-program-registration-and-sponsor-wallet-foundations.md)
- [SDH-03-sponsored-devnet-relayer.md](./WORK_ORDERS/SDH-03-sponsored-devnet-relayer.md)
- [SDH-04-say-hello-managed-action-and-player-feed.md](./WORK_ORDERS/SDH-04-say-hello-managed-action-and-player-feed.md)
- [SDH-05-simplified-browser-demo.md](./WORK_ORDERS/SDH-05-simplified-browser-demo.md)
- [SDH-06-manual-setup-and-regression.md](./WORK_ORDERS/SDH-06-manual-setup-and-regression.md)
