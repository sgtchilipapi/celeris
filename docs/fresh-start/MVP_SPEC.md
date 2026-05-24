# Fresh Start Sui MVP Spec

Build a clean, single-path "Celeris" MVP. Assume the repo starts from only the necessary env/runtime contract plus the in-repo `hello_celeris` Move package. Everything else should be implemented only to support one canonical demo: a brand new app is created in Celeris, manually connected to a deployed Sui package through a documented walkthrough, then used by a user who signs in with real Google + zkLogin, buys credits, and executes paid `say_hello` on Sui testnet.

## Product Goal

The MVP must prove this full story end to end:

1. A developer creates a new app in Celeris.
2. Celeris provisions a sponsor wallet for that app.
3. The developer publishes the in-repo Move package, runs `initialize_app`, and manually registers the resulting Sui IDs into Celeris using a walkthrough.
4. The developer configures the paid `say_hello` action.
5. The developer consumes the Celeris browser SDK in its frontend app and configures it for the new app.
6. A user signs in through hosted Google auth and gets a stable zkLogin Sui wallet.
7. The user buys credits.
8. The user executes `say_hello` through a sponsored transaction flow.
9. The app-wide transaction feed shows the recorded result with a Sui Explorer link.

## Scope

- One supported network: `sui:testnet`.
- One hosted auth provider: Google OAuth, resolved into zkLogin.
- One in-repo Move package with two entrypoints: `initialize_app` and `say_hello`.
- One sponsor wallet per app.
- One registered Sui package per app.
- One managed paid action: `say_hello`.
- One canonical developer integration path where the frontend app consumes the Celeris browser SDK.
- One user demo UI with wallet, credits, username input, purchase flow, execute button, and app-wide feed.
- One manual walkthrough for package publish, app initialization, registration, and demo run.

## On-Chain Contract

- The Move package exposes `initialize_app(app_id)` and `say_hello(authority_cap, app_state, clock, username)`.
- `initialize_app` creates:
  - one shared `AppState`
  - one owned `AppAuthorityCap`
- `AppState` stores:
  - raw `appId`
  - `entryCount`
  - `entries`
- Each greeting entry stores:
  - `userWallet`
  - `username`
  - `message`
  - `createdTimestampMs`
- `say_hello` must:
  - derive the user wallet from `TxContext.sender()`
  - trim and normalize username before use in the client and backend path
  - accept only non-empty usernames up to 32 UTF-8 bytes
  - render the message canonically as `"<username> says Hello Celeris!"`
  - reject writes after 100 entries

## System Responsibilities

- The browser SDK creates zkLogin ephemeral state before hosted auth begins.
- Hosted auth runs on the Celeris auth origin and uses real Google account selection.
- The backend verifies the Google identity token, resolves a stable user salt, derives the zkLogin Sui address, gets proof inputs, and issues the user session.
- The browser SDK builds the canonical `say_hello` `TransactionKind`.
- The backend rebuilds and validates the same canonical transaction before sponsorship.
- The backend reserves credits, selects sponsor gas, builds transaction bytes, sponsor-signs them, and returns the sponsorship payload.
- The browser silently adds the zkLogin user signature and submits directly to Sui RPC.
- The browser reports `submitted` or `failed`.
- The backend verifies the digest, captures or releases credits, and records the transaction.

## Developer Flow

1. Create a new Celeris app with `allowedChainId = sui:testnet` and `authProvider = zklogin`.
2. Provision the sponsor wallet through the developer API.
3. Fund the sponsor wallet with testnet SUI.
4. Publish the Move package manually.
5. Call `initialize_app` manually and record:
   - `packageId`
   - `appStateObjectId`
   - `authorityCapObjectId`
6. Register those Sui IDs against the app through the developer API.
7. Configure the `say_hello` action cost in credits.
8. Consume the Celeris browser SDK in the frontend app and configure it with the app's public runtime values.
9. Launch the user demo.

The Sui registration step must not be auto-orchestrated. The repo must include a walkthrough with exact manual steps and example commands.

## user Flow

1. Open the demo frontend for the newly created app.
2. Start hosted sign-in.
3. Complete real Google auth on the Celeris auth origin.
4. Return with a valid Celeris user session tied to a stable zkLogin Sui address.
5. View wallet address, credit balance, and app transaction feed.
6. Purchase credits through the demo purchase flow.
7. Enter a username and click `Say Hello Celeris`.
8. The browser SDK builds the canonical transaction, gets sponsorship, silently signs with zkLogin, and submits to Sui.
9. The UI refreshes balance and feed state after completion.

## Required Env Contract

- `CELERIS_GOOGLE_CLIENT_ID`
- `CELERIS_GOOGLE_CLIENT_SECRET`
- `CELERIS_GOOGLE_ISSUER`
- `CELERIS_SESSION_SECRET`
- `CELERIS_HOSTED_AUTH_ORIGIN`
- `CELERIS_DEMO_FRONTEND_ORIGIN`
- `CELERIS_ZKLOGIN_SALT_SEED`
- `CELERIS_ZKLOGIN_PROVER_ORIGIN`
- `CELERIS_ZKLOGIN_MAX_EPOCH_WINDOW`
- `CELERIS_SUI_RPC_ORIGIN`

