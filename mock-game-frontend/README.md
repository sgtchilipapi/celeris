# Mock Game Frontend

Standalone player-facing frontend for the Solana devnet Hello Celeris slice.

It is served separately from the API and proxies `/api/*` requests back to the Celeris API server.
The frontend uses the browser SDK and the hosted Celeris auth gateway flow for player sign-in.
Hosted login expects the API runtime to be configured with `CELERIS_PRIVY_APP_ID`, `PRIVY_APP_SECRET`, and `CELERIS_SESSION_SECRET`.
The frontend never uses a raw Privy token against player routes. Hosted login returns a one-time auth code that the browser SDK exchanges for a Celeris player session.
The frontend serves `/auth/callback` from the same app bundle so the browser SDK can own callback parsing, state validation, auth-code exchange, and popup or redirect completion without custom app auth code.

Default ports:

- Celeris API: `3000`
- Mock game frontend: `3002`

Run with:

```bash
npm run dev:mock-game-frontend -- --app-id=<app-id>
```

Supported arguments:

- `--app-id=<app-id>` required
- `--app-name=<app-name>` optional, defaults to `Mock Game`
- `--api-origin=<origin-or-path>` optional, defaults to `/api`
- `--hosted-auth-origin=<origin>` optional, defaults to `CELERIS_HOSTED_AUTH_ORIGIN` or `CELERIS_API_ORIGIN`
- `--redirect-uri=<uri>` optional, defaults to `http://localhost:3002/auth/callback`

The frontend config served from `/config.json` is shaped like:

```json
{
  "appId": "app-id",
  "appName": "Hello Celeris",
  "apiOrigin": "/api",
  "hostedAuthOrigin": "http://localhost:3000",
  "redirectUri": "http://localhost:3002/auth/callback"
}
```

Runtime behavior:

- public config no longer carries action IDs, placeholder program IDs, or local RPG demo state
- app metadata, action cost, program registration, and transaction feed are loaded from the player API after sign-in
- the player flow is limited to wallet display, credits, username input, `Purchase Credits`, `Say Hello Celeris`, and the app-wide transaction feed

Stripe test mode:

- Set `STRIPE_SECRET_KEY` in a local `.env` or `.env.local` for the API to use real Stripe-hosted Checkout
- Leave it unset to stay on the local mock checkout path, which completes through the standalone frontend server instead of an API demo helper route
