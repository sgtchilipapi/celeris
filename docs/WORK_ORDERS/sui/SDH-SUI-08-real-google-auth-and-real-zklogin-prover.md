# SDH-SUI-08 Real Google Auth and Real zkLogin Prover

Read [SDH-SUI-context.md](./SDH-SUI-context.md) before implementing this work order.

## Objective

Replace the current dev-token and local-prover shortcuts with the canonical hosted SUI auth flow:

- real Google account selection on `auth.celeris.pro`
- Google ID-token verification against Google JWKS
- Celeris-owned nonce, salt, and zkLogin address resolution
- self-hosted Mysten zkLogin prover integration
- Celeris-issued auth code and player session preserved as the app-facing contract

The end state is that clicking `Sign in with Celeris` no longer silently logs in a synthetic user. It must take the user through a real Google chooser, return to the demo frontend callback, and establish a session backed by real zkLogin inputs and proofs.

## Scope

In scope:

- removal of the mock Google token minting path from the canonical runtime
- hosted auth redirect and callback flow on `auth.celeris.pro`
- Google ID-token verification using Google JWKS
- canonical zkLogin nonce, randomness, max-epoch, address, and proof handling
- browser SDK changes required for real hosted auth and silent signing
- self-hosted prover adapter wired by runtime config
- runtime config hardening, docs, and regression updates

Out of scope:

- support for non-Google OpenID providers
- Enoki integration or third-party salt services
- a redesign of player-session storage or database persistence
- introducing a separate wallet-connect UX
- production secret-management infrastructure beyond current repo conventions

## Dependencies

- `SDH-SUI-02`
- `SDH-SUI-05`
- `SDH-SUI-06`
- `SDH-SUI-07`

## Affected Files / Modules

- `celeris/types.ts`
- `celeris/api/index.ts`
- `celeris/api/create-api.ts`
- `celeris/services/auth-gateway-service.ts`
- `celeris/services/zklogin-auth-service.ts`
- `celeris/services/sui-gateway-service.ts`
- `celeris/sdk/browser-client.ts`
- hosted auth browser bundle under `celeris/web/`
- `mock-game-frontend/app.js`
- `scripts/full-demo.ts`
- root docs and setup docs
- auth, browser, and full-demo tests

## Implementation Steps

1. Remove the mock path from the canonical runtime.
   - Move `POST /v1/auth/google/dev-token` and `createGoogleTestIdToken(...)` behind an explicit test-only or dev-mock runtime gate.
   - Normal runtime must not expose a route that mints fake Google tokens.
   - `CELERIS_GOOGLE_VERIFIER_SECRET` must stop being a canonical runtime dependency.

2. Implement real hosted Google auth on the auth origin.
   - The hosted auth button on `auth.celeris.pro` must redirect to Google OpenID, not call the local dev-token route.
   - Use explicit account selection semantics rather than auto-select or One Tap.
   - Add a dedicated callback route on the auth origin, `GET /auth/google/callback`.
   - The auth-origin callback must parse the returned Google payload, complete the internal auth flow, and then redirect back to the frontend callback URI.

3. Preserve the two-origin browser contract.
   - Keep `auth.celeris.pro` as the hosted auth origin.
   - Keep `demo-frontend.celeris.pro/auth/callback` as the player-app callback URI.
   - Do not collapse the flow onto a single public host unless the SDK callback contract is intentionally redesigned.

4. Canonicalize the zkLogin login-request contract.
   - Keep the browser responsible for generating the ephemeral Ed25519 keypair and zkLogin randomness before hosted auth begins.
   - Replace the current browser-supplied absolute `maxEpoch` shortcut with backend-selected max-epoch handling.
   - Treat `CELERIS_ZKLOGIN_MAX_EPOCH` as an epoch window added to the current Sui epoch, not a hardcoded literal epoch.
   - Compute nonce values with the official zkLogin helpers rather than the current custom shortcut.

5. Replace local Google verification with a real verifier.
   - Add a verifier backed by `jose` or equivalent standards-compliant tooling.
   - Validate Google signature, issuer, audience, expiration, and login-request-linked nonce.
   - Normalize verified claims into the existing internal identity contract.

