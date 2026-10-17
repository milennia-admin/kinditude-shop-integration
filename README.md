# Kinditude shop on Webflow (Shopify Storefront API)

No Webflow Ecommerce is used. `shop.js` hydrates Lumos-built Webflow elements from the
Shopify Storefront API through data-attributes. State uses Lumos `.is-active` + state/trigger variables.

## What exists in Webflow (KINDITUDE site, nothing published)

| Where | What |
|---|---|
| `SHOP` page (draft) | **Shop Grid** component (Shop group), appended at the end of main |
| `Product Template` page (draft, `/product-template`) | Full product page, handle on `pdp_wrap` (`data-product-handle`) |
| **Nav** component | Two `nav_shopcart_wrap` buttons (desktop + mobile) and the `cartdrawer_*` drawer |

Classes: `shop_*` (grid), `pdp_*` (product page), `cartdrawer_*` and `nav_shopcart_*` (cart).

## Install

Site settings > Custom code > **Head**: paste `head.html` (preconnects, the reveal CSS and failsafe, and the
`<script src defer>` tag). Host `shop.js` and point the tag at it; loading it from the head starts the Shopify
requests before the page finishes parsing. Config (domain, token) is at the top of `shop.js`.

## Attribute map

- Grid: `[data-shop="grid"]` > template `[data-shop="card"]` (a link) with `data-shop-field` = `image | title | price | link`.
- Product page: one page (`/letter`), handle from `?handle=<handle>` (cards link there; set `productPath` in config or `data-product-path` on the grid if the slug changes). Wrapper `[data-product-handle]` is the fallback; `data-shop-field` = `letter-title | tagline | description | price | qty | add-label`;
  `[data-shop="gallery"]` > `[data-shop="gallery-item"]`; `[data-shop="variant-pills"]` > `[data-shop="variant-pill"]`;
  `[data-shop-action="dec|inc"]`; `[data-shop="add"]`; `[data-shop="accordion"]` (details).
- Cart: `[data-cart="open|close|count|root|empty|filled|items|item|subtotal|checkout"]`, item buttons `[data-cart-action="dec|inc|remove"]`.

## Behaviour

- No flash: head CSS keeps `[data-shop="grid"]` and `[data-product-handle]` transparent until `shop.js` sets `data-loaded`.
- Grid and product data are cached in `localStorage` (`kd_v1:*`) and painted at once; fresh data re-renders only if it changed. Bump the `kd_v1` prefix if the query shape changes.
- Cart, grid and product page load in parallel; cards use a slim query with resized images (first row eager, rest lazy).

- Cart id in `localStorage` (`kd_cart_id`); checkout is Shopify hosted `cart.checkoutUrl`.
- Letter name is parsed from the Shopify title ("B – Brave (Namibia)" → "Brave"); the tagline is the first heading in the description.
- Product handles: a-south-africa, b-namibia, c-sweden, d-germany, e-dominican-republic, f-croatia, g-thailand,
  h-norway, i-india, j-sri-lanka, postcard-bundle, kitnc, complete-alphabet-collectors, posters.
