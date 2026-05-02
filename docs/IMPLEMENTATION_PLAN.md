# Updated MVP Implementation Plan

## Objective

Transition the current codebase from the original MVP to the updated MVP specification defined by:

- `docs/sdk-pivot.md`
- `docs/future-refactorings.md`

The updated MVP must satisfy all of the following:

- player sign-up and sign-in use a Celeris-hosted auth gateway backed by Privy's embedded wallets
- Celeris owns the shared Privy app used for player authentication across all Celeris apps
- Celeris verifies Privy identity at the hosted gateway and issues player sessions for browser access
- player identity is shared across apps and scoped in product data by wallet principal plus `appId`
- wallet address becomes the product-level player reference
- credits are owned by `(appId, chainId, walletAddress)`
- in-game assets are delivered directly to player wallets
- Celeris records asset delivery metadata, not custody
- demo actions run as managed Celeris actions
- the mock developer backend is removed from the demo path
- frontend and backend integrations use SDKs
- player, developer, and service APIs are separated
- hosted browser login runs on `auth.celeris.pro`

## Planning Rules

All work orders in this plan are hard-cut work orders.

That means:

- remove incompatible routes in the same WO that introduces their replacement
- remove incompatible fields from types, storage, and API payloads in the same WO that replaces them
- do not keep dual `userId` and `walletAddress` player contracts
- do not keep both custody and non-custodial asset models
- do not keep the mock developer backend once managed demo actions exist
- do not preserve legacy player auth endpoints as compatibility shims

Developer authentication is not part of the identity pivot. It may continue to use developer accounts, but all developer routes must become bearer-authenticated and isolated from the player API.

## Target Runtime Surface

### Player API

- `POST /v1/auth/login-requests`
- `POST /v1/auth/token`
- `GET /v1/me`
- `GET /v1/apps/:appId/me/credits`
- `GET /v1/apps/:appId/me/asset-history`
- `GET /v1/apps/:appId/catalog`
- `POST /v1/apps/:appId/checkout-sessions`
- `POST /v1/apps/:appId/actions/:actionId/execute`

### Hosted Auth UI

- `GET https://auth.celeris.pro/auth/login?loginRequestId=...`

### Developer API

- `POST /v1/developer/sign-up`
- `POST /v1/developer/sign-in`
- `GET /v1/developer/apps`
- `POST /v1/developer/apps`
- `PUT /v1/developer/apps/:appId`
- `GET /v1/developer/apps/:appId`
- `POST /v1/developer/apps/:appId/actions`
- `PUT /v1/developer/apps/:appId/actions/:actionId`
- `DELETE /v1/developer/apps/:appId/actions/:actionId`
- `GET /v1/developer/apps/:appId/metrics`
- `GET /v1/developer/apps/:appId/players`
- `GET /v1/developer/apps/:appId/transactions`

### Service API

- `POST /v1/webhooks/stripe`

## Global Invariants

The final codebase must satisfy all of these invariants:

1. No player-facing route accepts `userId`, `walletAddress`, or `chainId` from a request body as the source of truth.
2. Player identity is derived from the authenticated Celeris player session created from hosted Privy login.
3. All credit balances, pending actions, payments, transactions, usage events, and asset deliveries are keyed by wallet principal, not public `userId`.
4. The runtime has no dependency on `developerWebhookUrl` for the demo path.
5. The runtime has no custody-oriented asset state such as `status: "held"`.
6. The repo exposes one player demo surface only: `mock-game-frontend/`.
7. The repo exposes SDK entrypoints for frontend and backend integration.
8. The repo has no remaining player username/password sign-up or sign-in flow.
9. The repo has no mock developer backend process, script, or test path.
10. No developer-facing app contract accepts or persists per-app Privy ownership fields such as `privyAppId`.
11. The runtime owns one shared Privy app configuration for player auth across all Celeris apps.
12. Browser login runs through a Celeris-controlled hosted auth origin on `auth.celeris.pro`.
13. Developer frontend origin and redirect URI validation are enforced by Celeris, not by per-developer Privy ownership.

## Legacy Inventory To Remove

These files, modules, routes, or concepts are incompatible with the updated MVP and must be removed or replaced by the work orders below:

