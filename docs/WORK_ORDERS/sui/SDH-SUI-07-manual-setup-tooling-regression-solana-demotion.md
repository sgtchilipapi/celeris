# SDH-SUI-07 Manual Setup, Tooling, Regression, Solana Demotion

Read [SDH-SUI-context.md](./SDH-SUI-context.md) before implementing this work order.

## Objective

Finalize the SUI Hello Celeris slice as the canonical supported demo flow by adding helper scripts, tightening docs, rewriting the regression surface, and clearly demoting the current Solana SDH story to legacy status.

This work order closes the gap between “the feature exists” and “another engineer or judge can actually use it end to end.”

## Scope

In scope:

- manual setup docs for the SUI and zkLogin path
- helper scripts for sponsor-wallet provisioning and SUI package registration
- prover setup instructions
- final README and frontend README cleanup
- cleanup of contradictory Solana-primary assumptions in canonical docs
- regression and end-to-end suite updates

Out of scope:

- local validator workflows
- production-grade secret-management infrastructure

## Dependencies

- `SDH-SUI-01`
- `SDH-SUI-02`
- `SDH-SUI-03`
- `SDH-SUI-04`
- `SDH-SUI-05`
- `SDH-SUI-06`

## Affected Files / Modules

- `README.md`
- `mock-game-frontend/README.md`
- helper scripts under `scripts/`
- regression tests and end-to-end tests
- Solana SDH docs where canonical status must be demoted or cross-linked

## Implementation Steps

1. Add helper scripts for the manual flow.
   - Add small scripts for:
     - provisioning an app sponsor wallet
     - registering a deployed SUI package and object IDs against an app
   - If helpful, add a script for app initialization or package publish guidance, but do not add a one-command orchestrator.

2. Document the canonical manual sequence.
   - Update docs so the intended flow is:
     1. install SUI local tooling
     2. configure Google OAuth and zkLogin prover runtime
     3. start prover services
     4. start API
     5. create app
     6. provision sponsor wallet
     7. fund sponsor wallet with testnet SUI
     8. publish Move package
     9. initialize app state
     10. register package and object IDs
     11. configure paid `say_hello`
     12. start standalone frontend
     13. sign in
     14. buy credits
     15. execute `say_hello`

3. Remove or rewrite contradictory canonical assumptions.
   - If `scripts/full-demo.ts`, root README copy, or work-order references still present Solana devnet plus Privy as the canonical demo path, either:
     - rewrite them to make SUI primary, or
     - clearly mark them as legacy reference
   - Do not leave the repo with two equally official canonical demo stories.

4. Rewrite regression tests around the new slice.
   - Update end-to-end coverage so the canonical happy path is:
     - hosted Google login
     - mock checkout
     - paid `say_hello`
     - browser submission
     - backend completion and feed retrieval
   - Remove or demote tests whose primary subject is the old Solana-primary assumptions.

5. Run the final verification surface.
   - `npm test`
   - `npm run typecheck`
   - Move test command for the SUI package

## Acceptance Criteria

- The repo documents one canonical SUI testnet Hello Celeris flow.
- Helper scripts exist for sponsor-wallet provisioning and SUI package registration.
- Contradictory Solana-primary or Privy-primary assumptions are removed from canonical usage paths or clearly marked legacy.
- The regression suite exercises the new SUI Hello Celeris flow.
- `npm test` passes.
- `npm run typecheck` passes.

## Unit Test Cases

- helper-script argument parsing and request-shape tests where practical
- docs or config tests can assert the presence of the new manual flow paths if lightweight coverage is desired

## Integration Test Cases

- deploy and provision assumptions are represented in a reproducible manual smoke checklist
- end-to-end backend tests cover:
  - app creation
  - sponsor-wallet provisioning
  - package registration
  - mock checkout
  - sponsor preparation
  - completion and feed retrieval
- frontend integration tests cover:
  - sign-in
  - purchase
  - hello
  - Explorer-link rendering
