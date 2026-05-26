# Celeris

Celeris handles hosted player auth, wallet-keyed credits, and managed on-chain action execution for web3 games.

The canonical demo flow is now the Sui testnet Hello Celeris slice:

- hosted Celeris auth with Google OAuth and zkLogin
- wallet address and credit balance
- a paid `say_hello` managed action
- a sponsor-wallet-backed Sui testnet transaction prepared by Celeris and submitted by the browser
- an app-wide transaction feed with Sui Explorer links

## Local services

- API: `npm run dev`
- Standalone player frontend: `npm run dev:mock-game-frontend -- --app-id=<app-id>`

For a real Stripe-hosted checkout in test mode, create a local `.env` or `.env.local` from [.env.example](.env.example) and set `STRIPE_SECRET_KEY`.
Without it, checkout session creation stays in local mock mode.

Hosted browser login expects zkLogin runtime configuration at startup.
Set these values in local `.env` or `.env.local` before running the API outside tests:

- `CELERIS_GOOGLE_CLIENT_ID`
- `CELERIS_ZKLOGIN_SALT_SEED`
- `CELERIS_ZKLOGIN_MAX_EPOCH`
- `CELERIS_ZKLOGIN_PROVER_ORIGIN`
- `CELERIS_SESSION_SECRET`
- `CELERIS_HOSTED_AUTH_ORIGIN`

Google OAuth should be configured with these callback URIs:

- `http://localhost:3000/auth/google/callback`
- `https://auth.celeris.pro/auth/google/callback`

The standalone frontend can also take `CELERIS_SUI_RPC_ORIGIN` when you want to override the default public Sui testnet fullnode.
When the demo frontend is accessed from a non-`localhost` origin, set `CELERIS_DEMO_FRONTEND_ORIGINS` to a comma-separated list of allowed public frontend origins so hosted auth will accept the callback origin.
For the canonical hosted demo, use two public hostnames:
- `CELERIS_HOSTED_AUTH_ORIGIN=https://auth.celeris.pro`
- `CLOUDFLARED_DEMO_FRONTEND_HOSTNAME=demo-frontend.celeris.pro`

## Canonical Manual Flow

Use this sequence for the supported Sui testnet Hello Celeris demo:

1. Install the Sui CLI locally and verify `sui` is on your `PATH`.
2. Configure Google OAuth plus the zkLogin runtime values from `.env.example`.
3. Start a zkLogin prover service and point `CELERIS_ZKLOGIN_PROVER_ORIGIN` at it.
4. Start the API with `npm run dev`.
5. Create a developer app through the developer API or dashboard.
6. Provision the app sponsor wallet:

```bash
node --import tsx scripts/provision-sponsor-wallet.ts \
  --app-id=<app-id> \
  --username=<developer-username> \
  --password=<developer-password>
```

7. Fund the returned sponsor wallet address with Sui testnet gas coins.
8. Build and test the Move package:

```bash
npm run sui:move:build
npm run sui:move:test
```

9. Publish the in-repo package from `sui/hello-celeris` with the Sui CLI and capture the package ID from the publish output.
10. Call `initialize_app` on the published package and capture:
    the shared `AppState` object ID and the owned `AppAuthorityCap` object ID created for your app.
11. Register the deployed package and object IDs with Celeris:

```bash
node --import tsx scripts/register-sui-package.ts \
  --app-id=<app-id> \
  --package-id=<package-id> \
  --app-state-object-id=<app-state-object-id> \
  --authority-cap-object-id=<authority-cap-object-id> \
  --username=<developer-username> \
  --password=<developer-password>
```

12. Configure the paid `say_hello` action with execution mode `managed`.
13. Start the standalone frontend:

```bash
npm run dev:mock-game-frontend -- --app-id=<app-id>
```

14. Open the frontend, continue to the hosted auth origin, choose a Google account, and return to the frontend callback.
15. Buy credits through the mock checkout path.
16. Execute `Say Hello Celeris`.
17. Inspect the resulting digest in Sui Explorer and in the app-wide transaction feed.

The helper scripts also accept `--access-token=<developer-access-token>` instead of username/password auth.

## Automated Path

If your machine already has:

- the `sui` CLI configured with a funded active testnet account
- zkLogin and Google auth env configured

you can automate the local deployment flow with:

```bash
npm run start:full-demo
```

The command starts the API, creates a developer app, provisions and funds the sponsor wallet, publishes and initializes the Move package, registers the resulting object IDs, configures `say_hello`, and launches the standalone frontend.
`start:full-demo` always allowlists the local frontend origin and also auto-includes `https://${CLOUDFLARED_DEMO_FRONTEND_HOSTNAME}` when that env var is set.

To expose the local API and frontend through the already-configured Cloudflare tunnel, run:

```bash
npm run start:tunnel
```

This uses `CLOUDFLARED_TUNNEL_TOKEN` and the published applications already configured in Cloudflare. In the canonical setup:
- `auth.celeris.pro` points to `http://localhost:3000`
- `demo-frontend.celeris.pro` points to `http://localhost:3002`

The canonical public login round-trip is:

1. open `https://demo-frontend.celeris.pro`
2. redirect or popup to `https://auth.celeris.pro`
3. choose a Google account
4. return to `https://demo-frontend.celeris.pro/auth/callback`

## Legacy References

- [docs/WORK_ORDERS/sui/README.md](docs/WORK_ORDERS/sui/README.md)
- [sui/README.md](sui/README.md)
- [mock-game-frontend/README.md](mock-game-frontend/README.md)
- [docs/solana-devnet-hello-demo-plan.md](docs/solana-devnet-hello-demo-plan.md) is legacy reference material for the previous Solana slice.