6. Replace the local zkLogin prover with a self-hosted HTTP adapter.
   - Call the prover configured by `CELERIS_ZKLOGIN_PROVER_ORIGIN`.
   - Use canonical prover request fields:
     - `jwt`
     - `extendedEphemeralPublicKey`
     - `maxEpoch`
     - `jwtRandomness`
     - `salt`
     - `keyClaimName = "sub"`
   - Add lightweight readiness and failure handling so prover unavailability fails clearly.

7. Align address and proof handling with the official Sui SDK.
   - Use `generateNonce`, `generateRandomness`, `getExtendedEphemeralPublicKey`, `genAddressSeed`, `computeZkLoginAddress`, and `getZkLoginSignature` in the canonical path.
   - Replace the current mock-shaped proof representation with a type compatible with the real Sui zkLogin signature inputs.
   - Keep salts Celeris-owned and stable so the same Google subject resolves to the same Sui address across repeat logins.

8. Preserve session and browser-storage constraints.
   - Keep the player session token on the current durable path.
   - Keep ephemeral private key material, pending login state, randomness, and zkLogin proof/session material in `sessionStorage` only.
   - Do not leave raw Google ID tokens in browser storage after hosted auth completes.

9. Harden runtime config and setup docs.
   - In non-test runtime, fail closed when required values are missing:
     - `CELERIS_GOOGLE_CLIENT_ID`
     - `CELERIS_SESSION_SECRET`
     - `CELERIS_HOSTED_AUTH_ORIGIN`
     - `CELERIS_ZKLOGIN_SALT_SEED`
     - `CELERIS_ZKLOGIN_PROVER_ORIGIN`
   - Document Google OAuth setup with callback URIs for:
     - `http://localhost:3000/auth/google/callback`
     - `https://auth.celeris.pro/auth/google/callback`
   - Document the canonical public flow as:
     1. open `https://demo-frontend.celeris.pro`
     2. redirect or popup to `https://auth.celeris.pro`
     3. choose a Google account
     4. return to `https://demo-frontend.celeris.pro/auth/callback`

10. Rewrite the regression surface around the real flow.
   - Browser and backend integration tests must assert that the hosted auth path no longer uses the dev-token route.
   - Full-demo setup must continue to allowlist the Cloudflare frontend origin and callback URI.
   - Manual verification must cover repeated login with the same Google account resolving the same zkLogin address.

## Acceptance Criteria

- Clicking `Sign in with Celeris` presents a real Google account chooser instead of silently logging in a synthetic user.
- Hosted auth on `auth.celeris.pro` returns to the frontend callback on `demo-frontend.celeris.pro/auth/callback`.
- Google ID tokens are verified against Google JWKS and rejected when signature, audience, issuer, expiration, or nonce is invalid.
- The same Google subject resolves to the same zkLogin-derived Sui address across repeat logins.
- Proof material returned to the browser is produced by the configured self-hosted prover, not a local mock implementation.
- The browser can still complete silent zkLogin transaction signing without exposing a separate wallet-connect UX.
- The canonical runtime no longer exposes a fake Google token minting route.

## Unit Test Cases

- login-request creation stores randomness, computes canonical nonce inputs, and returns backend-chosen max-epoch values
- hosted auth URL creation uses explicit account selection semantics and the expected callback URI
- hosted auth callback rejects missing state, missing token payload, and Google error responses
- Google verifier rejects bad signature, wrong audience, wrong issuer, expired tokens, and nonce mismatch
- prover adapter sends the expected canonical request payload and maps the response into the real zkLogin signature-input shape
- config loading fails closed when required non-test runtime values are missing

## Integration Test Cases

- hosted auth no longer calls `/v1/auth/google/dev-token` in the canonical SUI flow
- real-shaped Google login completion yields a Celeris auth code and player session
- repeat login for the same Google account resolves the same wallet address
- invalid Google token or prover failure is surfaced as a clear auth failure
- the demo frontend can sign in through `demo-frontend.celeris.pro` and complete the callback round-trip through `auth.celeris.pro`
- browser signing still succeeds with session-scoped zkLogin material only

## Notes

- This work order intentionally keeps Google as the only supported OpenID provider for the SUI slice.
- This plan assumes the prover is self-hosted by Celeris and reached through `CELERIS_ZKLOGIN_PROVER_ORIGIN`.
- If future work wants a single-host auth-plus-frontend flow, that should be treated as a separate SDK and callback-contract redesign rather than folded into this implementation.
