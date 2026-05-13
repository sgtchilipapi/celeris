# SDH-SUI-05 Browser SDK And Shared Sui Builder

Read [SDH-SUI-context.md](./SDH-SUI-context.md) before implementing this work order.

## Objective

Add the canonical SUI transaction-builder surface and browser SDK execution flow for the Sui slice.

The result should be that the browser SDK can:

- build the canonical `say_hello` `TransactionKind`
- request sponsorship from Celeris
- silently add the zkLogin signature
- submit directly to Sui RPC
- report the outcome back to Celeris

## Scope

In scope:

- shared Sui transaction-builder helpers reused by browser and server SDKs
- browser SDK execution flow for sponsored `say_hello`
- browser SDK auth and session handling needed for silent signing
- player-safe feed and catalog client methods

Out of scope:

- browser demo UI rewrite
- final docs cleanup

## Dependencies

- `SDH-SUI-01`
- `SDH-SUI-02`
- `SDH-SUI-04`

## Affected Files / Modules

- shared SUI helper modules added in `SDH-SUI-01`
- `celeris/sdk/browser-client.ts`
- `celeris/sdk/server-client.ts` as needed for shared builder exposure
- browser SDK tests

## Implementation Steps

1. Add a shared SUI builder surface.
   - Expose a canonical helper that builds the `say_hello` `TransactionKind` from:
     - registered package metadata
     - authenticated player wallet
     - normalized username
   - Reuse this surface in browser SDK and backend validation logic.

2. Extend the browser SDK for sponsored `say_hello`.
   - `actions.execute("say_hello")` should:
     - build the canonical `TransactionKind`
     - call the sponsorship-preparation route
     - verify the returned sponsor metadata at a basic sanity level
     - silently add the zkLogin signature
     - submit directly to Sui RPC
     - call the completion route with submitted or failed status

3. Wire in silent zkLogin signing.
   - Consume the session-scoped zkLogin material returned by hosted auth.
   - Use the cached ephemeral keypair and proof inputs to sign without a popup.
   - Fail closed when the zkLogin session material is missing or expired.

4. Keep player-safe read surfaces simple.
   - Preserve or add browser SDK methods for:
     - catalog read
     - balance read
     - transaction feed read
   - Keep the browser SDK responsible only for authenticated player API calls and SUI submission needed by the canonical demo.

5. Expose the shared builder to the server SDK where useful.
   - Allow the server SDK to build the same canonical `TransactionKind`.
   - Do not expand scope into a fully delegated server-side user-signing model in this work order.

## Acceptance Criteria

- The browser SDK can build the canonical `say_hello` `TransactionKind`.
- The browser SDK can obtain sponsor-signed transaction bytes from Celeris.
- The browser SDK can silently add the zkLogin signature and submit directly to Sui RPC.
- The browser SDK reports submission outcome back to Celeris.
- The browser SDK does not introduce a separate wallet-connect or wallet-sign popup in the canonical demo flow.

## Unit Test Cases

- builder helper emits the expected `TransactionKind`
- browser SDK composes the sponsorship-preparation and completion routes correctly
- missing or expired zkLogin session material fails closed
- completion route receives the expected digest and reservation metadata

## Integration Test Cases

- the browser SDK can execute a full sponsored `say_hello` flow against mocked services
- submission failure reports back to Celeris and does not capture credits
- feed refresh after a successful submission returns the new app transaction entry
