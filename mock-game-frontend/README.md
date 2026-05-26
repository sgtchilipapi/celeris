# Mock Game Frontend

Standalone player-facing frontend for the Sui testnet Hello Celeris slice.

It is served separately from the API and proxies `/api/*` requests back to the Celeris API server.
The frontend uses the browser SDK and the hosted Celeris auth gateway flow for player sign-in.
Hosted login expects the API runtime to be configured for Google-backed zkLogin plus `CELERIS_SESSION_SECRET`.
The frontend never uses a raw Google token against player routes. Hosted login returns a one-time auth code that the browser SDK exchanges for a Celeris player session.
The frontend serves `/auth/callback` from the same app bundle so the browser SDK can own callback parsing, state validation, auth-code exchange, and popup or redirect completion without custom app auth code.
For the canonical two-origin flow, configure Google OAuth callbacks on the auth origin:
- `http://localhost:3000/auth/google/callback`
- `https://auth.celeris.pro/auth/google/callback`

Default ports:

- Celeris API: `3000`
- Mock game frontend: `3002`

Run with:

```bash
npm run dev:mock-game-frontend -- --app-id=<app-id>
```

Run the frontend only after the API app has been created, a sponsor wallet has been provisioned and funded, the Sui package has been published and initialized, and the package metadata has been registered with Celeris.

Supported arguments:

- `--app-id=<app-id>` required
- `--app-name=<app-name>` optional, defaults to `Hello Celeris`
- `--api-origin=<origin-or-path>` optional, defaults to `/api`
- `--hosted-auth-origin=<origin>` optional, defaults to `CELERIS_HOSTED_AUTH_ORIGIN` or `CELERIS_API_ORIGIN`
- `--sui-rpc-origin=<origin>` optional, defaults to `CELERIS_SUI_RPC_ORIGIN` or the public Sui testnet fullnode
- `--redirect-uri=<uri>` optional, defaults to `http://localhost:3002/auth/callback`

The frontend config served from `/config.json` is shaped like:

```json
{
  "appId": "app-id",
  "appName": "Hello Celeris",
  "apiOrigin": "/api",
  "hostedAuthOrigin": "http://localhost:3000",
  "suiRpcOrigin": "https://fullnode.testnet.sui.io:443",
  "redirectUri": "http://localhost:3002/auth/callback"
}
```

Runtime behavior:

- public config no longer carries action IDs, placeholder program IDs, Solana-specific metadata, or Privy identifiers
- app metadata, action cost, program registration, and transaction feed are loaded from the player API after sign-in
- the player flow is limited to wallet display, credits, username input, `Purchase Credits`, `Say Hello Celeris`, and the app-wide transaction feed

Stripe test mode:

- Set `STRIPE_SECRET_KEY` in a local `.env` or `.env.local` for the API to use real Stripe-hosted Checkout
- Leave it unset to stay on the local mock checkout path, which completes through the standalone frontend server instead of an API demo helper route

Manual setup notes:

- The canonical end-to-end sequence is documented in the repo root [README.md](../README.md)
- Hosted login requires Google-backed zkLogin runtime config on the API plus a reachable prover origin
- The frontend is the happy-path Sui submitter: it receives sponsor-prepared transaction bytes from Celeris, adds the zkLogin signature silently, submits to Sui testnet RPC, and then calls the completion route
- `npm run start:full-demo` can automate the app bootstrap and frontend launch when the local Sui CLI and auth prerequisites are already configured
