# SDH-SUI-04 Sponsored Transaction Preparation And Reconciliation

Read [SDH-SUI-context.md](./SDH-SUI-context.md) before implementing this work order.

## Objective

Add the real player-facing backend behavior for the Sui slice:

- canonical `say_hello` sponsorship preparation
- credit reserve, capture, and release behavior
- sponsor-sign-and-hand-back transaction flow
- completion and reconciliation
- app-wide player transaction feed with Sui Explorer links

This work order completes the backend vertical slice for the Sui Hello Celeris flow.

## Scope

In scope:

- `say_hello` sponsorship request and completion contracts
- canonical `TransactionKind` validation
- sponsor gas selection and sponsor signing
- credit reserve/capture/release behavior
- Sui transaction reconciliation and feed recording
- catalog and feed extensions needed by the browser demo

Out of scope:

- browser SDK orchestration details beyond the route contracts
- final docs and helper scripts cleanup

## Dependencies

- `SDH-SUI-01`
- `SDH-SUI-02`
- `SDH-SUI-03`

## Affected Files / Modules

- `celeris/types.ts`
- `celeris/api/create-api.ts`
- `celeris/services/managed-action-service.ts`
- new SUI sponsorship and reconciliation services or equivalent refactor
- `celeris/services/credit-ledger-service.ts`
- `celeris/db/memory-store.ts`
- player API tests, end-to-end tests, and transaction tests

## Implementation Steps

1. Add the `say_hello` sponsorship contract.
   - `POST /v1/apps/:appId/actions/say_hello/execute` remains the entry route, but now prepares sponsorship instead of submitting on behalf of the player.
   - Supported payload remains:
     - `{ username: string, transactionKind: ... }`
   - Validation rules:
     - trim username before validation
     - reject empty values after trim
     - reject values longer than 32 UTF-8 bytes
     - reject caller-supplied wallet identity
     - reject caller-supplied freeform message text

2. Validate the caller-provided `TransactionKind`.
   - Rebuild the canonical `say_hello` `TransactionKind` on the backend using shared helpers.
   - Reject mismatches in:
     - target package
     - function
     - object references
     - normalized username
     - sender assumptions encoded in the transaction

3. Add sponsorship preparation.
   - Resolve the registered package and sponsor wallet.
   - Reserve credits before signing.
   - Select a sponsor gas object and lock it for the in-flight reservation.
   - Build full transaction bytes with:
     - sender = authenticated player wallet
     - gas owner = sponsor wallet
     - gas budget and price
     - expiration or TTL
   - Sponsor-sign the bytes and return:
     - reservation ID
     - transaction bytes
     - sponsor signature
     - sponsor address
     - expiry metadata

4. Add completion and reconciliation.
   - Add `POST /v1/apps/:appId/actions/say_hello/complete`.
   - Accepted outcomes:
     - `submitted`
     - `failed`
   - On `failed`:
     - release reserved credits
     - release sponsor gas-object reservation
     - record failure state
   - On `submitted`:
     - verify the reported digest through Sui RPC
     - record the submitted transaction
     - reconcile to success or failure through backend-owned verification

5. Generalize transaction metadata for Sui.
   - Add a SUI `say_hello` summary variant that stores:
     - action ID
     - username
     - rendered message
     - sponsor address
     - player wallet address
     - Sui digest
     - Explorer URL
     - reservation ID
     - status
     - timestamps

6. Add the app-wide player transaction feed.
   - Keep `GET /v1/apps/:appId/transactions`.
   - Return all Celeris-managed app transactions, newest first.
   - Include enough data for the simplified frontend:
     - transaction ID
     - action ID
     - digest
     - Explorer URL
     - wallet address
     - username
     - rendered message
     - status
     - submitted timestamp
     - confirmed timestamp when available

7. Extend the player catalog as needed.
   - Extend `GET /v1/apps/:appId/catalog` to include:
     - registered package summary
     - configured actions including `say_hello`
   - Do not expose sponsor-wallet secrets or zkLogin secret material.

## Acceptance Criteria

- A player can request sponsor preparation for a paid `say_hello` action through the existing player execute route.
- The backend validates the caller-provided `TransactionKind` against the canonical server-built shape.
- The backend sponsor-signs the resulting transaction bytes and returns them without submitting to Sui.
- Failure paths release credits.
- Submitted transactions are verified and recorded in the app-wide player feed with Sui Explorer links.

## Unit Test Cases

- blank, oversized, or malformed `say_hello` payload is rejected
- mismatched `TransactionKind` is rejected
- repeated execute requests remain idempotent at the reservation layer
- feed projection sorts newest-first
- failed completion releases credits and sponsor gas reservation

## Integration Test Cases

- authenticated player obtains a sponsor-signed `say_hello` transaction after checkout
- valid completion with submitted digest records the transaction
- invalid digest or mismatched reservation is rejected
- `GET /v1/apps/:appId/transactions` returns the resulting app transaction entry
- `GET /v1/apps/:appId/catalog` exposes the registered package and `say_hello` action metadata
