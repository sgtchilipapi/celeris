# SDH-02 Program Registration And Sponsor Wallet Foundations

Read [SDH-context.md](./SDH-context.md) before implementing this work order.

## Objective

Add the backend domain model and developer API surface for:

- one registered Solana program per app
- one Celeris-controlled sponsor wallet per app

This work order does not yet submit real Solana transactions.
It establishes the data model and developer contract that later work orders consume.

## Scope

In scope:

- `RegisteredProgram` model and storage
- `SponsorWallet` model and storage
- sponsor-wallet keypair generation
- developer API routes for program registration and sponsor-wallet provisioning
- server SDK coverage for the new developer routes
- developer setup response extensions

Out of scope:

- on-chain app initialization
- Solana RPC balance checks
- player-facing `say_hello` execution
- browser demo updates

## Dependencies

- `SDH-01`

## Affected Files / Modules

- `celeris/types.ts`
- `celeris/db/memory-store.ts`
- `celeris/services/app-service.ts`
- `celeris/api/create-api.ts`
- `celeris/sdk/server-client.ts`
- developer API and setup tests

## Implementation Steps

1. Add program-registration types and storage.
   - Add a `RegisteredProgram` model equivalent to:
     - `appId`
     - `chainFamily: "solana"`
     - `cluster: "devnet"`
     - `programId`
     - `statePda`
     - `createdAt`
     - `updatedAt`
   - Store one registered program record per app.
   - The program registration is backend-owned and must not live only in standalone frontend config.

2. Add sponsor-wallet types and storage.
   - Add a public `SponsorWallet` summary model equivalent to:
     - `appId`
     - `chainFamily: "solana"`
     - `cluster: "devnet"`
     - `publicKey`
     - `createdAt`
     - `updatedAt`
   - Store the private key material separately from the public summary so it never appears in API responses.
   - For the in-memory MVP runtime, secret key material may live in an internal store map keyed by `appId`.

3. Add sponsor-wallet provisioning.
   - Add `POST /v1/developer/apps/:appId/sponsor-wallet`.
   - On first creation:
     - generate a real Solana keypair
     - store its secret key internally
     - persist and return the public summary
   - On repeated calls:
     - do not rotate the key
     - return the existing sponsor wallet record
   - This endpoint must be effectively create-once for this slice.

4. Add sponsor-wallet read access.
   - Add `GET /v1/developer/apps/:appId/sponsor-wallet`.
   - Return:
     - public key
     - chain family
     - cluster
     - timestamps
   - Do not return private key material.

5. Add program registration endpoints.
   - Add `PUT /v1/developer/apps/:appId/program`.
   - Validate that `programId` is a valid Solana public key.
   - Derive `statePda` with the shared helper from `SDH-01`.
   - Persist `cluster = "devnet"` and `chainFamily = "solana"`.
   - Add `GET /v1/developer/apps/:appId/program` to return the current registration.

6. Extend app setup responses.
   - Extend `GET /v1/developer/apps/:appId` to include:
     - registered program summary
     - sponsor-wallet summary
   - This makes app setup inspectable through one canonical developer route.

7. Extend the server SDK.
   - Add server SDK methods for:
     - `apps.getProgram(appId)`
     - `apps.registerProgram(appId, input)`
     - `apps.getSponsorWallet(appId)`
     - `apps.createSponsorWallet(appId)`
   - Keep these under the existing developer-authenticated server SDK surface.

## Acceptance Criteria

- A developer can register one devnet program for an app through the developer API.
- A developer can provision one sponsor wallet for an app through the developer API.
- Repeated sponsor-wallet provisioning does not rotate the keypair.
- Developer app setup responses include registered-program and sponsor-wallet summaries.
- Private sponsor-wallet key material is never returned in API responses.

## Unit Test Cases

- invalid Solana program IDs are rejected
- `statePda` is derived from the shared helper and stored consistently
- repeated sponsor-wallet provisioning returns the same public key
- sponsor-wallet secrets are not present in serialized API responses
- server SDK composes the new developer endpoints correctly

## Integration Test Cases

- developer creates an app
- developer provisions a sponsor wallet and receives a funding address
- developer registers a devnet program and receives a derived `statePda`
- developer reads the combined app setup response and sees both resources
