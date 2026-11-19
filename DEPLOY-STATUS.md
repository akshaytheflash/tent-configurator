# Deployment status

**Live:** <https://tent-configurator-live-akshaytheflashs-projects.vercel.app/>

Verified end to end on the live URL (not just locally):

- product page renders server-side pricing (`USD 950.00`, add-on prices)
- "Customize your tent" opens the designer in an iframe
- 3D tab loads `tent-8x8.glb` (200) with no console errors
- 2D→3D works from the same flat-lay geometry
- "Save & Exit" uploads renders and generates the PDF (`/api/designs/:id/renders`, `/api/designs/:id/pdf`, both 200)
- "Add to cart" adds a line item showing design id, variant, parts and a Configuration PDF link; cart subtotal `$950.00`

## How it is deployed

One Vercel project (`tent-configurator-live`) containing:

| Path | Contents |
| --- | --- |
| `/` | storefront build (`apps/storefront/dist`) |
| `/designer/` | configurator build (`apps/configurator/dist`, `--base=/designer/`) |
| `/api/*` | `api/index.js` — the whole Express API bundled to one CJS file (esbuild) with an `/api` prefix stripper |
| `/models/*` | rewrite to `/designer/models/*` (the 3D app requests models from the origin root) |

`vercel.json` holds the three rewrites; static files live under `public/` because
the deployment is uploaded as files (no build step on Vercel). The function is
fully bundled, so no `npm install` runs there.

Redeploy:

```bash
# storefront
VITE_API_BASE=/api \
VITE_CONFIGURATOR_URL=https://tent-configurator-live-akshaytheflashs-projects.vercel.app/designer/ \
  npm run build -w @tent/storefront

# configurator
VITE_API_BASE=/api npm run build -w @tent/configurator -- --base=/designer/

# bundle API for serverless
npx esbuild <entry> --bundle --platform=node --format=cjs --outfile=api/index.js
```

`./deploy.sh` packages the three artefacts and creates the production deployment.

## Local

| App | URL |
| --- | --- |
| Storefront | http://localhost:5173 |
| Configurator | http://localhost:5174 |
| API | http://localhost:8787/health |

Tests: 20 passing (14 unit + 6 integration).
