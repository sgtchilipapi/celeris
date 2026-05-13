# SDH-SUI-06 Simplified Browser Demo

Read [SDH-SUI-context.md](./SDH-SUI-context.md) before implementing this work order.

## Objective

Hard-cut `mock-game-frontend` to the simplified Hello Celeris SUI player demo and wire it only to the new SUI plus zkLogin behavior.

The final player demo surface in this work order is:

- sign in
- wallet address
- credit balance
- username input
- purchase credits
- say hello on chain
- transaction feed with Explorer links

## Scope

In scope:

- browser SDK usage updates needed by the new player flow
- standalone frontend config simplification
- `mock-game-frontend` UI rewrite where needed for SUI terminology and flow
- transaction feed rendering for SUI metadata

Out of scope:

- final helper scripts and docs cleanup
- developer dashboard redesign beyond break-fix changes required for the new backend contracts

## Dependencies

- `SDH-SUI-02`
- `SDH-SUI-04`
- `SDH-SUI-05`

## Affected Files / Modules

- `celeris/sdk/browser-client.ts`
- `mock-game-frontend/app.js`
- `mock-game-frontend/index.html`
- `mock-game-frontend/styles.css`
- `mock-game-frontend/README.md`
- `scripts/mock-game-frontend.ts`
- browser SDK tests and frontend integration tests

## Implementation Steps

1. Keep standalone frontend config minimal.
   - `/config.json` should carry public runtime values only:
     - app ID
     - app name
     - API origin
     - hosted auth origin
     - redirect URI
     - optional SUI RPC origin if the browser SDK needs it publicly
   - Remove legacy Solana and Privy assumptions from canonical SUI paths.

2. Rewrite the player UI around the SUI flow.
   - Keep the simplified Hello Celeris shape.
   - Update copy and metadata to Sui terminology.
   - Preserve wallet address, credits, username input, purchase, say hello, and transaction feed.

3. Load runtime metadata from the player API.
   - After login, fetch catalog, balance, and transaction feed.
   - Use the catalog response rather than stale local config for:
     - action cost
     - app name
     - registered package summary if displayed

4. Use the new SDK execution flow.
   - The frontend must request sponsorship through the SDK and allow the SDK to submit directly to Sui.
   - The user must not see a wallet popup in the canonical flow.

5. Keep the mock checkout path.
   - Preserve the existing mock Stripe-hosted checkout completion path through the standalone frontend server.
   - After checkout success, refresh the balance and keep the UI on the simplified demo screen.

6. Render the app transaction feed.
   - Show all app transactions returned by the player feed endpoint.
   - Render:
     - wallet address
     - username
     - rendered message
     - status
     - timestamp
     - Sui Explorer link

## Acceptance Criteria

- `mock-game-frontend` exposes only the simplified Hello Celeris SUI flow.
- The frontend signs players in through hosted Celeris auth.
- The frontend can buy credits through the mock checkout path.
- The frontend can execute the paid `say_hello` action through the sponsor-sign-and-hand-back flow.
- The bottom panel renders app-wide transactions with Sui Explorer links.

## Unit Test Cases

- standalone frontend config no longer requires Privy or Solana-specific action metadata
- username form state prevents empty submissions
- displayed transaction metadata uses SUI digest and Explorer URL fields

## Integration Test Cases

- the player can sign in, buy credits, and execute `say_hello`
- the balance refreshes after checkout and after action execution
- the bottom panel renders the resulting transaction entry
- no integration test depends on the old Solana or Privy demo flow
