# Phase 5 PendingAction

This phase extracts the core pending action reservation flow into a dedicated service:

- `createPendingAction({ userId, appId, actionType, cost, payloadHash })`
- validates spendability by reserving credits first
- creates the `pending_actions` record only after a successful reservation
- uses a simple `60s` TTL
- includes an explicit `expirePendingAction(...)` helper so later cron cleanup can release reserved credits safely

The mint flow now depends on this service instead of building pending actions inline, which keeps the reservation lifecycle centralized.
