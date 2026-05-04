# Future Refactorings

This document captures significant architecture changes that are intentionally deferred beyond the current MVP.

These are not immediate implementation tasks. They are backlog candidates for future product and platform evolution.

The completed SDK/auth pivot is documented in [sdk-pivot.md](./sdk-pivot.md).

## Post-Pivot Backlog

The SDK/auth/runtime cutover is complete. Remaining refactorings now sit beyond that baseline rather than before it.

Current baseline:

- frontend clients use the browser SDK and hosted auth flow
- developer tools use the namespaced developer API and server SDK
- wallet addresses are the player reference for credits and delivery history
- demo actions run as managed Celeris actions
- the mock developer backend and custody-oriented demo model are removed

Backlog focus now shifts to:

- stronger storage and persistence layers beyond the in-memory MVP runtime
- broader server-side integration patterns on top of the server SDK
- operational hardening around hosted auth and webhook ingestion
- more opinionated project scaffolding and managed hosting direction

## Managed Hosting and Scaffold Generation

### Summary

Beyond the SDK/auth pivot, Celeris may still evolve into a more opinionated managed platform.

That longer-term direction includes:

- generated backend and frontend scaffolds
- default database foundations
- shared project configuration
- optional repo sync and hosting

### Why this remains deferred

Those capabilities depend on first clarifying the API product boundary and auth model.

Without the SDK-first foundation, generated scaffolds would lock in unstable integration patterns.

### Backlog status

Status: deferred after SDK/API productization

Priority: important, but not first
