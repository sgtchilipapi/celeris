# SDH-06 Manual Setup And Regression

Read [SDH-context.md](./SDH-context.md) before implementing this work order.

## Objective

Finalize the devnet Hello Celeris slice as the canonical supported demo flow by adding helper scripts, tightening docs, and rewriting the regression surface around the new behavior.

This work order closes the gap between “the feature exists” and “another engineer or judge can actually use it end to end.”

## Scope

In scope:

- manual deploy and provisioning docs
- helper scripts for program registration and sponsor-wallet provisioning
- final README and frontend README cleanup
- cleanup of contradictory legacy demo assumptions
- regression and end-to-end suite updates

Out of scope:

- local validator workflows
- production-grade secret-management infrastructure

## Dependencies

- `SDH-01`
- `SDH-02`
- `SDH-03`
- `SDH-04`
- `SDH-05`

## Affected Files / Modules

- `README.md`
- `docs/solana-devnet-hello-demo-plan.md`
- `mock-game-frontend/README.md`
- helper scripts under `scripts/`
- `scripts/full-demo.ts` if it still contradicts the devnet hello flow
- end-to-end tests and any docs/tests that still encode the old RPG demo assumptions

## Implementation Steps

1. Add helper scripts for the manual flow.
   - Add small scripts for:
     - registering a deployed devnet program against an app
     - provisioning an app sponsor wallet
   - These scripts may use the server SDK or direct HTTP calls, but they must not become a one-command orchestrator.

2. Document the canonical manual sequence.
   - Update docs so the intended flow is:
     1. deploy the Anchor program to devnet
     2. create a Celeris app
     3. provision the sponsor wallet
     4. fund the sponsor wallet with devnet SOL
     5. register the deployed program
     6. configure the paid `say_hello` action
     7. start the API and standalone frontend
   - Keep this sequence consistent across README and frontend docs.

3. Remove or rewrite contradictory demo assumptions.
   - If `scripts/full-demo.ts` still provisions mock program IDs, mint actions, or the RPG demo flow, either:
     - rewrite it to stop doing so, or
     - clearly retire it from the canonical docs and remove contradictory behavior from default usage paths
   - Do not leave the repo with two equally official but conflicting demo stories.

4. Rewrite regression tests around the new slice.
   - Update end-to-end coverage so the canonical happy path is:
     - hosted auth login
     - mock checkout
     - paid `say_hello`
     - app-wide transaction feed rendering or retrieval
   - Remove or demote tests whose primary subject is the old RPG demo assumptions.

5. Run the final verification surface.
   - `npm test`
   - `npm run typecheck`

## Acceptance Criteria

- The repo documents one canonical manual devnet Hello Celeris flow.
- Helper scripts exist for program registration and sponsor-wallet provisioning.
- Contradictory old demo assumptions are removed or explicitly retired from canonical usage paths.
- The regression suite exercises the new devnet Hello Celeris flow.
- `npm test` passes.
- `npm run typecheck` passes.

## Unit Test Cases

- helper-script argument parsing and request-shape tests where practical
- docs/config tests can assert the presence of the new manual flow paths if lightweight coverage is desired

## Integration Test Cases

- deploy/provision assumptions are represented in a reproducible manual smoke checklist
- end-to-end backend tests cover:
  - app creation
  - sponsor-wallet provisioning
  - program registration
  - mock checkout
  - `say_hello`
  - transaction feed retrieval
- frontend integration tests cover:
  - sign-in
  - purchase
  - hello
  - Explorer-link rendering
