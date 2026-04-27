# Phase 3 Credit Ledger

This phase hardens the ledger contract behind the happy path:

- `reserveCredits(userId, appId, amount)` checks available balance before increasing `reserved`
- `captureCredits(userId, appId, amount)` decreases both `balance` and `reserved`
- `releaseCredits(userId, appId, amount)` decreases `reserved` without changing `balance`
- all ledger writes are idempotent per operation scope and idempotency key
- balance mutations now go through a lock-oriented repository contract so the production implementation can use `SELECT ... FOR UPDATE`

The in-memory implementation simulates an atomic balance update boundary for tests, while [postgres-credit-balance-repository.js](/workspaces/celeris/saas/db/postgres-credit-balance-repository.js:1) shows the production transaction shape for row-locked ledger updates.
