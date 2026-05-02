# WO-04 Managed Actions And Asset Delivery

## Objective

Remove the demo-time dependency on the external developer webhook and replace custody-oriented asset handling with managed action execution plus non-custodial asset delivery records.

This work order performs the hard cut away from:

- `developerWebhookUrl`
- external approval callbacks in the demo path
- held asset custody records

## Scope

In scope:

- managed action execution for `mint_item`, `claim_rewards`, and `first_time_claim`
- non-custodial asset delivery records
- replacement of legacy action routes with the new player action route

Out of scope:

- browser SDK implementation
- player UI migration

## Dependencies

- `WO-01`
- `WO-02`
- `WO-03`

## Affected Files / Modules

- `celeris/services/developer-backend-client.ts` (delete)
- `celeris/services/mock-developer-client.ts` (delete)
- `celeris/services/asset-service.ts` (delete or replace)
- `celeris/services/managed-action-service.ts` (new)
- `celeris/services/asset-delivery-service.ts` (new)
- `celeris/services/mint-item-service.ts`
- `celeris/services/claim-rewards-service.ts`
- `celeris/services/pending-action-service.ts`
- `celeris/services/relayer-service.ts`
- `celeris/api/index.ts`
- `celeris/api/create-api.ts`
- `celeris/types.ts`
- `celeris/db/memory-store.ts`
- `celeris/db/migrations/001_foundations.sql`
- `celeris/tests/asset-handling.test.ts`
- `celeris/tests/developer-interaction.test.ts`
- `celeris/tests/transaction-verification.test.ts`
- `celeris/tests/relayer.test.ts`
- `celeris/tests/managed-actions.test.ts` (new)

## Implementation Steps

1. Delete runtime use of the external developer approval client.
   - Remove `DeveloperBackendClient` from dependency injection.
   - Delete `developer-backend-client.ts`.
   - Delete `mock-developer-client.ts`.

2. Add `celeris/services/managed-action-service.ts`.
   - Implement server-authoritative handlers for:
     - `mint_item`
     - `claim_rewards`
     - `first_time_claim`
   - The service must:
     - validate payloads
     - build the transaction summary used by the relayer flow
     - never call an external developer webhook for the managed demo actions

3. Replace custody asset logic with delivery records.
   - Add `AssetDeliveryService`.
   - Replace `Asset` with `AssetDeliveryRecord`.
   - Record:
     - `deliveryId`
     - `appId`
     - `walletAddress`
     - `chainId`
     - `itemDefId`
     - `transactionId`
     - `destinationWalletAddress`
     - `status`
     - timestamps
   - Allowed statuses must reflect delivery state, not custody state.

4. Rewrite `MintItemService`.
   - Remove the external approval call.
   - Create pending action against the authenticated wallet principal.
   - Call the managed action service for transaction input.
   - Preserve verification, relayer submission, and reserve/capture/release behavior.
   - On success, create an asset-delivery record to the player's wallet.
   - On failure, release credits and create no delivery record.

5. Rewrite `ClaimRewardsService`.
   - Use wallet principal throughout.
   - Keep reward-claim credit behavior server-authoritative.

6. Replace action routes.
   - Remove `POST /actions/mint_item`.
   - Remove `POST /actions/claim_rewards`.
   - Add `POST /v1/apps/:appId/actions/:actionId/execute`.
   - Route all supported player actions through one execution entrypoint.

7. Rewrite action, transaction, and asset tests.
   - Delete webhook-dependent developer interaction expectations.
   - Replace custody assertions with delivery-record assertions.

## Acceptance Criteria

- The demo runtime no longer imports or calls `DeveloperBackendClient`.
- Managed `mint_item` execution succeeds without any external developer service.
- Successful mint execution records a delivery-to-wallet record, not a held asset.
- Failed managed actions release reserved credits and create no delivery record.
- `POST /v1/apps/:appId/actions/:actionId/execute` is the only player action execution route.

## Unit Test Cases

- `ManagedActionService` validates action IDs and payloads.
- `MintItemService` uses `ManagedActionService` rather than an external client.
- `AssetDeliveryService` creates a delivery record with the destination wallet set to the authenticated player wallet.
- Failed relayer resolution releases credits and prevents delivery creation.

## Integration Test Cases

- Authenticated `POST /v1/apps/:appId/actions/mint_item/execute` reserves credits, submits the transaction, captures credits on success, and records asset delivery to the wallet.
- Authenticated `POST /v1/apps/:appId/actions/claim_rewards/execute` debits credits and updates usage metrics.
- Invalid action IDs are rejected with `4xx`.
- No integration test in this WO starts or depends on a mock developer backend.
