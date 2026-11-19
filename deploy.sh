#!/usr/bin/env bash
# Deploy the live demo to Vercel as ONE project:
#   /            storefront (static)
#   /designer/   configurator (static, iframe build)
#   /api/*       the whole Express API as one bundled serverless function
#
#   ./deploy.sh                    # uses the logged-in Vercel CLI token
#
# The single-project shape keeps pricing, the bridge, uploads and the PDF on one
# origin, so no CORS and no build-time URL juggling.
set -euo pipefail
cd "$(dirname "$0")"

PROJECT=tent-configurator-live
ALIAS="https://${PROJECT}-akshaytheflashs-projects.vercel.app"
OUT=.deploy-site

if ! npx vercel whoami >/dev/null 2>&1; then
  echo "Not logged in. Run 'npx vercel login' first." >&2
  exit 1
fi

echo "==> Building storefront (same-origin API)"
rm -rf apps/storefront/dist
(cd apps/storefront && VITE_API_BASE=/api VITE_CONFIGURATOR_URL=/designer npx vite build)

echo "==> Building configurator for /designer/"
rm -rf apps/configurator/dist
(cd apps/configurator && VITE_API_BASE=/api npx vite build --base=/designer/)

echo "==> Bundling API as a single serverless function"
cat > .deploy-entry.ts <<'ENTRY'
import app from './apps/api/src/app.js';
module.exports = (req: any, res: any) => {
  req.url = String(req.url || '/').replace(/^\/api(?=\/|$)/, '') || '/';
  app(req, res);
};
ENTRY
mkdir -p "$OUT/api" "$OUT/public"
npx --yes esbuild .deploy-entry.ts --bundle --platform=node --target=node22 --format=cjs \
  --outfile="$OUT/api/index.js" --external:@vercel/* >/dev/null
rm -f .deploy-entry.ts

cp -R apps/storefront/dist/. "$OUT/public/"
mkdir -p "$OUT/public/designer"
cp -R apps/configurator/dist/. "$OUT/public/designer/"

cat > "$OUT/vercel.json" <<'JSON'
{
  "rewrites": [
    { "source": "/models/(.*)", "destination": "/designer/models/$1" },
    { "source": "/api/(.*)", "destination": "/api/index" },
    { "source": "/(.*)", "destination": "/public/$1" }
  ]
}
JSON

echo "==> Creating production deployment"
python3 - "$OUT" "$PROJECT" "$ALIAS" <<'PY'
import base64, json, pathlib, sys, urllib.request

out, project, alias = sys.argv[1], sys.argv[2], sys.argv[3]
token = json.load(open(pathlib.Path.home() / '.local/share/com.vercel.cli/auth.json'))['token']

files = []
for p in sorted(pathlib.Path(out).rglob('*')):
    if not p.is_file():
        continue
    rel = str(p.relative_to(out))
    raw = p.read_bytes()
    try:
        text = raw.decode('utf-8')
        if '\x00' not in text:
            files.append({'file': rel, 'data': text})
            continue
    except UnicodeDecodeError:
        pass
    files.append({'file': rel, 'data': base64.b64encode(raw).decode(), 'encoding': 'base64'})

body = json.dumps({
    'name': project,
    'target': 'production',
    'files': files,
    'projectSettings': {'framework': None},
}).encode()
req = urllib.request.Request(
    'https://api.vercel.com/v13/deployments?skipAutoDetectionConfirmation=1',
    data=body,
    headers={'Authorization': 'Bearer ' + token, 'content-type': 'application/json'},
)
d = json.load(urllib.request.urlopen(req))
print('    deployment:', d['url'])
print('    files:', len(files))
PY

rm -rf "$OUT"
printf '\nLive demo: %s\n\n' "$ALIAS" | tee deploy-urls.txt
