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

read_json_field() {
  local json="$1"
  local expression="$2"

  JSON_INPUT="${json}" JSON_EXPR="${expression}" node -e 'const data = JSON.parse(process.env.JSON_INPUT); const expr = process.env.JSON_EXPR.split("."); let current = data; for (const key of expr) current = current[key]; process.stdout.write(String(current));'
}

echo "Creating developer app..."
APP_JSON="$(post_json "/apps" "manual-app-1" "{
  \"developerId\": \"${DEVELOPER_ID}\",
  \"name\": \"Manual Developer Setup App\",
  \"priceCents\": 499,
  \"credits\": 500,
  \"webhookUrl\": \"https://game.example.com/celeris/webhook\"
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
echo "Summary"
echo "appId: ${APP_ID}"
echo "apiKey: ${API_KEY}"
