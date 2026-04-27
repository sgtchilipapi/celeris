# Phase 4 Developer Setup

This phase tightens the developer onboarding contract:

- `POST /apps` creates the app and returns the minimal setup payload:
  `{ "appId": "...", "apiKey": "..." }`
- `POST /apps/:appId/actions` stores the configured action type and cost
- the developer webhook endpoint is accepted as `webhookUrl` on app creation and stored on the app record as `developerWebhookUrl`

The internal setup flow still creates the default credit package needed by later MVP phases, but that package is no longer exposed through the app-creation response.
