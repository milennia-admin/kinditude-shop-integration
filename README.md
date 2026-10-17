# Kinditude shop on Webflow (Shopify Storefront API)

No Webflow Ecommerce is used. Shopify stays the shop (prices, stock, cart, checkout). Webflow holds one CMS page per
product for SEO, and `shop.js` hydrates the Lumos-built elements with live Shopify data through data-attributes.
State uses Lumos `.is-active` + state/trigger variables.

## How the pieces fit

| Piece | What it does |
|---|---|
| Webflow CMS collection **Shop Products** | One item per Shopify product, URL `/shop-products/<handle>`. Mirrors Shopify, written by `sync-cms.mjs`. |
| **Shop Products Template** page | Bound to the collection fields (see below). Head code adds `og:image`, `twitter:image` and Product JSON-LD. |
| `sync-cms.mjs` | Shopify -> Webflow sync. Run by hand or by the GitHub Action. |
| `shop.js` | Loaded from jsDelivr (pinned commit) in the site head. Fills price, size pills, gallery, accordions and the cart. |
| **SHOP** page + Nav | Shop Grid component and the cart drawer. Cards link to `/shop-products/<handle>`. |

Classes: `shop_*` (grid), `pdp_*` (product page), `cartdrawer_*` and `nav_shopcart_*` (cart).

## Template bindings (Shop Products Template)

| Element | CMS field |
|---|---|
| Wrapper `data-product-handle` | Shopify Handle |
| h1 `pdp_title` | Display Title (letter name, or product title) |
| Tagline | Tagline |
| Price | Price Label |
| First gallery image + alt | Main Image + Name |
| Description (rich text) | Description (story + Children + Location only) |
| Hidden source `data-shop-field="accordion-source"` | Accordion Sections |
| Page title / meta description / OG title and description | Name / SEO Description |
| Head code: `og:image`, `twitter:image`, Product JSON-LD | Main Image, Name, Slug, Price Amount, Currency, Availability |

The visible price, size pills, quantity and Add to cart always come live from Shopify. The section stays transparent
until `shop.js` has filled it in (see `head.html`), so the CMS copy never flashes.

## Content rules

- **Description** keeps only the story paragraph plus `Children:` and `Location:`. `description.mjs` trims the Shopify body:
  the first heading is the tagline (own field), later headings are accordion sections.
- **Accordions, letters (A-J):** built from the Shopify description headings (LIMITED EDITION, PAPER QUALITY,
  SHIPPING INFORMATION, RETURN POLICY ...), matched to the four print items. The fifth item is hidden.
- **Accordions, other products:** the CMS field **Accordion Sections** (`<h2>` heading, then content; up to five).
  Section n fills item n, unused items are hidden. Copy lives in `accordions.json`. A non-letter product with no
  sections shows no accordions (posters).
- A letter is a product whose Shopify title looks like `B – Brave (Namibia)`. Other titles are used as they are.

## Sync (Shopify -> Webflow)

```
WEBFLOW_TOKEN=... node sync-cms.mjs            # dry run, prints the plan
WEBFLOW_TOKEN=... node sync-cms.mjs --apply    # create/update + publish items
WEBFLOW_TOKEN=... node sync-cms.mjs --apply --prune   # also delete items that left Shopify
```

Token: Webflow site token with CMS read + write. Never commit it. Slug = Shopify handle.
The Shopify domain, Storefront token and API version are read from `shop.js`.

Automatic: `.github/workflows/sync-cms.yml` runs the sync daily and on demand. Add the repository secret
`WEBFLOW_TOKEN` (Settings > Secrets and variables > Actions). To run it after a Shopify change, use the Actions tab
(Run workflow) or POST a `repository_dispatch` event of type `shopify-products-changed`.

## Deploy `shop.js`

1. Commit `shop.js` to `main` of `milennia-admin/kinditude-shop-integration`.
2. Put the new commit SHA in the script URL in Webflow: Site settings > Custom code > Head
   (`cdn.jsdelivr.net/gh/milennia-admin/kinditude-shop-integration@<sha>/shop.js`) and keep `head.html` in step.
3. Publish the site.

## Attribute map

- Grid: `[data-shop="grid"]` > template `[data-shop="card"]` (a link) with `data-shop-field` = `image | title | price | link`.
- Product page: wrapper `[data-product-handle]` (CMS-bound; `?handle=` still wins on a static page);
  `data-shop-field` = `letter-title | tagline | description | price | qty | add-label | accordion-source`;
  `[data-shop="gallery"]` > `[data-shop="gallery-item"]`; `[data-shop="variant-pills"]` > `[data-shop="variant-pill"]`;
  `[data-shop-action="dec|inc"]`; `[data-shop="add"]`; `[data-shop="accordion"]` (details).
- Cart: `[data-cart="open|close|count|root|empty|filled|items|item|subtotal|checkout"]`, item buttons `[data-cart-action="dec|inc|remove"]`.

## Behaviour

- No flash: head CSS keeps `[data-shop="grid"]` and `[data-product-handle]` transparent until `shop.js` sets `data-loaded`
  (4 s failsafe).
- Grid and product data are cached in `localStorage` (`kd_v1:*`) and painted at once; fresh data re-renders only if it
  changed. Bump the `kd_v1` prefix if the query shape changes.
- Cart id in `localStorage` (`kd_cart_id`); checkout is Shopify hosted `cart.checkoutUrl`.
- Letter name is parsed from the Shopify title ("B – Brave (Namibia)" -> "Brave"); the tagline is the first heading
  in the description.
- Product handles: a-south-africa ... j-sri-lanka, postcard-bundle, kitnc (T-shirt), complete-alphabet-collectors, posters.

## Open items

- Posters has no price, stock or description in Shopify yet. Prices are on the Impact Art page (single A4 €25, A3 €35,
  A2 €55; bundles of 10 A4 €170, A3 €250, A2 €400). After filling them in Shopify, re-run the sync.
- The T-shirt sizing guide copy says "Kids 2-14 years" but the variants are adult sizes.