The repo should fail closed when required auth, session, prover, or RPC env values are missing.

## Core Backend Models

- `App`
  - `appId`, `name`, `allowedChainId`, `authProvider`, timestamps
- `RegisteredProgram`
  - `appId`, `chainFamily`, `network`, `packageId`, `appStateObjectId`, `authorityCapObjectId`, timestamps
- `SponsorWallet`
  - `appId`, `chainFamily`, `network`, `address`, timestamps
- `SponsorWalletSecret`
  - stored privately and never returned from APIs
- `userSession`
  - `userId`, `walletAddress`, `chainId`, auth/session metadata, zkLogin session material needed by the browser
- `CreditLedgerEntry`
  - purchase, reserve, capture, release events
- `PendingActionReservation`
  - `reservationId`, `appId`, `walletAddress`, `username`, `message`, sponsor gas data, tx bytes, sponsor signature, expiry, status
- `TransactionRecord`
  - `transactionId`, `appId`, `actionId`, `walletAddress`, `username`, `message`, `digest`, `explorerUrl`, `status`, timestamps

## API Contract

- Developer API:
  - `POST /v1/developer/apps`
  - `GET /v1/developer/apps/:appId`
  - `POST /v1/developer/apps/:appId/sponsor-wallet`
  - `GET /v1/developer/apps/:appId/sponsor-wallet`
  - `PUT /v1/developer/apps/:appId/program`
  - `GET /v1/developer/apps/:appId/program`
  - route to configure `say_hello` action pricing for the app
- Auth and user API:
  - hosted login start route
  - Google callback route on the auth origin
  - auth code exchange route returning user session plus zkLogin session material
  - `GET /v1/apps/:appId/catalog`
  - `GET /v1/apps/:appId/balance`
  - `GET /v1/apps/:appId/transactions`
  - purchase and checkout start and completion routes
  - `POST /v1/apps/:appId/actions/say_hello/execute`
  - `POST /v1/apps/:appId/actions/say_hello/complete`

`execute` input should remain `{ username, transactionKind }`.

`execute` output should include `reservationId`, `transactionBytes`, `sponsorSignature`, `sponsorAddress`, `expiresAt`, `username`, and canonical `message`.

`complete` input should include `reservationId`, `outcome`, and `digest` when submitted.

## Browser SDK Contract

- Be consumable by a developer-owned frontend app through a minimal initialization contract.
- Support public runtime configuration for at least `appId`, `apiOrigin`, `hostedAuthOrigin`, `redirectUri`, and optional `suiRpcOrigin`.
- Generate and store zkLogin ephemeral key material in `sessionStorage` only.
- Build the canonical `say_hello` `TransactionKind`.
- Request sponsorship from Celeris.
- Add zkLogin user signature silently.
- Submit directly to `CELERIS_SUI_RPC_ORIGIN`.
- Report completion back to Celeris.
- Expose simple user methods for auth, catalog, balance, feed, purchase, and `say_hello`.

## Walkthrough Requirement

The repo must include one clear manual walkthrough covering:

1. Required env setup.
2. Starting the API and hosted auth.
3. Creating a new app.
4. Provisioning and funding the sponsor wallet.
5. Publishing the Move package.
6. Running `initialize_app`.
7. Registering package and object IDs in Celeris.
8. Configuring action pricing.
9. Consuming and configuring the Celeris browser SDK in the frontend app.
10. Starting the frontend.
11. Signing in, purchasing credits, and executing `say_hello`.

## Acceptance Criteria

- A new app can be created in Celeris and fully configured for the demo.
- Sponsor wallet creation is idempotent and returns a stable public address.
- The Move package publishes successfully and `initialize_app` produces the required objects.
- Manual registration of the Sui package into Celeris succeeds through the documented flow.
- A developer frontend app can consume the Celeris browser SDK with the documented public runtime config and complete the canonical flow.
- Real Google login produces a stable zkLogin Sui address for repeat logins by the same user.
- The user can purchase credits and see the balance update.
- The user can execute paid `say_hello` without a separate signing popup.
- The backend verifies the submitted digest and reconciles credits correctly.
- The transaction feed shows the resulting entry with digest, status, timestamp, wallet, username, message, and Explorer link.

## Implementation Order

1. Add the Move package and shared Sui transaction helpers.
2. Implement hosted Google auth, zkLogin address derivation, proof handling, and user session issuance.
3. Implement developer app creation, sponsor-wallet provisioning, and program registration.
4. Implement credits and purchase flow.
5. Implement sponsored `say_hello` execution, completion, and reconciliation.
6. Implement the browser SDK flow for silent zkLogin signing and submission.
7. Implement the simplified frontend app that consumes the browser SDK.
8. Write the manual walkthrough and end-to-end verification steps.
