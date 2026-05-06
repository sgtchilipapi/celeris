# SDH-05 Simplified Browser Demo

Read [SDH-context.md](./SDH-context.md) before implementing this work order.

## Objective

Hard-cut `mock-game-frontend` to the simplified Hello Celeris player demo and wire it to the new backend behavior only.

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

- browser SDK additions needed by the new player API surface
- standalone frontend config simplification
- `mock-game-frontend` UI rewrite
- transaction feed rendering

Out of scope:

- final helper scripts and docs cleanup
- developer dashboard UI changes beyond any break/fix needed for the new backend contracts

## Dependencies

- `SDH-02`
- `SDH-04`

## Affected Files / Modules

- `celeris/sdk/browser-client.ts`
- `mock-game-frontend/app.js`
- `mock-game-frontend/index.html`
- `mock-game-frontend/styles.css`
- `mock-game-frontend/README.md`
- `scripts/mock-game-frontend.ts`
- browser SDK tests and frontend integration tests

## Implementation Steps

1. Extend the browser SDK for the new feed endpoint.
   - Add a player-safe method for:
     - `transactions.list()`
   - Keep the browser SDK responsible for authenticated player API calls only.

2. Simplify standalone frontend config.
   - Reduce `/config.json` to public runtime values only:
     - app ID
     - app name
     - API origin
     - hosted auth origin
     - redirect URI
   - Remove old RPG-specific config such as:
     - placeholder program ID
     - item definition ID
     - mint/claim action IDs

3. Rewrite the player UI.
   - Remove the RPG panels, quest flow, inventory flow, and character flow.
   - Add a single authenticated screen with:
     - wallet address
     - credit balance
     - username input
     - `Purchase Credits`
     - `Say Hello Celeris`
     - bottom transaction panel

4. Load runtime metadata from the player API.
   - After login, fetch the player catalog and transaction feed.
   - Use the catalog response rather than stale local config for:
     - action cost
     - app name
     - registered program summary if displayed

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
     - Explorer link

## Acceptance Criteria

- `mock-game-frontend` exposes only the simplified Hello Celeris flow.
- The frontend signs players in through hosted Celeris auth.
- The frontend can buy credits through the mock checkout path.
- The frontend can execute the paid `say_hello` action.
- The bottom panel renders app-wide transactions with Solana Explorer links.

## Unit Test Cases

- browser SDK composes the player transaction-feed route correctly
- standalone frontend config no longer requires old RPG action IDs
- username form state prevents empty submissions

## Integration Test Cases

- the player can sign in, buy credits, and execute `say_hello`
- the balance refreshes after checkout and after action execution
- the bottom panel renders the resulting transaction entry
- no integration test depends on the old RPG UI flow
