Phase 11 adds a minimal per-app dashboard surface.

Backend:
- `GET /apps` lists available apps for the dashboard sidebar
- `GET /metrics?appId=...` continues to aggregate from payments, ledger, and transactions
- metrics now include chart-ready series for credit flow, transaction outcomes, and per-user activity

UI:
- served from `/` (`/dashboard` remains as a compatibility alias)
- app list in a sidebar
- per-app metric cards
- simple charts for credit flow and transaction success/failure
- per-user activity table

This stays intentionally small for MVP:
- static HTML/CSS/JS served by the API process
- no frontend build system
- one-app-at-a-time dashboard view
