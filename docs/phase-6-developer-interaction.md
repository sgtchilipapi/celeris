Phase 6 adds the real developer interaction boundary to the happy path.

What changed:
- `POST /actions/mint_item` now calls the app's configured `developerWebhookUrl`
- the SaaS sends the pending action context plus the mint payload to the developer backend
- the developer backend approves or rejects the action
- if the developer rejects, the SaaS releases reserved credits, marks the pending action `failed`, and returns an error

Current manual setup:
1. Start the API with `npm run start:api`
2. Start the mock developer backend with `npm run start:mock-developer`
3. Run `scripts/manual-dev-setup-flow.sh <developer-id>`

This preserves the MVP boundary:
- the developer server validates game logic
- the SaaS never accepts a raw client transaction
- the SaaS owns reservation, pending action state, verification, and execution
