#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <developer-id> [base-url]" >&2
  exit 1
fi

DEVELOPER_ID="$1"
BASE_URL="${2:-http://localhost:3000}"

post_json() {
  local path="$1"
  local idempotency_key="$2"
  local payload="$3"

  curl -sS -X POST "${BASE_URL}${path}" \
    -H 'content-type: application/json' \
    -H "idempotency-key: ${idempotency_key}" \
    -d "${payload}"
}

get_json() {
  local path="$1"
  curl -sS "${BASE_URL}${path}"
}

read_json_field() {
  local json="$1"
  local expression="$2"

  JSON_INPUT="${json}" JSON_EXPR="${expression}" node -e 'const data = JSON.parse(process.env.JSON_INPUT); const expr = process.env.JSON_EXPR.split("."); let current = data; for (const key of expr) current = current[key]; process.stdout.write(String(current));'
}

echo "Creating player session..."
SESSION_JSON="$(post_json "/auth/session" "manual-session-1" '{
  "provider": "dummy",
  "email": "manual-player@example.com"
}')"
echo "${SESSION_JSON}"
USER_ID="$(read_json_field "${SESSION_JSON}" "userId")"

echo
echo "Creating developer app..."
APP_JSON="$(post_json "/apps" "manual-app-1" "{
  \"developerId\": \"${DEVELOPER_ID}\",
  \"name\": \"Manual Developer Setup App\",
  \"priceCents\": 499,
  \"credits\": 500,
  \"webhookUrl\": \"http://localhost:3001\"
}")"
echo "${APP_JSON}"
APP_ID="$(read_json_field "${APP_JSON}" "appId")"
API_KEY="$(read_json_field "${APP_JSON}" "apiKey")"

echo
echo "Configuring mint_item action..."
ACTION_JSON="$(post_json "/apps/${APP_ID}/actions" "manual-action-1" '{
  "actionType": "mint_item",
  "cost": 50
}')"
echo "${ACTION_JSON}"

echo
echo "Reading app setup details..."
SETUP_JSON="$(get_json "/apps/${APP_ID}/setup")"
echo "${SETUP_JSON}"
PACKAGE_ID="$(read_json_field "${SETUP_JSON}" "creditPackages.0.packageId")"

echo
echo "Creating checkout session..."
CHECKOUT_JSON="$(post_json "/checkout/session" "manual-checkout-1" "{
  \"appId\": \"${APP_ID}\",
  \"userId\": \"${USER_ID}\",
  \"packageId\": \"${PACKAGE_ID}\",
  \"successUrl\": \"https://example.com/success\",
  \"cancelUrl\": \"https://example.com/cancel\"
}")"
echo "${CHECKOUT_JSON}"
CHECKOUT_SESSION_ID="$(read_json_field "${CHECKOUT_JSON}" "checkoutSessionId")"

WEBHOOK_PAYLOAD="$(cat <<JSON
{"id":"evt_manual_script_1","type":"checkout.session.completed","data":{"object":{"id":"${CHECKOUT_SESSION_ID}","amount_total":499,"metadata":{"userId":"${USER_ID}","appId":"${APP_ID}","credits":500}}}}
JSON
)"

STRIPE_SIGNATURE="$(WEBHOOK_PAYLOAD="${WEBHOOK_PAYLOAD}" node -e 'const crypto = require("node:crypto"); process.stdout.write(crypto.createHmac("sha256", "whsec_dev").update(process.env.WEBHOOK_PAYLOAD).digest("hex"));')"

echo
echo "Sending payment webhook..."
WEBHOOK_JSON="$(curl -sS -X POST "${BASE_URL}/webhooks/payment" \
  -H 'content-type: application/json' \
  -H 'idempotency-key: manual-webhook-1' \
  -H "stripe-signature: ${STRIPE_SIGNATURE}" \
  -d "${WEBHOOK_PAYLOAD}")"
echo "${WEBHOOK_JSON}"

echo
echo "Minting item..."
MINT_JSON="$(post_json "/actions/mint_item" "manual-mint-1" "{
  \"appId\": \"${APP_ID}\",
  \"userId\": \"${USER_ID}\",
  \"payload\": {
    \"itemDefId\": \"iron_sword\"
  }
}")"
echo "${MINT_JSON}"

echo
echo "Fetching final user balances..."
USERS_JSON="$(get_json "/users?appId=${APP_ID}")"
echo "${USERS_JSON}"

echo
echo "Summary"
echo "userId: ${USER_ID}"
echo "appId: ${APP_ID}"
echo "apiKey: ${API_KEY}"
echo "packageId: ${PACKAGE_ID}"
echo "checkoutSessionId: ${CHECKOUT_SESSION_ID}"
