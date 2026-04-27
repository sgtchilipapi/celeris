# Phase 1 Identity

This phase turns the foundation auth stub into a concrete MVP identity slice:

- `POST /auth/session` now supports a replaceable `provider` contract
- the MVP provider is `dummy`, using email-based login for local development
- a canonical `userId` is created once and reused across logins for the same identity
- the response shape is `{ "userId": "...", "token": "jwt" }`
- issued sessions are stored separately from users so a real magic-link or external IdP can replace the dummy provider later

This keeps the SaaS boundary intact: Celeris owns player identity and session issuance before the rest of the payment and action flow begins.
