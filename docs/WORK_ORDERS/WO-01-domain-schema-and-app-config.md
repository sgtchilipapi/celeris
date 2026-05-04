# WO-01 Domain Schema And App Config Cutover

## Objective

Hard-cut the domain model from the original `userId` + webhook + custody-oriented app contract to a wallet-native, Privy-ready app contract.

This work order is foundational. It must land before any Privy player auth or wallet-based payment flow is implemented.

## Scope

In scope:

- schema and in-memory contract changes required by the updated MVP
- developer app configuration changes required to remove webhook dependency
- dashboard create/edit/setup UI changes required to match the new app contract

Out of scope:

- player authentication
- payment webhook behavior
- managed action execution
- browser/server SDK implementation

## Dependencies

- none

## Affected Files / Modules

- `celeris/types.ts`
- `celeris/db/migrations/001_foundations.sql`
- `celeris/db/memory-store.ts`
- `celeris/db/postgres-credit-balance-repository.ts`
- `celeris/services/app-service.ts`
- `celeris/api/create-api.ts`
- `celeris/web/app.js`
- `celeris/web/index.html`
- `celeris/web/styles.css`
- `celeris/tests/developer-setup.test.ts`
- `celeris/tests/dashboard.test.ts`

## Implementation Steps

1. Replace the public player ownership model in `celeris/types.ts`.
   - Introduce `WalletAddress`, `ChainId`, and `WalletPrincipal`.
   - Introduce `AppAuthConfig` with concrete Privy-oriented fields:
     - `appId`
     - `authProvider: "privy"`
     - `privyAppId`
     - `allowedChainId`
   - Introduce `ActionExecutionMode` with:
     - `"managed"`
     - `"server"`
     - `"webhook"`
   - Replace custody-oriented `Asset` with `AssetDeliveryRecord`.
   - Remove `webhookUrl` from app create/update/setup request and response types.

2. Rewrite the schema in `celeris/db/migrations/001_foundations.sql`.
   - Remove `developer_webhook_url` from `apps`.
   - Add `app_auth_configs` table keyed by `app_id`.
   - Add `execution_mode` to `action_types`.
   - Replace `assets` with `asset_deliveries`.
   - Replace all player-owned columns that are public contract fields from `user_id` to:
     - `wallet_address`
     - `chain_id`
   - Update indexes accordingly.

3. Rewrite `celeris/db/memory-store.ts`.
   - Remove `developerWebhookUrl` storage from app records.
   - Add in-memory storage for `appAuthConfigs`.
   - Add storage helpers for `AssetDeliveryRecord`.
   - Change credit-balance keys and helpers to use `(appId, chainId, walletAddress)`.
   - Remove dashboard-only sponsor-wallet persistence from backend-owned records. Do not add a backend sponsor-wallet concept in its place.

4. Rewrite `celeris/services/app-service.ts`.
   - Require app creation to include Privy app configuration.
   - Store and return auth config from `getAppSetupDetails`.
   - Add `executionMode` to action configuration and update flows.
   - Remove all logic that reads or writes `developerWebhookUrl`.

5. Rewrite developer-facing routes in `celeris/api/create-api.ts`.
   - Update app creation and update endpoints to accept `privyAppId` and `allowedChainId`.
   - Update action configuration endpoints to accept `executionMode`.
   - Remove `webhookUrl` from request parsing and response payloads.

6. Update the dashboard in `celeris/web/`.
   - Remove the webhook input and webhook display.
   - Remove the sponsor-wallet card and all associated local state and buttons.
   - Add Privy app configuration fields to the create/edit app form.
   - Add action execution mode to action configuration UI.

7. Rewrite setup and dashboard tests.
   - Replace webhook assertions with Privy auth config assertions.
   - Replace old action setup expectations with execution-mode expectations.

## Acceptance Criteria

- App create/update routes no longer accept `webhookUrl`.
- App setup responses include Privy auth configuration and action execution mode.
- No type or store contract in this WO exposes `developerWebhookUrl`.
- The SQL migration no longer defines an `assets` custody table.
- The dashboard no longer renders a webhook field or sponsor-wallet section.
- `developer-setup.test.ts` and `dashboard.test.ts` pass after being rewritten for the new contract.

## Unit Test Cases

- `AppService.createApp` persists `AppAuthConfig` with `authProvider: "privy"`, `privyAppId`, and `allowedChainId`.
- `AppService.updateApp` updates auth config fields and retains app identity.
- `AppService.configureAction` persists `executionMode`.
- `MemoryStore.getBalance` keys by `(appId, chainId, walletAddress)`.
- `MemoryStore.deleteApp` removes associated `appAuthConfigs`, action definitions, balances, payments, pending actions, transactions, and asset-delivery records.

## Integration Test Cases

- `POST /apps` returns `appId` and setup details with Privy auth config available via `GET /apps/:appId/setup`.
- `PUT /apps/:appId` updates `privyAppId` and `allowedChainId`.
- `POST /apps/:appId/actions` stores action cost plus `executionMode`.
- The dashboard HTML no longer contains `Webhook URL` or sponsor-wallet copy.
- Existing developer dashboard flows can still create and open an app using the new fields.
