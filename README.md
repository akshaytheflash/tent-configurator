# Interactive Product Configurator — Custom Canopy Tent

A working replica of the reference dye-sublimation tent customiser: a 2D flat-lay
design editor, a synchronised 3D preview, server-side pricing, Shopify cart
integration and a production PDF.

**Live demo:** run `./deploy.sh` (after `npx vercel login`) to publish all three
apps to Vercel; it prints the storefront URL and writes `deploy-urls.txt`. The
deploy order matters because the frontends bake the API origin in at build time.

| App | Local | What it is |
| --- | --- | --- |
| Storefront | :5173 | Mock Shopify product page that embeds the configurator |
| Configurator | :5174 | The embeddable iframe app (also runs standalone) |
| API | :8787 | Mock pricing / CRM service + PDF generation |

---

## Why it is built this way

### One document, one geometry

The hardest part of this brief is keeping 2D and 3D in sync. Most implementations
solve it with two renderers and a synchronisation layer, which drifts. Here there
is a single source of truth:

1. `buildLayout()` turns a product definition into **print pieces** — a sawtooth
   strip of the four roof faces, one valance strip per eave, and a rectangle per
   wall. Coordinates are millimetres in the part's own space.
2. The **2D editor** draws those polygons and clips artwork to them.
3. The **3D scene** builds its roof and wall meshes from *the same polygons*, and
   derives each mesh's UVs from the same triangle it came from.

Because 3D UVs *are* 2D coordinates, artwork cannot land in the wrong place on the
roof. There is no sync code to get wrong — a logo moved in 2D moves the same
texels on the tent.

### Products are data, not code

`packages/core/src/catalogue.ts` describes products (dimensions, tiers, parts,
add-ons). `buildLayout()` derives every artboard from those numbers, so a 10×20
produces a different flat-lay than a 10×10 with no new code. Adding a product is
a record plus a 3D model.

The shipped `.glb` models (5×5, 6.5×6.5, 8×8) supply the aluminium frame. The
fabric is generated from the layout, because the models' fabric is baked with a
design-less texture unwrap — using it would make the 3D view a fake that cannot
show the customer's artwork. Frames are fitted by measuring each model's bounding
box against the product's canopy, so one asset serves many sizes.

### Money only comes from the server

The UI contains **no prices**. It asks `POST /quote` and renders what comes back.
The server re-derives the design facts from the configuration (it does not trust
the client's summary), filters add-ons to those the product offers, and returns a
deterministic `quoteId`. `POST /orders` re-prices and rejects a mismatched
`quoteId`, so a tampered cart cannot pay a lower price.

### Embedding is a small, versioned protocol

The storefront and configurator are separate origins talking over `postMessage`
(`packages/core/src/bridge.ts`). Both sides check `origin` **and**
`event.source`, and messages carry a source tag and protocol version. The host
never trusts a price from the iframe: it receives the configuration and asks the
pricing API itself before adding to cart.

```
host → iframe   INIT · SET_ADDONS · SET_TIER · REQUEST_SAVE · RESET · CLOSE
iframe → host   READY · AUTO_SAVE · SAVED (+renders) · ADD_TO_CART · CLOSE · ERROR
```

### Shopify

Configuration reaches the order as line-item properties (the same shape the
reference uses), so it works with stock Shopify without an app:

- `Variant ID` — the base setup variant
- `Design ID`, `Quote ID`, `Tent Size`, `Add-ons`
- `Panel Colors` — JSON of part → Pantone
- `Design Text` — JSON of text layers
- `Print File`, `Design Preview`, `UV Layout`, `Front/Back/Left/Right View`,
  `Configuration PDF`

Customisation surcharges that are not variant-priced travel as `addonLines`; in
production these map to hidden "customisation" variants bundled by a Cart
Transform. `POST /webhooks/shopify/orders-create` shows where the order's
`design_id` attribute is read to attach the stored design.

### Export and PDF

Renders are produced client-side (the artboards only exist there) and stored via
`POST /designs/:id/renders`; the PDF is built server-side from the same
configuration and quote, so what the customer approved is what production gets.
Pages: summary, colours, artwork placement, pricing, four production views, and
the print flat-lay. The machine-readable configuration is embedded as a PDF file
attachment (`<designId>.json`), so an order can be re-parsed later.

---

## Repository layout

```
packages/core        Domain engine (no React, no DOM): types, catalogue,
                     layout geometry, pricing rules, Shopify payloads, bridge
apps/configurator    Embeddable app: Konva 2D editor, react-three-fiber 3D
apps/storefront      Mock Shopify PDP + cart, demonstrates the iframe embed
apps/api             Mock pricing/CRM API, uploads, PDF generation
scripts/build-models.mjs  GLB optimisation (10 MB → ~1.4 MB each)
tests/integration    End-to-end journey tests against the running API
```

## Running locally

```bash
npm install
npm run dev          # api :8787, configurator :5174, storefront :5173
```

Open <http://localhost:5173>, then **Customize your tent**.

```bash
npm test                     # unit tests (core)
npm run test:integration     # end-to-end journey, needs the API running
npm run build                # production builds for all apps
npm run models               # regenerate optimised GLBs from shared/models
```

## Performance notes

- Models are optimised at build time (textures stripped where unused,
  quantised geometry); three.js is code-split from the app shell.
- 3D textures are generated at 1024 px and only rebuilt when a part's layers
  change; uploaded bitmaps are decoded once into an asset cache.
- The 2D canvas stores geometry in millimetres, so zooming, resizing and retina
  displays never change the document.
- Pricing requests are debounced and cancelled when superseded.

## Known limitations

- The 10×10 and 10×20 products reuse the 8×8 frame asset, fitted to size. A
  dedicated model per size would be a drop-in replacement.
- Uploads are stored on local disk; production would use object storage with
  signed URLs.
- The CRM and Shopify calls are mocked behind the same interfaces a real
  integration would implement.
