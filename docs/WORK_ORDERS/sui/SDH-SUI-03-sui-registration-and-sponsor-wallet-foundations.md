# SDH-SUI-03 Sui Registration And Sponsor Wallet Foundations

Read [SDH-SUI-context.md](./SDH-SUI-context.md) before implementing this work order.

## Objective

Add the backend domain model and developer API surface for:

- one registered Sui package and app-state tuple per app
- one Celeris-controlled SUI sponsor wallet per app

This work order does not yet implement the player-facing sponsor-signing path.
It establishes the backend data model and developer contract that later work orders consume.

## Scope

In scope:

- Sui-shaped `RegisteredProgram` model and storage
- SUI sponsor-wallet model and storage
- sponsor-wallet keypair generation
- developer API routes for package registration and sponsor-wallet provisioning
- server SDK coverage for the new developer routes
- developer setup response extensions

Out of scope:

- player-facing `say_hello` execution
- transaction sponsorship
- browser demo updates

## Dependencies

- `SDH-SUI-01`

## Affected Files / Modules

- `celeris/types.ts`
- `celeris/db/memory-store.ts`
- `celeris/services/app-service.ts`
- `celeris/api/create-api.ts`
- `celeris/sdk/server-client.ts`
- developer API and setup tests

## Implementation Steps

1. Add Sui package-registration types and storage.
   - Add a `RegisteredProgram` model equivalent to:
     - `appId`
     - `chainFamily: "sui"`
     - `network: "testnet"`
     - `packageId`
     - `appStateObjectId`
     - `authorityCapObjectId`
     - `createdAt`
     - `updatedAt`
   - Store one registration record per app.

2. Add sponsor-wallet types and storage.
   - Add a public `SponsorWallet` summary model equivalent to:
     - `appId`
     - `chainFamily: "sui"`
     - `network: "testnet"`
     - `address`
     - `createdAt`
     - `updatedAt`
   - Store private key material separately from the public summary so it never appears in API responses.

3. Add sponsor-wallet provisioning.
   - Add `POST /v1/developer/apps/:appId/sponsor-wallet`.
   - On first creation:
     - generate a real SUI-compatible keypair
     - store its secret internally
     - persist and return the public summary
   - On repeated calls:
     - do not rotate the key
     - return the existing sponsor wallet record

4. Add sponsor-wallet read access.
   - Add `GET /v1/developer/apps/:appId/sponsor-wallet`.
   - Return public summary fields only.
   - Do not return private key material.

5. Add package registration endpoints.
   - Keep `PUT /v1/developer/apps/:appId/program` and `GET /v1/developer/apps/:appId/program` if route churn is avoidable.
   - Pivot their payloads and responses to Sui registration fields.
   - Validate package ID and object ID shapes with shared helpers from `SDH-SUI-01`.

6. Extend app setup responses.
   - Extend `GET /v1/developer/apps/:appId` to include:
     - registered Sui package summary
     - sponsor-wallet summary

7. Extend the server SDK.
   - Add or pivot server SDK methods for:
     - `apps.getProgram(appId)`
     - `apps.registerProgram(appId, input)`
     - `apps.getSponsorWallet(appId)`
     - `apps.createSponsorWallet(appId)`

## Acceptance Criteria

- A developer can register one Sui testnet package for an app through the developer API.
- A developer can provision one sponsor wallet for an app through the developer API.
- Repeated sponsor-wallet provisioning does not rotate the keypair.
- Developer app setup responses include registered-package and sponsor-wallet summaries.
- Private sponsor-wallet key material is never returned in API responses.

## Unit Test Cases

- malformed package or object IDs are rejected
- repeated sponsor-wallet create calls are idempotent
- setup projection returns the expected SUI registration fields
- server SDK composes the expected request shapes

## Integration Test Cases

- sponsor-wallet provisioning returns a stable sponsor address
- package registration can be fetched back through the developer API
- setup details expose the new registration and sponsor-wallet summaries
