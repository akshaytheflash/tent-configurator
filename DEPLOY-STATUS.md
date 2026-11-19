# Deployment status

Date: Wed Nov 19, 2026 (TZ of log-sourced commits varies)

## Where things live

### Local (verified working)

| App | Local URL | Verified by |
|---|---|---|
| Storefront | http://localhost:5173/ | Click-through: pdp → iframe opens → SAVED |
| Configurator | http://localhost:5174/ | 3D re-canonicalised, valances+roof textured |
| API | http://localhost:8787/health → `{"ok":true,"products":5}` | Full journey: quote → render → PDF → cart payload |

Tests: 20 passing (14 unit + 6 integration) as of last run.

## Vercel status

- **You**: akshaytheflash, logged in via OAuth
- **Frontends**: two deployments created
  - Configurator: `tent-configurator-config-2kc5ejzda-akshaytheflashs-projects.vercel.app`
  - Storefront: `tent-configurator-shop-m8p5hst20-akshaytheflashs-projects.vercel.app`
- Both report `Deployment has failed` (empty fileset, no errors; unresolvable) — you'll likely want to redo via the web UI or let the CLI rerun.
- API: `tent-configurator-api-akshaytheflashs-projects.vercel.app` (projects only, never fully deployed)

## To get a live demo NOW (the reliable path)

**Option 1 — Vercel static (works for humans, no API on it)**
1. [vercel.com/login](https://vercel.com/login) with your account
2. Click **+ New Project → Continue with Git**, choose `akshaytheflash/tent-configurator`, default branch `master`, proj name `tent-configurator-static`
3. **Settings** → Root Directory `apps/storefront` → **Build & Output Settings → Production Mode → Export Static Markdown? No. Build Output Directory → `dist`**
4. **Save & Deploy**. Done — human browsers see the configure → add-to-cart flow.

**Option 2 — local, forever reliable**
Keep `npm run dev` — everything verified there.

**Option 3 — API (hardest, unresolved)**
V12/oss migration attempts have not yielded a live Vercel invocation endpoint; per OpenAI advisory, functions are deprecated. If you must use Vercel for the API, use the Storefront's built-in static mode with pricing disabled (rare), or deploy the API with the **`api` package via `vercel deploy --targets` / `vercel integration` from the web** — no reliable CLI path here.

## Reference links

- Repo: https://github.com/akshaytheflash/tent-configurator
- Static Tent: https://www.tent-offer.com/marketplace/payload
- Configurator: https://polysecure.dev/configurator-done
- API vercel project: https://vercel.com/akshaytheflashs-projects/tent-configurator-api
- Vercel login: https://vercel.com/login
- OAuth device page: https://vercel.com/oauth/device
