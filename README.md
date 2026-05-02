# Celeris
Celeris handles how players pay for game actions and execute them on-chain so players don't need wallets.

### Built for indie web3 game devs

Built for server-authoritative games to strike the right balance between on-chain programs and off-chain execution.

Aimed primarily to help indie game devs monetize their games and execute on-chain actions without dealing with wallets, payments, or transaction infrastructure.

Game devs can focus on building gameplay and content.


### TLDR;

Celeris lets developers:

- onboard players instantly
- monetize through credits
- execute on-chain actions without infra

Build the game. Celeris handles money and execution.

### Local services

- API: `npm run dev`
- Mock game frontend: `npm run dev:mock-game-frontend -- --app-id=<app-id>`
- Full demo orchestrator: `npm run start:full-demo`

For a real Stripe-hosted checkout in test mode, create a local `.env` or `.env.local` from [.env.example](.env.example) and set `STRIPE_SECRET_KEY`.
Without it, checkout session creation stays in the local mock mode.

Hosted browser login now expects Privy runtime configuration at startup.
Set `CELERIS_PRIVY_APP_ID`, `PRIVY_APP_SECRET`, and `CELERIS_SESSION_SECRET` in local `.env` or `.env.local` before running the API outside tests.
`PRIVY_VERIFIER_SECRET` remains accepted as a legacy alias, but the runtime now uses the Privy app secret server-side.
Browser sign-in completes on `auth.celeris.pro`, returns a one-time auth code to the app frontend, and exchanges that code for a Celeris player session used on player API routes.

`npm run start:full-demo` starts the API, provisions a demo developer and an app using Celeris-owned Privy auth, configures the default demo actions with execution modes, and opens the dashboard ready for manual verification.
For the MVP demo path, the intended default chain is Solana Devnet (`solana:103`).

Use `-- --with-player-frontend` to boot the standalone player frontend, which now signs players in through the hosted Celeris auth flow and talks to the player API through the browser SDK.
The hosted auth popup uses the real Privy browser SDK on `auth.celeris.pro`, ensures the embedded wallet exists on the allowed chain, and maps the verified Privy subject to one shared Celeris user across apps before issuing the Celeris player session.

Pass `-- --no-tunnel` to skip Cloudflare tunnel startup locally.

Named Cloudflare tunnel setup for the full demo:

- `CELERIS_HOSTED_AUTH_ORIGIN=https://auth.celeris.pro`
- `CLOUDFLARED_AUTH_HOSTNAME=auth.celeris.pro`
- `CLOUDFLARED_DEMO_FRONTEND_HOSTNAME=demo-frontend.celeris.pro`

When `--with-player-frontend` is enabled, the demo script provisions the app to allow both:

- `http://localhost:3002`
- `https://demo-frontend.celeris.pro`


### Overview

Celeris is a backend service for game developers.

It provides:

- user identity
- credit based payments
- action authorization
- transaction execution
- asset handling

Developers keep full control of game logic. Celeris handles money and execution.

### What it solves

- players drop off due to wallet setup and funding
- payments and credit systems are complex to build
- on-chain execution requires relayers and gas handling
- transaction flows can break gameplay

Celeris removes these problems.

### Future Direction

The current MVP focuses on backend primitives and action orchestration.

A possible long-term direction is for Celeris to evolve into a managed game backend platform with:

- SDK-first frontend and backend integration
- standard user-token-authenticated player APIs
- an opinionated backend scaffold
- baked-in database infrastructure
- a frontend starter such as a Godot project
- shared Celeris configuration
- repo generation and optional hosting

See [docs/sdk-pivot.md](docs/sdk-pivot.md) for the planned SDK/auth pivot and demo backend removal.
See [docs/future-direction.md](docs/future-direction.md) for the full concept.
See [docs/future-refactorings.md](docs/future-refactorings.md) for deferred architecture backlog items.

### How it works

Player starts game
→ signs in through Celeris
→ buys credits

Player performs an action
→ Celeris checks credits and reserves cost
→ Celeris calls developer server

Developer validates action
→ builds transaction
→ returns transaction

Celeris verifies and executes transaction
→ updates credits
→ records asset
→ returns result to game

### Core concepts
#### UserId

Celeris generates the canonical userId.
Developers use this as the player identifier.

#### Credits

Players purchase credits using card payments.
Developers specify pricing and credit points.
Actions consume credits.

#### Actions

Developers define actions and their cost (i.e. Item transfers, mints, etc.).

#### PendingAction

Represents a reserved and authorized action before execution.

#### Execution

Celeris verifies developer transactions and submits them on-chain.

#### Assets

Assets are minted and held in custody, mapped to userId.

# Why Blockchain and why Celeris

Online games rely on centralized servers. This makes them vulnerable to:

- server compromises  
- exploits and cheating  
- shutdowns that wipe entire economies  

A strong community can disappear overnight if the game economy breaks.  
Blockchain can help by adding **verifiable integrity** to parts of the system.

However, using blockchain everywhere is not practical. It is:

- costly  
- slower than traditional systems  
- difficult to integrate cleanly into gameplay  

---

## The Blockchain Game Trilemma

```
           Security
              ▲
              │
              │
              │
UX ◄──────────┼──────────► Decentralization
              │
              │
              │
```

Most blockchain games struggle to find a balance between the three. 

It is common for game devs to go fully decentralized sacrificing UX in the process.

---

## Celeris approach

Celeris focuses on balance, not extremes.

- On-chain
  - economy integrity  
  - rule enforcement  
  - validation  

- Off-chain
  - real-time gameplay  
  - combat loops  
  - player interactions  

- Overlap
  - summarized results  
  - validated outcomes  

---

## Why not fully on-chain

Games are not just systems. They are experiences.

Requiring a transaction for every action:

- breaks immersion  
- increases cost  
- introduces friction  

Example:

A dungeon run should not require a transaction for every enemy killed.

---

## The Celeris model

Instead:

```
Play session (off-chain)
↓
Game server validates and summarizes results
↓
Summary is turned into a single transaction
↓
On-chain program validates against rules
↓
Deterministic rewards are applied
```

The blockchain enforces boundaries and fairness, not moment-to-moment gameplay.

---

## Unbreakable Play

Celeris introduces:

Unbreakable Play

A design principle where:

- players start instantly  
- gameplay is uninterrupted  
- economies remain stable  
- results are verifiable  