- `celeris/services/auth-service.ts` in its current player username/password and dummy-email form
- `POST /auth/session`
- `POST /player/sign-up`
- `POST /player/sign-in`
- `celeris/services/developer-backend-client.ts`
- `celeris/services/mock-developer-client.ts`
- `scripts/mock-developer-backend.ts`
- `scripts/manual-dev-setup-flow.sh`
- per-app `privyAppId` player-auth ownership in developer app configuration
- `developerWebhookUrl` / `webhookUrl` app configuration
- custody-oriented `Asset` model and `AssetService`
- `POST /checkout/session`
- `POST /webhooks/payment`
- `POST /actions/mint_item`
- `POST /actions/claim_rewards`
- `/demo`, `/demo/app.js`, `/demo/styles.css`
- `celeris/web/demo-app.js`
- `celeris/web/demo.html`
- `celeris/web/demo-styles.css`
- dashboard sponsor-wallet local state
- player-facing `userId` display and filtering in dashboard/demo flows

## New Runtime Inventory To Add

The updated MVP needs these new or renamed modules:

- `celeris/services/privy-auth-service.ts`
- `celeris/services/auth-gateway-service.ts`
- `celeris/services/player-session-service.ts`
- `celeris/services/asset-delivery-service.ts`
- `celeris/services/managed-action-service.ts`
- `celeris/sdk/browser-client.ts`
- `celeris/sdk/server-client.ts`
- `celeris/tests/privy-player-auth.test.ts`
- `celeris/tests/auth-gateway.test.ts`
- `celeris/tests/wallet-payments.test.ts`
- `celeris/tests/managed-actions.test.ts`
- `celeris/tests/developer-api.test.ts`

Exact file names may expand during implementation, but the responsibilities above must exist.

## Work Order Sequence

| WO | Title | Primary Output | Depends On |
| --- | --- | --- | --- |
| [WO-01](./WORK_ORDERS/WO-01-domain-schema-and-app-config.md) | Domain schema and app config cutover | wallet-native schema and Privy-ready app config | none |
| [WO-02](./WORK_ORDERS/WO-02-privy-player-auth.md) | Privy player auth and wallet principal | player auth hard cut to Privy, `/v1/me`, wallet principal | WO-01 |
| [WO-03](./WORK_ORDERS/WO-03-wallet-ledger-and-payments.md) | Wallet ledger and payments | wallet-keyed credits and checkout/webhook flow | WO-01, WO-02 |
| [WO-04](./WORK_ORDERS/WO-04-managed-actions-and-asset-delivery.md) | Managed actions and non-custodial delivery | no demo webhook dependency, direct-to-wallet delivery records | WO-01, WO-02, WO-03 |
| [WO-05](./WORK_ORDERS/WO-05-browser-sdk-and-demo-frontend.md) | Browser SDK and player demo migration | Privy + SDK player demo, removal of API-served demo app | WO-02, WO-03, WO-04 |
| [WO-05.5](./WORK_ORDERS/WO-05.5-celeris-owned-privy-and-shared-identity.md) | Celeris-owned Privy and shared identity | platform-owned Privy config, shared player identity, removal of per-app `privyAppId` | WO-02, WO-05 |
| [WO-05.6](./WORK_ORDERS/WO-05.6-celeris-hosted-auth-gateway.md) | Celeris-hosted auth gateway | hosted login on `auth.celeris.pro`, project origin validation, Celeris-issued player sessions | WO-05, WO-05.5 |
| [WO-05.7](./WORK_ORDERS/WO-05.7-real-privy-hosted-auth-integration.md) | Real Privy hosted auth integration | real Privy login on `auth.celeris.pro`, removal of hosted auth mock path | WO-05.5, WO-05.6 |
| [WO-05.8](./WORK_ORDERS/WO-05.8-hosted-celeris-user-sign-up-and-sign-in.md) | Hosted Celeris user sign-up and sign-in | Celeris-wrapped Privy SSO, stable shared player identity, hardened auth-code session flow | WO-05.5, WO-05.6, WO-05.7 |
| [WO-06](./WORK_ORDERS/WO-06-developer-api-and-server-sdk.md) | Developer API hardening and server SDK | protected developer API and backend SDK | WO-01, WO-03, WO-04, WO-05.5, WO-05.6, WO-05.7, WO-05.8 |
| [WO-07](./WORK_ORDERS/WO-07-legacy-removal-and-regression.md) | Legacy removal and regression rewrite | deletion of incompatible files/routes/tests and final green suite | WO-01, WO-02, WO-03, WO-04, WO-05, WO-05.5, WO-05.6, WO-05.7, WO-05.8, WO-06 |

## Dependency Map

