CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE developers (
  developer_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE users (
  user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_subject TEXT UNIQUE,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_users_email_lower ON users ((LOWER(email))) WHERE email IS NOT NULL;

CREATE TABLE user_sessions (
  session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(user_id),
  provider TEXT NOT NULL,
  issued_token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE apps (
  app_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  developer_id UUID NOT NULL REFERENCES developers(developer_id),
  name TEXT NOT NULL,
  api_key TEXT NOT NULL UNIQUE,
  developer_webhook_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE credit_packages (
  package_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id UUID NOT NULL REFERENCES apps(app_id) ON DELETE CASCADE,
  price_cents INTEGER NOT NULL CHECK (price_cents > 0),
  credits INTEGER NOT NULL CHECK (credits > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE credit_balances (
  user_id UUID NOT NULL REFERENCES users(user_id),
  app_id UUID NOT NULL REFERENCES apps(app_id) ON DELETE CASCADE,
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  reserved INTEGER NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, app_id)
);

CREATE TABLE credit_ledger (
  entry_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(user_id),
  app_id UUID NOT NULL REFERENCES apps(app_id) ON DELETE CASCADE,
  pending_action_id UUID,
  payment_id UUID,
  type TEXT NOT NULL CHECK (type IN ('grant', 'reserve', 'capture', 'release')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  idempotency_key TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (app_id, idempotency_key, type)
);

CREATE TABLE action_types (
  app_id UUID NOT NULL REFERENCES apps(app_id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  cost INTEGER NOT NULL CHECK (cost > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (app_id, action_type)
);

CREATE TABLE pending_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(user_id),
  app_id UUID NOT NULL REFERENCES apps(app_id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  cost INTEGER NOT NULL CHECK (cost > 0),
  payload_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('reserved', 'approved', 'submitted', 'success', 'failed', 'released', 'expired')),
  expires_at TIMESTAMPTZ NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (app_id, idempotency_key)
);

CREATE TABLE transactions (
  tx_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pending_action_id UUID NOT NULL UNIQUE REFERENCES pending_actions(id),
  app_id UUID NOT NULL REFERENCES apps(app_id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(user_id),
  provider_tx_id TEXT NOT NULL,
  raw_tx TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('submitted', 'success', 'failed')),
  summary JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE assets (
  asset_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id UUID NOT NULL REFERENCES apps(app_id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(user_id),
  item_def_id TEXT NOT NULL,
  transaction_id UUID NOT NULL REFERENCES transactions(tx_id),
  status TEXT NOT NULL CHECK (status IN ('held')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE payments (
  payment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(user_id),
  app_id UUID NOT NULL REFERENCES apps(app_id) ON DELETE CASCADE,
  package_id UUID NOT NULL REFERENCES credit_packages(package_id),
  provider TEXT NOT NULL DEFAULT 'stripe',
  provider_session_id TEXT NOT NULL UNIQUE,
  provider_event_id TEXT UNIQUE,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  credits INTEGER NOT NULL CHECK (credits > 0),
  status TEXT NOT NULL CHECK (status IN ('pending', 'paid')),
  idempotency_key TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (app_id, idempotency_key)
);

CREATE TABLE usage_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id UUID NOT NULL REFERENCES apps(app_id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(user_id),
  event_type TEXT NOT NULL,
  value INTEGER,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_credit_ledger_user_app ON credit_ledger (user_id, app_id, created_at);
CREATE INDEX idx_pending_actions_app_status ON pending_actions (app_id, status, created_at);
CREATE INDEX idx_transactions_app_created_at ON transactions (app_id, created_at);
CREATE INDEX idx_assets_app_user ON assets (app_id, user_id);
CREATE INDEX idx_usage_events_app_type ON usage_events (app_id, event_type, created_at);

-- Production balance updates should use:
-- SELECT * FROM credit_balances WHERE user_id = $1 AND app_id = $2 FOR UPDATE;
