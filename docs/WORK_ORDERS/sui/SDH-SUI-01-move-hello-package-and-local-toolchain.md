# SDH-SUI-01 Move Hello Package And Local Toolchain

Read [SDH-SUI-context.md](./SDH-SUI-context.md) before implementing this work order.

## Objective

Add the in-repo Sui Move package, TypeScript helpers, and local toolchain setup that define the canonical Sui testnet `say_hello` contract for the rest of the slice.

This work order establishes:

- the repo-local Sui toolchain contract
- the `initialize_app` and `say_hello` Move entrypoints
- the app state and authority capability model
- the canonical builder and validation helpers later reused by auth, backend, and browser work

## Scope

In scope:

- Sui CLI and TypeScript package wiring
- repo-local Move package for Hello Celeris
- `initialize_app` and `say_hello`
- fixed-capacity greeting storage
- shared TypeScript helpers for package IDs, username normalization, and canonical `TransactionKind` construction

Out of scope:

- hosted auth changes
- developer API endpoints
- sponsor-wallet provisioning
- browser demo changes

## Dependencies

- none

## Affected Files / Modules

- `package.json`
- `package-lock.json`
- new repo-local Sui Move package directory
- new shared TypeScript helper modules for Sui transaction building and validation
- Move tests and TypeScript helper tests

## Implementation Steps

1. Add the minimum Sui tooling needed by this repo.
   - Add the TypeScript SDK dependency surface needed for:
     - `Transaction`
     - `TransactionKind` construction
     - Sui address and object ID parsing
     - zkLogin-compatible client calls used later
   - Document the expected local Sui CLI requirement for this slice.
   - Do not add localnet orchestration in this work order.

2. Create the Hello Celeris Move package.
   - Add a Move package intended for Sui testnet deployment.
   - Implement entry functions:
     - `initialize_app`
     - `say_hello`

3. Define the app state and authority model.
   - `initialize_app` must create:
     - one shared `AppState` object
     - one owned `AppAuthorityCap`
   - `AppState` must store:
     - raw Celeris `appId`
     - `entry_count`
     - `entries`
   - `AppAuthorityCap` must be owned by the sponsor wallet and required for future writes.

4. Define the greeting entry model.
   - Each entry stores:
     - player wallet address
     - username
     - rendered message
     - created timestamp
   - The Move package must derive the player wallet from `TxContext`.
   - The package must render `message` canonically as:
     - `"<username> says Hello Celeris!"`
   - The package must not accept arbitrary message text from the caller.

5. Define the fixed-capacity storage rule.
   - Cap stored greetings at 100.
   - Reject the 101st `say_hello`.
   - Do not add resizing, pagination, rollover, or archival behavior in this work order.

6. Add shared TypeScript helpers for later backend and SDK use.
   - Add helpers that expose:
     - Sui address and object-ID parsing
     - canonical username normalization
     - canonical `say_hello` `TransactionKind` construction
     - exact-match validation between a caller-provided `TransactionKind` and the backend-expected shape
   - Later work orders must reuse these helpers instead of duplicating logic.

## Acceptance Criteria

- The repo contains a Sui Move package for Hello Celeris.
- The app state and authority capability model is explicit and sponsor-compatible.
- `say_hello` stores canonical greeting messages and does not accept arbitrary freeform message text.
- The package rejects writes after 100 greeting entries.
- Shared TypeScript helpers exist for canonical SUI `say_hello` transaction construction and validation.

## Unit Test Cases

- username normalization trims and enforces the intended maximum
- package and object ID parsing rejects malformed values
- canonical `TransactionKind` builder emits the expected move call and arguments
- `TransactionKind` validator rejects mismatched payload or object references

## Integration Test Cases

- `initialize_app` creates the expected state and capability objects
- `say_hello` records the transaction sender as the player wallet
- `say_hello` renders the canonical message for accepted usernames
- the package rejects the 101st greeting
