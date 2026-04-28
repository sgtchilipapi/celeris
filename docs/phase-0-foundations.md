# Phase 0 Foundations

This phase establishes the minimum vertical slice for the Happy Path MVP:

- repo structure under `celeris/` and `docs/`
- initial Postgres schema for the core entities
- explicit services for auth, apps, credits, payments, pending actions, execution, and metrics
- API endpoints for the MVP flow
- focused tests for ledger correctness and idempotent mutation behavior

The current implementation keeps execution synchronous and uses in-memory repositories for local tests.
The boundaries match the product thesis: the SaaS owns identity, credits, pending actions, and execution; the developer response is validated before transaction submission.
