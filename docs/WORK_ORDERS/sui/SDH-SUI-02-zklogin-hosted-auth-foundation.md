# SDH-SUI-02 zkLogin Hosted Auth Foundation

Read [SDH-SUI-context.md](./SDH-SUI-context.md) before implementing this work order.

## Objective

Replace the current Privy-first hosted auth stack with the canonical SUI auth contract:

- Celeris-hosted Google OAuth
- zkLogin nonce and proof flow
- stable zkLogin wallet identity
- Celeris-issued auth code and player session

This work order establishes the new identity and session foundation for the rest of the SUI slice.

## Scope

In scope:

- runtime config and type changes from Privy to zkLogin
- hosted auth request and callback contract changes
- Google identity-token verification
- zkLogin nonce, salt, and proof handling
- player session issuance with zkLogin-derived wallet identity
- browser SDK auth updates needed to create and hold ephemeral zkLogin session state

Out of scope:

- sponsor-wallet provisioning
- package registration
- `say_hello` sponsorship and reconciliation
- browser demo copy beyond what is required to keep hosted auth working

## Dependencies

- `SDH-SUI-01`

## Affected Files / Modules

- `celeris/types.ts`
- `celeris/api/index.ts`
- `celeris/api/create-api.ts`
- `celeris/services/auth-gateway-service.ts`
- replacement for `celeris/services/privy-auth-service.ts`
- `celeris/services/player-session-service.ts`
- `celeris/sdk/browser-client.ts`
- hosted auth browser bundle and auth tests

## Implementation Steps

1. Replace Privy-specific config and types.
   - Introduce a zkLogin-shaped platform config model.
   - Remove Privy-specific runtime config from the canonical path.
   - Keep the hosted auth origin and player session model intact where possible.

2. Add zkLogin hosted-auth request state.
   - Extend hosted login request state to include the zkLogin metadata needed for later validation:
     - nonce-related values
     - ephemeral public key material or its canonical derivative
     - max epoch
   - Keep the browser SDK responsible for generating the ephemeral session state before opening hosted auth.

3. Implement Google identity verification on the auth origin.
   - The hosted auth page must perform Google sign-up and sign-in on the Celeris auth origin only.
   - Celeris must verify the returned Google identity token and the login-request-linked nonce.

4. Add zkLogin salt management and address derivation.
   - Persist a stable user salt per external subject.
   - Derive the zkLogin Sui address from verified identity plus salt.
   - Treat that derived address as the wallet address stored on the player session.

5. Add zkLogin proof acquisition.
   - Add an internal prover adapter contract.
   - Support a local or self-hosted prover path as the primary implementation assumption for this repo slice.
   - Return the proof inputs needed later for silent signing.

6. Preserve the auth-code and player-session contract.
   - Keep the browser-facing contract as:
     - hosted login
     - auth code
     - Celeris player session
   - Extend the auth-code exchange response to include session-scoped zkLogin material needed by the browser SDK for silent signing.

7. Update browser SDK hosted login behavior.
   - The browser SDK must:
     - create ephemeral zkLogin state before opening hosted auth
     - complete auth-code exchange
     - retain ephemeral secret material in session-scoped storage only
   - Do not introduce a separate wallet-connect popup in this flow.

## Acceptance Criteria

- Hosted browser login no longer depends on Privy in the canonical path.
- Google login on the Celeris auth origin returns a Celeris player session whose wallet identity is the zkLogin-derived Sui address.
- Stable salts keep the same user on the same Sui address across repeat logins.
- The browser SDK receives the session-scoped zkLogin material needed for silent transaction signing.
- No browser player route relies on raw Google or raw prover credentials after login.

## Unit Test Cases

- config loading fails closed when required zkLogin runtime values are missing
- hosted auth rejects nonce mismatch or expired login state
- the same external subject resolves to the same persisted salt and derived Sui address
- auth-code exchange includes the expected zkLogin session material
- browser SDK stores ephemeral secret material in session-scoped storage only

## Integration Test Cases

- hosted login can sign in a user end to end and establish a player session
- repeat login for the same user resolves the same wallet address
- unsupported chain or malformed identity token is rejected
- no hosted auth page copy or bundle path references Privy in the canonical SUI flow