```text
WO-01 -> WO-02
WO-01 -> WO-03
WO-01 -> WO-04
WO-01 -> WO-06

WO-02 -> WO-03
WO-02 -> WO-04
WO-02 -> WO-05

WO-03 -> WO-04
WO-03 -> WO-05
WO-03 -> WO-06

WO-04 -> WO-05
WO-04 -> WO-06

WO-05 -> WO-05.5
WO-05 -> WO-05.6
WO-05.5 -> WO-05.7
WO-05.5 -> WO-05.8
WO-05.5 -> WO-06
WO-05.5 -> WO-05.6
WO-05.6 -> WO-06
WO-05.6 -> WO-05.7
WO-05.6 -> WO-05.8
WO-05.7 -> WO-06
WO-05.7 -> WO-05.8
WO-05.8 -> WO-06
WO-05.5 -> WO-07
WO-05.6 -> WO-07
WO-05.7 -> WO-07
WO-05.8 -> WO-07
WO-06 -> WO-07
```

## Execution Strategy

The plan is intentionally split into one foundation cut, two backend player slices, one action/custody cut, one player demo slice, one auth-ownership pivot, one hosted-auth contract slice, one real-Privy completion slice, one hosted-user-auth completion slice, one developer integration slice, and one final deletion/regression WO.

### Why this sequence

- `WO-01` removes the schema and developer-config contradictions first.
- `WO-02` and `WO-03` establish the new player identity and credit ownership model before any action execution changes.
- `WO-04` removes the developer webhook and custody assumptions only after the wallet and payment model exists.
- `WO-05` migrates the player demo only after the player API is stable.
- `WO-05.5` changes the auth-ownership model from BYO Privy to Celeris-owned shared identity before the developer surface is hardened.
- `WO-05.6` moves browser login behind a hosted Celeris auth gateway on `auth.celeris.pro` before the developer surface is hardened.
- `WO-05.7` removes the remaining hosted-auth mock implementation and finishes real Privy login on the hosted auth origin before the developer surface is hardened.
- `WO-05.8` completes the hosted user sign-up/sign-in contract so app frontends rely on Celeris-wrapped Privy SSO, stable shared player identity, and a hardened auth-code session exchange before the developer surface is hardened.
- `WO-06` moves the developer surface to a real protected API and server SDK only after the auth-ownership and hosted-login contracts are stable, real Privy browser auth is in place, and the hosted user flow is hardened.
- `WO-07` performs final deletion and suite rewrite only after the replacements are already working.

## Definition Of Done

The transition is complete only when:

- all eleven work orders are complete
- `npm test` passes
- `npm run typecheck` passes
- the player demo uses the Celeris-hosted auth gateway and the browser SDK
- browser login on the hosted auth gateway is backed by real Privy authentication, not a mock hosted-login path
- browser login on the hosted auth gateway uses Celeris-wrapped Privy sign-up/sign-in and returns a Celeris player session by auth-code exchange rather than exposing a raw Privy player token to app frontends
- the demo no longer starts or references a mock developer backend
- no runtime code path requires developer-supplied `privyAppId`
- no runtime code path references player username/password auth
- no runtime code path references `developerWebhookUrl`
- no runtime code path creates or stores held assets in custody
- dashboard and developer APIs display wallet-address-based player data
- browser login does not require developer frontend origins to be allowlisted in Privy
- the same Privy user resolves to one shared `celeris_user` across apps even if the active embedded wallet is reprovisioned on the allowed chain

## Work Order Files

- [WO-01-domain-schema-and-app-config.md](./WORK_ORDERS/WO-01-domain-schema-and-app-config.md)
- [WO-02-privy-player-auth.md](./WORK_ORDERS/WO-02-privy-player-auth.md)
- [WO-03-wallet-ledger-and-payments.md](./WORK_ORDERS/WO-03-wallet-ledger-and-payments.md)
- [WO-04-managed-actions-and-asset-delivery.md](./WORK_ORDERS/WO-04-managed-actions-and-asset-delivery.md)
- [WO-05-browser-sdk-and-demo-frontend.md](./WORK_ORDERS/WO-05-browser-sdk-and-demo-frontend.md)
- [WO-05.5-celeris-owned-privy-and-shared-identity.md](./WORK_ORDERS/WO-05.5-celeris-owned-privy-and-shared-identity.md)
- [WO-05.6-celeris-hosted-auth-gateway.md](./WORK_ORDERS/WO-05.6-celeris-hosted-auth-gateway.md)
- [WO-05.7-real-privy-hosted-auth-integration.md](./WORK_ORDERS/WO-05.7-real-privy-hosted-auth-integration.md)
- [WO-05.8-hosted-celeris-user-sign-up-and-sign-in.md](./WORK_ORDERS/WO-05.8-hosted-celeris-user-sign-up-and-sign-in.md)
- [WO-06-developer-api-and-server-sdk.md](./WORK_ORDERS/WO-06-developer-api-and-server-sdk.md)
- [WO-07-legacy-removal-and-regression.md](./WORK_ORDERS/WO-07-legacy-removal-and-regression.md)
