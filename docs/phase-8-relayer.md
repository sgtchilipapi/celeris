Phase 8 adds a relayer boundary between verified developer approval and final transaction outcome.

What changed:
- the SaaS now signs the developer-provided transaction payload with a server-side relayer key
- the signed transaction is submitted to a network client
- submission is retried once for retryable network errors
- a transaction record is created with `submitted` status before final resolution
- final resolution updates the transaction and pending action to `success` or `failed`
- credits are only captured on success; failed submissions or failed final status release reserved credits

This keeps the MVP simple:
- no real chain parser
- no queue yet
- synchronous final status resolution through a mock network client
