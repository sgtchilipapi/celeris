# WO-07 Legacy Removal And Regression

## Objective

Delete all incompatible legacy files, routes, scripts, and tests that survive earlier work orders, then rewrite the regression suite so the updated MVP is the only tested and supported behavior.

This work order is complete only when no contradictory runtime paths remain in the repository.

## Scope

In scope:

- deletion of leftover legacy modules and scripts
- deletion or rewrite of obsolete tests
- package script cleanup
- final end-to-end regression suite rewrite
- final docs cleanup required by the completed transition

Out of scope:

- new product behavior beyond cleanup and regression verification

## Dependencies

- `WO-01`
- `WO-02`
- `WO-03`
- `WO-04`
- `WO-05`
- `WO-06`

## Affected Files / Modules

- `package.json`
- `celeris/api/create-api.ts`
- `celeris/api/index.ts`
- `celeris/services/auth-service.ts` (delete if not already replaced)
- `celeris/services/developer-backend-client.ts`
- `celeris/services/mock-developer-client.ts`
- `celeris/services/asset-service.ts`
- `scripts/mock-developer-backend.ts`
- `scripts/manual-dev-setup-flow.sh`
- `celeris/web/demo-app.js`
- `celeris/web/demo.html`
- `celeris/web/demo-styles.css`
- all test files that encode removed behavior
- README and phase docs that still describe removed behavior

## Implementation Steps

1. Delete any legacy runtime files still present after prior WOs.
   - `celeris/services/developer-backend-client.ts`
   - `celeris/services/mock-developer-client.ts`
   - `scripts/mock-developer-backend.ts`
   - `scripts/manual-dev-setup-flow.sh`
   - `celeris/web/demo-app.js`
   - `celeris/web/demo.html`
   - `celeris/web/demo-styles.css`
   - any old auth service file that is no longer used

2. Remove obsolete scripts from `package.json`.
   - Remove:
     - `dev:mock-developer`
     - `start:mock-developer`
   - Update `start:full-demo` assumptions if needed.

3. Remove obsolete routes from the API.
   - Ensure none of these remain:
     - `POST /auth/session`
     - `POST /player/sign-up`
     - `POST /player/sign-in`
     - `POST /checkout/session`
     - `POST /webhooks/payment`
     - `POST /actions/mint_item`
     - `POST /actions/claim_rewards`
     - `/demo`
     - `/demo/app.js`
     - `/demo/styles.css`
     - `POST /demo/checkout/complete`

4. Rewrite the test suite around the updated MVP only.
   - Delete or replace tests whose primary subject is:
     - player username/password auth
     - dummy email auth session
     - developer webhook approval
     - held asset custody
     - API-served demo frontend
   - Introduce or finalize:
     - `privy-player-auth.test.ts`
     - `wallet-payments.test.ts`
     - `managed-actions.test.ts`
     - `developer-api.test.ts`
     - updated `end-to-end.test.ts`

5. Rewrite docs that still describe removed runtime behavior.
   - Remove README statements that position wallet-less player identity or asset custody as the target model.
   - Remove any remaining docs that position the mock developer backend as part of the supported demo flow.

6. Run the full regression suite and typecheck.
   - `npm test`
   - `npm run typecheck`

## Acceptance Criteria

- The repository contains no runtime code path for player username/password or dummy-email auth.
- The repository contains no runtime code path for the mock developer backend.
- The repository contains no custody-oriented asset record or held-asset terminology in code or tests.
- `package.json` contains no mock developer scripts.
- `npm test` passes.
- `npm run typecheck` passes.
- The updated end-to-end tests exercise:
  - developer app setup
  - Privy-authenticated player identity
  - wallet-based checkout
  - managed action execution
  - direct-to-wallet asset delivery records

## Unit Test Cases

- Static or grep-based test assertions can verify the absence of removed route strings and obsolete module imports if desired.
- Core services remain individually unit-tested under the new wallet-native contracts.

## Integration Test Cases

- End-to-end flow:
  - developer creates app with Privy config
  - player authenticates through Privy
  - player creates checkout session
  - signed Stripe webhook grants credits to wallet balance
  - player executes managed mint action
  - delivery record is written for the player wallet
  - developer metrics reflect wallet-based usage
- Regression suite contains no fixture or mock server for developer webhook approval.
