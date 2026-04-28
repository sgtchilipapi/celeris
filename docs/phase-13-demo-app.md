Phase 13 adds a simple player-facing demo app.

Frontend:
- Sign In button
- Buy Credits button
- Mint Item button
- current balance display
- result panel showing the latest API response

Server support:
- `/demo` serves the frontend
- `POST /demo/checkout/complete` simulates the payment provider callback for the created checkout session so the browser demo can complete a purchase without exposing webhook signing logic client-side

This is intentionally a demo surface, not a production client flow. The gameplay action path still goes through the real session auth, pending action, developer approval, verification, relayer, credit capture, and asset creation pipeline.
