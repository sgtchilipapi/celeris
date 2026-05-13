# Hello Celeris Solana Program

This workspace contains the source for the devnet-only Anchor program introduced by `SDH-01`.

Canonical rules defined here:

- app state PDA seed prefix is `app_state`
- app state PDA second seed is `sha256(appId)`
- the authority signer is the per-app sponsor wallet
- `say_hello` records the player wallet as data only
- greeting storage is capped at 100 entries

The declared program ID is a placeholder for local source and IDL stability. Replace it during deployment and register the deployed devnet program through the later SDH work orders.
