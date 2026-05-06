# SDH-04 Say Hello Managed Action And Player Feed

Read [SDH-context.md](./SDH-context.md) before implementing this work order.

## Objective

Add the real player-facing backend behavior for the devnet slice:

- a paid managed `say_hello` action
- credit reserve/capture/release behavior
- real Solana transaction execution through the sponsor-wallet relayer
- an app-wide player transaction feed with Explorer links

This work order completes the backend vertical slice for the Hello Celeris flow.

## Scope

In scope:

- `say_hello` action payload and result types
- managed action construction for the Hello Celeris program
- player action execution through the existing `/execute` route
- app-wide player transaction feed
- catalog extensions needed by the simplified frontend

Out of scope:

- browser demo UI rewrite
- final docs and helper scripts cleanup

## Dependencies

- `SDH-01`
- `SDH-02`
- `SDH-03`

## Affected Files / Modules

- `celeris/types.ts`
- `celeris/api/create-api.ts`
- `celeris/services/managed-action-service.ts`
- new `say-hello` execution service or equivalent refactor
- `celeris/services/credit-ledger-service.ts`
- `celeris/db/memory-store.ts`
- player API tests, end-to-end tests, and transaction tests

## Implementation Steps

1. Add the `say_hello` action contract.
   - Supported payload is exactly:
     - `{ username: string }`
   - Validation rules:
     - trim before validation
     - reject empty values after trim
     - reject values longer than 32 UTF-8 bytes
     - reject caller-supplied wallet identity
     - reject caller-supplied freeform message text

2. Add a dedicated managed execution path.
   - Route `POST /v1/apps/:appId/actions/say_hello/execute` through a dedicated service or clearly isolated code path.
   - Do not overload `mint_item` logic with Hello Celeris behavior.

3. Build the real on-chain action.
   - Use the registered program and shared helper logic from `SDH-01`.
   - Build the instruction against:
     - app state PDA
     - sponsor-wallet authority
     - player wallet from the authenticated Celeris session
     - canonical username
   - The backend must not accept or trust a caller-supplied player wallet.

4. Integrate credit lifecycle.
   - Treat `say_hello` as a paid managed action.
   - Reserve credits before relay.
   - Capture credits on confirmed success.
   - Release credits on any submission or confirmation failure.
   - Preserve idempotency behavior for duplicate execution requests.

5. Generalize transaction metadata.
   - Stop assuming all transaction summaries are mint-item-shaped.
   - Add a `say_hello` summary or union variant that stores:
     - action ID
     - username
     - rendered message
     - sponsor-wallet public key
     - Solana signature
     - explorer URL
     - player wallet address
     - status
     - timestamps

6. Add the app-wide player transaction feed.
   - Add `GET /v1/apps/:appId/transactions`.
   - Return all Celeris-submitted app transactions, newest first.
   - Each entry must include enough data for the simplified frontend:
     - transaction ID
     - action ID
     - Solana signature
     - explorer URL
     - wallet address
     - username
     - rendered message
     - status
     - submitted timestamp
     - confirmed timestamp when available

7. Extend the player catalog.
   - Extend `GET /v1/apps/:appId/catalog` to include:
     - registered program summary
     - configured actions including `say_hello`
   - Do not expose sponsor-wallet secrets.

## Acceptance Criteria

- A player can execute a paid `say_hello` action through the existing player execute route.
- The action uses the registered program and app sponsor wallet.
- Successful execution creates a real Solana devnet transaction and captures credits.
- Failed execution releases credits.
- The player transaction feed returns app-wide Hello Celeris transactions with Explorer links.

## Unit Test Cases

- `say_hello` payload validation rejects blank, oversized, or malformed input
- transaction summary generation stores the expected username and canonical message
- duplicate `say_hello` execution requests remain idempotent
- feed projection sorts newest-first

## Integration Test Cases

- authenticated player executes `say_hello` successfully after checkout
- successful execution returns a success status and stored signature
- failed relay releases reserved credits
- `GET /v1/apps/:appId/transactions` returns the resulting app transaction entry
- `GET /v1/apps/:appId/catalog` exposes the registered program and `say_hello` action metadata
