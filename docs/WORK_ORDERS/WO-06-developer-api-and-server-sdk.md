# WO-06 Developer API And Server SDK

## Objective

Separate and harden the developer surface from the player surface, then expose that developer surface through a server SDK.

This work order completes the “frontend and backend use SDKs” requirement without reintroducing the legacy webhook-based demo architecture.

## Scope

In scope:

- developer route namespacing
- developer bearer auth enforcement
- server SDK implementation
- dashboard migration to the developer API

Out of scope:

- player demo behavior beyond consuming already-stable APIs

## Dependencies

- `WO-01`
- `WO-03`
- `WO-04`
- `WO-05.5`
- `WO-05.6`

## Affected Files / Modules

- `celeris/api/create-api.ts`
- `celeris/api/index.ts`
- `celeris/services/app-service.ts`
- `celeris/services/metrics-service.ts`
- `celeris/types.ts`
- `celeris/sdk/server-client.ts` (new)
- `celeris/sdk/*` supporting server types/helpers (new as needed)
- `celeris/web/app.js`
- `celeris/web/index.html`
- `celeris/web/styles.css`
- `celeris/tests/dashboard.test.ts`
- `celeris/tests/developer-setup.test.ts`
- `celeris/tests/developer-api.test.ts` (new)

## Implementation Steps

1. Move developer routes under `/v1/developer`.
   - Replace the flat public routes for:
     - app listing
     - app creation
     - app update
     - app deletion
     - action creation/update/deletion
     - metrics
     - player listing
     - transaction listing
   - Do not leave duplicate legacy route aliases behind.

2. Add bearer-authenticated developer sessions.
   - Keep the current developer account model if desired.
   - Add server-side verification for developer bearer tokens on every `/v1/developer/*` route except sign-up/sign-in.
   - Return a developer token from sign-in and sign-up.

3. Rewrite dashboard data access.
   - Update `celeris/web/app.js` to call the namespaced developer API only.
   - Remove any remaining use of player/public endpoints for dashboard state.
   - Replace userId-centric display with wallet-address-centric display.
   - Remove any remaining webhook- or sponsor-wallet-related copy or local state.

4. Create the server SDK.
   - Implement app-management methods:
     - `apps.list`
     - `apps.create`
     - `apps.update`
     - `apps.configureAction`
     - `metrics.getAppMetrics`
     - `players.list`
     - `transactions.list`
   - Implement `asUser(playerSessionToken)` or equivalent on-behalf-of player mode for calls to the player API.

5. Rewrite developer and dashboard tests.
   - Update route paths.
   - Add assertions for developer auth protection.
   - Add server SDK request tests.

## Acceptance Criteria

- No developer data route remains on the public flat namespace.
- Every `/v1/developer/*` route is protected by developer bearer auth except sign-up/sign-in.
- The dashboard works against the namespaced developer API.
- The server SDK can create an app, configure a managed action, fetch metrics, and list wallet-based players.
- The dashboard no longer renders webhook, sponsor-wallet, or `userId`-based player identity copy.

## Unit Test Cases

- Developer auth guard accepts a valid developer token and rejects missing or invalid tokens.
- Server SDK composes the correct developer API routes and authorization headers.
- Server SDK `asUser(playerSessionToken)` composes player API calls with the provided player session token.

## Integration Test Cases

- Developer sign-up returns a developer token.
- Developer sign-in returns a developer token.
- Authenticated developer requests can create apps, configure actions, and read metrics.
- Unauthenticated developer requests receive `401` or `403`.
- Dashboard integration tests can log in, create an app, configure a managed action, and read wallet-based metrics.
