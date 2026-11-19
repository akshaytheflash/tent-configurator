#!/usr/bin/env bash
# Deploy the three apps to Vercel.
#
#   ./deploy.sh                 # uses your logged-in Vercel account
#
# Order matters: the API must exist first because the two frontends need its
# URL at build time.
set -euo pipefail

if ! npx vercel whoami >/dev/null 2>&1; then
  echo "Not logged in. Run 'npx vercel login' first." >&2
  exit 1
fi

echo "==> Deploying API"
API_URL=$(cd apps/api && npx vercel deploy --prod --yes 2>&1 | grep -oE 'https://[a-z0-9-]+\.vercel\.app' | tail -1)
echo "    API: $API_URL"

echo "==> Deploying configurator"
CFG_URL=$(cd apps/configurator && VITE_API_BASE="$API_URL" \
  npx vercel deploy --prod --yes 2>&1 | grep -oE 'https://[a-z0-9-]+\.vercel\.app' | tail -1)
echo "    Configurator: $CFG_URL"

echo "==> Deploying storefront"
SHOP_URL=$(cd apps/storefront && VITE_API_BASE="$API_URL" VITE_CONFIGURATOR_URL="$CFG_URL" \
  npx vercel deploy --prod --yes 2>&1 | grep -oE 'https://[a-z0-9-]+\.vercel\.app' | tail -1)
echo "    Storefront: $SHOP_URL"

printf '\nLive demo: %s\n\n' "$SHOP_URL" | tee deploy-urls.txt
