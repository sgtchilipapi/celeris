Phase 7 hardens the approval-to-execution boundary without adding a real chain parser.

Added checks before execution:
- pending action still exists
- pending action is still active and unexpired
- developer summary action type is configured for the app
- developer summary debit matches the reserved pending action cost
- reserved balance still covers the pending action cost
- transaction payload is present and passes a minimal base64/non-empty sanity check

This stays intentionally narrow for MVP. The SaaS verifies that the developer response still matches the reserved action it is about to execute, but it does not attempt full transaction introspection yet.
