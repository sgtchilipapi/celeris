# WO-05 Browser SDK And Demo Frontend Migration

## Objective

Deliver the updated player-facing vertical slice through:

- Privy's embedded wallet sign-in
- the Celeris browser SDK
- the standalone `mock-game-frontend`

This work order also removes the legacy API-served demo frontend.

## Scope

In scope:

- browser SDK implementation
- Privy integration in the player demo
- player API usage through the SDK only
- removal of `/demo`-served player frontend assets and helper routes

Out of scope:

- developer/server SDK
- developer dashboard auth hardening

## Dependencies

- `WO-02`
- `WO-03`
- `WO-04`

## Affected Files / Modules

- `celeris/sdk/browser-client.ts` (new)
- `celeris/sdk/*` supporting browser types/helpers (new as needed)
- `mock-game-frontend/app.js`
- `mock-game-frontend/index.html`
- `mock-game-frontend/styles.css`
- `mock-game-frontend/README.md`
- `scripts/mock-game-frontend.ts`
- `scripts/full-demo.ts`
- `celeris/api/create-api.ts`
- `celeris/web/demo-app.js` (delete)
- `celeris/web/demo.html` (delete)
- `celeris/web/demo-styles.css` (delete)
- `celeris/tests/demo-app.test.ts` (replace)
- player end-to-end tests that currently call removed auth routes

## Implementation Steps

1. Create the browser SDK.
   - Implement methods for:
     - `me.get()`
     - `credits.getBalance()`
     - `payments.createCheckoutSession()`
     - `actions.execute(actionId, payload)`
     - `assets.getHistory()`
   - The SDK must:
     - accept `apiBaseUrl`
     - accept `appId`
     - accept a token provider callback
     - attach bearer tokens to player API requests
     - never accept caller-supplied wallet identity as request data

2. Rewrite `mock-game-frontend/app.js`.
   - Replace username/password sign-in and sign-up flows with Privy embedded wallet sign-in.
   - Replace direct fetch calls to removed player routes with browser SDK calls.
   - Replace userId-based local state with wallet-principal state.
   - Replace custody-centric inventory views with asset-delivery history where appropriate.

3. Update `mock-game-frontend/index.html` and styles.
   - Remove username/password fields.
   - Add Privy sign-in affordances and wallet identity display.
   - Keep the game flow functional for:
     - balance viewing
     - checkout launch
     - managed action execution
     - asset delivery history display

4. Rewrite `scripts/mock-game-frontend.ts`.
   - Keep config delivery, API proxying, and static serving.
   - Remove assumptions about old player auth routes.

5. Rewrite `scripts/full-demo.ts`.
   - Remove startup of `scripts/mock-developer-backend.ts`.
   - Remove provisioning steps that require a webhook URL.
   - Keep API and standalone player frontend orchestration only.

6. Remove the API-served demo frontend.
   - Delete:
     - `celeris/web/demo-app.js`
     - `celeris/web/demo.html`
     - `celeris/web/demo-styles.css`
   - Remove `/demo` route handling from `celeris/api/create-api.ts`.
   - Remove `POST /demo/checkout/complete`.

7. Rewrite demo tests for the new surface.
   - Replace tests that assert `/demo` assets or demo checkout completion behavior.
   - Add SDK-level request tests and standalone frontend integration tests.

## Acceptance Criteria

- `mock-game-frontend` is the only player demo surface in the repo.
- The player demo uses Privy embedded wallet auth rather than username/password or dummy email login.
- The player demo calls the player API only through the browser SDK.
- The API no longer serves `/demo`, `/demo/app.js`, or `/demo/styles.css`.
- `scripts/full-demo.ts` no longer starts or references a mock developer backend.

## Unit Test Cases

- Browser SDK composes the correct player API paths and authorization headers.
- Browser SDK rejects missing token-provider output.
- Browser SDK never sends wallet identity in request bodies for authenticated routes.

## Integration Test Cases

- `mock-game-frontend` boots from `config.json`, signs in through Privy, and can fetch wallet-owned credits through the SDK.
- The frontend can create a checkout session through the SDK.
- The frontend can execute a managed action through the SDK and display the resulting delivery history.
- No frontend integration test uses `/auth/session`, `/player/sign-in`, or `/demo/checkout/complete`.
