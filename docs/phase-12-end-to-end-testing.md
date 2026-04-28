Phase 12 adds system-level verification for the MVP flow.

Automated coverage:
- signup -> buy credits -> mint item -> verify asset -> check dashboard
- insufficient credits
- duplicate payment webhook
- transaction failure
- developer rejection

Artifacts:
- `saas/tests/end-to-end.test.ts`
- `npm run test:e2e`
- the manual happy-path script now also fetches app metrics and verifies the dashboard page is reachable

This phase does not add new product behavior. It consolidates the existing flow into a dedicated verification slice so regressions are easier to catch.
