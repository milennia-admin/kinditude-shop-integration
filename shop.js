/*!
 * Kinditude shop: Webflow front end for the Shopify Storefront API.
 * Hydrates Lumos-built Webflow pages through data-attributes. See README.md.
 * Load with <script src defer> in the head (see head.html); the cart drawer lives in the Nav component.
 */
(() => {
  const config = {
    domain: "shop.kinditude.com",
    // Public Storefront token (read products + write carts only). Safe in front-end code.
    token: "572944d57b05f996b877f364ffbb672b",
    apiVersion: "2025-07",
    storageKey: "kd_cart_id",
    productPath: "/shop-products", // CMS template page (synced by sync-cms.mjs), opened as <productPath>/<handle>
    activeClass: "is-active",
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const store = {
    get() {
      try { return localStorage.getItem(config.storageKey); } catch { return null; }
    },
    set(id) {
      try { id ? localStorage.setItem(config.storageKey, id) : localStorage.removeItem(config.storageKey); } catch {}
    },
  };

  // Always two decimals with a comma, symbol first: €120,00 / €1.200,00.
  const formatMoney = ({ amount, currencyCode }) => {
    const symbol = new Intl.NumberFormat("en", { style: "currency", currency: currencyCode, currencyDisplay: "narrowSymbol" })
      .formatToParts(0).find((part) => part.type === "currency").value;
    return symbol + new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(amount));
  };

  async function storefront(query, variables = {}) {
    const res = await fetch(`https://${config.domain}/api/${config.apiVersion}/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Storefront-Access-Token": config.token,
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) throw new Error(`Storefront API ${res.status}`);
    const json = await res.json();
    if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "));
    return json.data;
  }

  // Stale-while-revalidate: paint from localStorage at once, then refresh and re-render only if the data changed.
  async function cached(key, load, render) {
    let hit = null;
    try { hit = JSON.parse(localStorage.getItem(key)); } catch {}
    if (hit) render(hit);
    try {
      const fresh = await load();
      if (!fresh || JSON.stringify(fresh) === JSON.stringify(hit)) return;
      try { localStorage.setItem(key, JSON.stringify(fresh)); } catch {}
      render(fresh);
    } catch (err) {
      if (!hit) throw err;
      console.error("[shop]", err);
    }
  }

  // Placeholders stay transparent (head CSS) until the first real render sets data-loaded.
  const reveal = (el) => el && (el.dataset.loaded = "true");

  /* ---------- DOM helpers ---------- */

  // Elements carry display from their Webflow class, so the hidden attribute alone would lose.
  const setHidden = (el, hidden) => {
    el.hidden = hidden;
    el.style.display = hidden ? "none" : "";
  };

  const fill = (root, field, value) =>
    $$(`[data-shop-field="${field}"]`, root).forEach((el) => (el.textContent = value));

  const fillImage = (root, image, fallbackAlt = "") =>
    $$('[data-shop-field="image"]', root).forEach((el) => {
      if (!image) return;
      el.src = image.url;
      el.removeAttribute("srcset");
      el.removeAttribute("sizes");
      el.alt = image.altText || fallbackAlt;
    });

  async function withBusy(el, fn) {
    el.setAttribute("aria-busy", "true");
    try { await fn(); }
    catch (err) { console.error("[shop]", err); }
    finally { el.removeAttribute("aria-busy"); }
  }

  /* ---------- Queries ---------- */

  const productFields = `
    handle title availableForSale descriptionHtml
    featuredImage { url altText }
    priceRange { minVariantPrice { amount currencyCode } }
    variants(first: 30) { nodes {
      id title availableForSale
      price { amount currencyCode }
      image { url altText }
    } }`;

  // Cards need less than the product page: one small image and only a variant count.
  const gridFields = `
    handle title availableForSale descriptionHtml
    featuredImage { url(transform: { maxWidth: 900 }) altText }
    priceRange { minVariantPrice { amount currencyCode } }
    variants(first: 2) { nodes { id } }`;

  const cartFields = `
    id checkoutUrl totalQuantity
    cost { subtotalAmount { amount currencyCode } }
    lines(first: 50) { nodes {
      id quantity
      cost { totalAmount { amount currencyCode } }
      merchandise { ... on ProductVariant {
        id title
        image { url altText }
        product { title handle featuredImage { url altText } }
      } }
    } }`;

  /* ---------- Cart ---------- */

  let cart = null;

  function assertOk(payload) {
    if (payload?.userErrors?.length) throw new Error(payload.userErrors.map((e) => e.message).join("; "));
  }

  async function loadCart() {
    const id = store.get();
    if (!id) return null;
    const data = await storefront(`query($id: ID!) { cart(id: $id) { ${cartFields} } }`, { id });
    if (!data.cart) store.set(null);
    return data.cart;
  }

  async function addToCart(variantId, quantity = 1) {
    const lines = [{ merchandiseId: variantId, quantity }];
    if (!cart) {
      const data = await storefront(
        `mutation($lines: [CartLineInput!]) { cartCreate(input: { lines: $lines }) { cart { ${cartFields} } userErrors { message } } }`,
        { lines }
      );
      assertOk(data.cartCreate);
      cart = data.cartCreate.cart;
      store.set(cart.id);
    } else {
      const data = await storefront(
        `mutation($id: ID!, $lines: [CartLineInput!]!) { cartLinesAdd(cartId: $id, lines: $lines) { cart { ${cartFields} } userErrors { message } } }`,
        { id: cart.id, lines }
      );
      assertOk(data.cartLinesAdd);
      cart = data.cartLinesAdd.cart;
    }
    renderCart();
  }

  async function updateLine(lineId, quantity) {
    const payload = quantity > 0
      ? await storefront(
          `mutation($id: ID!, $lines: [CartLineUpdateInput!]!) { cartLinesUpdate(cartId: $id, lines: $lines) { cart { ${cartFields} } userErrors { message } } }`,
          { id: cart.id, lines: [{ id: lineId, quantity }] }
        ).then((data) => data.cartLinesUpdate)
      : await storefront(
          `mutation($id: ID!, $ids: [ID!]!) { cartLinesRemove(cartId: $id, lineIds: $ids) { cart { ${cartFields} } userErrors { message } } }`,
          { id: cart.id, ids: [lineId] }
        ).then((data) => data.cartLinesRemove);
    assertOk(payload);
    cart = payload.cart;
    renderCart();
  }

  /* ---------- Cart drawer (Nav component) ---------- */

  const cartRoot = () => $('[data-cart="root"]');

  // The cart is a native <dialog>: showModal() gives the backdrop, focus trap and Escape handling.
  // .is-active drives the slide-in through the state variables.
  let closeTimer;
  function setDrawer(open) {
    const root = cartRoot();
    if (!root) return;
    clearTimeout(closeTimer);
    if (open) {
      if (!root.open) root.showModal();
      requestAnimationFrame(() => root.classList.add(config.activeClass));
    } else {
      root.classList.remove(config.activeClass);
      closeTimer = setTimeout(() => root.open && root.close(), 400);
    }
  }

  function renderCart() {
    const quantity = cart?.totalQuantity ?? 0;
    $$('[data-cart="count"]').forEach((el) => {
      el.textContent = quantity;
      setHidden(el, quantity === 0);
    });

    const root = cartRoot();
    if (!root) return;
    $$('[data-cart="empty"]', root).forEach((el) => setHidden(el, quantity > 0));
    $$('[data-cart="filled"]', root).forEach((el) => setHidden(el, quantity === 0));

    const list = $('[data-cart="items"]', root);
    const template = list && $('[data-cart="item"]', list);
    if (list && template) {
      setHidden(template, true);
      $$('[data-cart="item"][data-clone]', list).forEach((el) => el.remove());
      (cart?.lines.nodes ?? []).forEach((line) => {
        const merchandise = line.merchandise;
        const el = template.cloneNode(true);
        setHidden(el, false);
        el.dataset.clone = "";
        fill(el, "title", merchandise.product.title);
        fill(el, "variant", merchandise.title === "Default Title" ? "" : merchandise.title);
        fill(el, "qty", line.quantity);
        fill(el, "price", formatMoney(line.cost.totalAmount));
        fillImage(el, merchandise.image || merchandise.product.featuredImage, merchandise.product.title);
        $$("[data-cart-action]", el).forEach((button) =>
          button.addEventListener("click", (event) => {
            event.preventDefault();
            const action = button.dataset.cartAction;
            const next = action === "inc" ? line.quantity + 1 : action === "dec" ? line.quantity - 1 : 0;
            withBusy(button, () => updateLine(line.id, next));
          })
        );
        list.append(el);
      });
    }

    if (cart) $$('[data-cart="subtotal"]', root).forEach((el) => (el.textContent = formatMoney(cart.cost.subtotalAmount)));
    $$('[data-cart="checkout"]', root).forEach((el) => {
      if (cart) el.href = cart.checkoutUrl;
    });
  }

  function initCartUi() {
    document.addEventListener("click", (event) => {
      if (event.target.closest('[data-cart="open"]')) { event.preventDefault(); setDrawer(true); }
      else if (event.target.closest('[data-cart="close"]')) { event.preventDefault(); setDrawer(false); }
      else if (event.target.closest('[data-cart="checkout"]') && (!cart || cart.totalQuantity === 0)) event.preventDefault();
    });
    // Escape fires the dialog's cancel event: animate out instead of closing instantly.
    cartRoot()?.addEventListener("cancel", (event) => {
      event.preventDefault();
      setDrawer(false);
    });
  }

  /* ---------- Collection grid (/shop) ---------- */

  async function initGrid() {
    const grid = $('[data-shop="grid"]');
    const template = grid && $('[data-shop="card"]', grid);
    if (!template) return;
    const productPath = grid.dataset.productPath || config.productPath;
    const collection = grid.dataset.collection; // optional Shopify collection handle

    const load = async () => {
      const data = collection
        ? await storefront(`query($h: String!) { collection(handle: $h) { products(first: 50) { nodes { ${gridFields} } } } }`, { h: collection })
        : await storefront(`{ products(first: 50) { nodes { ${gridFields} } } }`);
      return (collection ? data.collection?.products.nodes : data.products.nodes) ?? [];
    };

    const render = (products) => {
      setHidden(template, true);
      $$("[data-clone]", grid).forEach((card) => card.remove());
      products.forEach((product, index) => {
        const el = template.cloneNode(true);
        el.dataset.clone = "";
        setHidden(el, false);
        const story = parseStory(product);
        const multiple = product.variants.nodes.length > 1;
        fill(el, "title", product.title);
        fill(el, "letter-title", letterName(product.title));
        fill(el, "tagline", story.cardTagline);
        fill(el, "location", story.location);
        fill(el, "children", story.children);
        ["tagline", "location", "children"].forEach((field) =>
          $$(`[data-shop-field="${field}"]`, el).forEach((node) => setHidden(node, !node.textContent))
        );
        fill(el, "price", (multiple ? "From " : "") + formatMoney(product.priceRange.minVariantPrice));
        fillImage(el, product.featuredImage, product.title);
        // First row is likely above the fold: load it eagerly, lazy-load the rest.
        $$('[data-shop-field="image"]', el).forEach((img) => {
          img.loading = index < 3 ? "eager" : "lazy";
          if (index < 3) img.fetchPriority = "high";
        });
        if (!product.availableForSale) el.dataset.soldOut = "true";
        $$('[data-shop-field="link"]', el).forEach((link) => (link.href = `${productPath}/${encodeURIComponent(product.handle)}`));
        grid.append(el);
      });
      reveal(grid);
    };

    try { await cached(`kd_v1:grid:${collection || "all"}`, load, render); }
    finally { reveal(grid); }
  }

  /* ---------- Product page (CMS template <productPath>/<handle>; ?handle= still works on a static page) ---------- */

  // "B – Brave (Namibia)" -> "Brave"; other titles ("T-shirt", "Posters") stay as they are.
  const letterName = (title) => title.match(/^[A-Z]\s+[–-]\s+(.+?)\s*(?:\(.*\))?$/)?.[1] ?? title;

  // Shopify bodies hold: <h2>Awaken - Start your day with wonder.</h2>, then
  // <p><strong>Children:</strong> 490</p> and <p><strong>Location:</strong> South Africa</p>.
  function parseStory(product) {
    const doc = new DOMParser().parseFromString(product.descriptionHtml || "", "text/html");
    const heading = $("h1, h2, h3, h4, h5, h6", doc);
    const name = letterName(product.title);
    let tagline = heading?.textContent.replace(/\s+/g, " ").trim() ?? "";
    // Drop the "Awaken - " prefix, like the Shopify theme does.
    tagline = tagline.replace(new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[-–—]\\s*`, "i"), "");
    const meta = (label) => {
      const paragraph = $$("p", doc).find((p) => p.querySelector("strong")?.textContent.toLowerCase().startsWith(label));
      return paragraph ? paragraph.textContent.replace(/^[^:]*:\s*/, "").trim() : "";
    };
    const emphasis = $("em", doc)?.textContent.trim();
    return { doc, heading, tagline, cardTagline: emphasis || tagline, location: meta("location"), children: meta("children") };
  }

  // Lumos accordion items only work inside .accordion_list, which its script wires on DOMContentLoaded.
  // Runs synchronously so it beats that script; a no-op once the items sit in the list in the Designer.
  // Print-size pills show their fixed edition size, matching the Shopify theme's lookup.
  const editions = { "30x40cm": 3000, "50x70cm": 2000, "70x100cm": 1000, "100x150cm": 500, "150x225cm": 100 };
  const editionFor = (title) => editions[title.replace(/\s+/g, "").replace(/×/g, "x").toLowerCase()];

  // Styling that can't live in Webflow classes. Everything else (pill weights, selected-pill colour, green button
  // theme mode, button height, no hover or scale) is set on the Webflow classes and variable modes in the Designer.
  // - Size pills: the layer and its nested edition line both trim their bottom edge, which squeezes the bottom
  //   padding; keep only the edition's. Lumos' trim selector is more specific, hence !important.
  // - Add to cart loader: the dots are injected into the button component, so unused Designer classes would not
  //   be published for them; keyframes can't be defined in Designer styles either.
  const shopStyles = `
    .pdp_pill_text::after, .pdp_pill_text_alt::after { margin-bottom: 0 !important; }
    .shop_button_green .button_main_element { flex: 1; width: 100%; background-color: transparent; border-color: transparent; backdrop-filter: none; border-radius: inherit; }
    .shop_button_green .button_main_text { transition: opacity 0.2s ease; }
    .pdp_add_dots { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 0.45em; opacity: 0; transition: opacity 0.2s ease; pointer-events: none; }
    .pdp_add_dots span { width: 0.5em; height: 0.5em; border-radius: 50%; background-color: currentColor; animation: pdp-dot-jump 1.1s ease-in-out infinite; }
    .pdp_add_dots span:nth-child(2) { animation-delay: 0.14s; }
    .pdp_add_dots span:nth-child(3) { animation-delay: 0.28s; }
    [data-shop="add"][aria-busy="true"] .button_main_text { opacity: 0; }
    [data-shop="add"][aria-busy="true"] .pdp_add_dots { opacity: 1; }
    @keyframes pdp-dot-jump { 0%, 55%, 100% { transform: translateY(0); } 25% { transform: translateY(-0.3em); } }
    @media (prefers-reduced-motion: reduce) { .pdp_add_dots span { animation: none; } }`;

  // Pill layers hold the title as a text node plus an edition child, so only the text node is replaced.
  function setPillTitle(layer, title) {
    const node = [...layer.childNodes].find((child) => child.nodeType === Node.TEXT_NODE);
    node ? (node.nodeValue = title) : layer.prepend(title);
  }

  // Leading icons for the Lumos accordion titles, keyed by title. Stroke styling lives in .pdp_accordion_lead_icon.
  const iconHeart = '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>';
  const iconRuler = '<path d="M3 17 17 3l4 4L7 21z"/><path d="m7 13 2 2m1-5 2 2m1-5 2 2"/>';
  const iconTruck = '<path d="M2 6h11v10H2zM13 9h4l3 3v4h-7"/><circle cx="6" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/>';
  const iconBox = '<path d="m12 3 8 4v10l-8 4-8-4V7z"/><path d="m4 7 8 4 8-4M12 11v10"/>';
  const iconInfo = '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>';
  const iconDrop = '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>';
  const iconLeaf = '<path d="M5 19c0-8 5-14 15-14 0 10-6 15-14 15"/><path d="M5 19c3-5 6-8 10-10"/>';
  const accordionIcons = {
    "about this print": iconHeart,
    "sizes & framing": iconRuler,
    sizes: iconRuler,
    "sizes & editions": iconRuler,
    "sizing guide": iconRuler,
    shipping: iconTruck,
    delivery: iconTruck,
    "print on demand & shipping": iconTruck,
    "returns & refunds": iconBox,
    returns: iconBox,
    "product information": iconInfo,
    "care instructions": iconDrop,
    "collector benefits": iconHeart,
    "paper & print quality": iconLeaf,
  };

  function addAccordionIcons(wrap) {
    $$(".accordion_toggle_text", wrap).forEach((text) => {
      const paths = accordionIcons[text.textContent.replace(/\s+/g, " ").trim().toLowerCase()];
      if (!paths || $(".pdp_accordion_lead_icon", text)) return;
      const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      icon.setAttribute("viewBox", "0 0 24 24");
      icon.setAttribute("aria-hidden", "true");
      icon.setAttribute("class", "pdp_accordion_lead_icon");
      icon.innerHTML = paths;
      text.prepend(icon);
    });
  }

  function adoptAccordions() {
    const list = $(".pdp_accordions .accordion_list");
    if (!list) return;
    $$(".pdp_accordions .accordion_item").forEach((item) => {
      if (!list.contains(item)) list.append(item);
    });
  }

  // Description sections move into the accordion item they belong to. A section runs from its heading to the next
  // heading of the same or higher level, so sub-headings (<h3>Delivery Time</h3>) travel with it. A heading matches
  // an item by its own title ("About this print") or by an alias for the headings written in the Shopify bodies.
  // Sections without a matching item stay in the description.
  const accordionAliases = {
    "limited edition": "sizes & framing",
    "paper quality": "about this print",
    "shipping information": "shipping",
    "return policy": "returns & refunds",
  };

  // Non-letter products carry their accordion copy in the CMS ("Accordion Sections": one <h2> per item, then its
  // content). Section n fills item n and the unused items are hidden. Letters leave the field empty and keep using
  // the Shopify description (fillAccordions). A non-letter product with no sections has no accordions at all.
  const isLetter = (product) => /^[A-Z]\s+[–-]\s+/.test(product.title);

  function fillAccordionSource(wrap, product) {
    // The page renders again when fresh data replaces the cached copy, so keep the CMS copy on the wrapper.
    const source = $('[data-shop-field="accordion-source"]', wrap);
    if (source) {
      wrap.accordionHtml = source.innerHTML;
      source.remove();
    }
    const html = wrap.accordionHtml || "";
    const doc = new DOMParser().parseFromString(html, "text/html");
    const sections = [];
    $$("h2", doc).forEach((heading) => {
      const body = [];
      for (let node = heading.nextElementSibling; node && node.tagName !== "H2"; node = node.nextElementSibling) body.push(node);
      sections.push({ title: heading.textContent.replace(/\s+/g, " ").trim(), body });
    });
    if (!sections.length) {
      if (!isLetter(product)) $$(".pdp_accordions", wrap).forEach((el) => setHidden(el, true));
      return false;
    }
    $$(".accordion_component", wrap).forEach((item, index) => {
      const section = sections[index];
      setHidden(item, !section);
      if (!section) return;
      const title = $(".accordion_toggle_text", item);
      $$(".pdp_accordion_lead_icon", title).forEach((icon) => icon.remove());
      title.textContent = section.title;
      const target = $(".accordion_content_text", item);
      target.innerHTML = "";
      target.append(...section.body.map((node) => node.cloneNode(true)));
    });
    return true;
  }

  function fillAccordions(wrap, doc) {
    const normalize = (text) => text.replace(/\s+/g, " ").trim().toLowerCase();
    const level = (node) => Number(node.tagName[1]);
    const items = $$(".accordion_component", wrap);
    const filled = new Set();
    $$("h2, h3, h4, h5, h6", doc).forEach((sectionHeading) => {
      if (!doc.body.contains(sectionHeading)) return; // already moved inside a parent section
      const title = normalize(sectionHeading.textContent);
      const wanted = accordionAliases[title] ?? title;
      const item = items.find((el) => normalize($(".accordion_toggle_text", el)?.textContent ?? "") === wanted);
      const target = item && $(".accordion_content_text", item);
      if (!target) return;
      const section = [];
      for (let node = sectionHeading.nextElementSibling; node && !(/^H[1-6]$/.test(node.tagName) && level(node) <= level(sectionHeading)); node = node.nextElementSibling) section.push(node);
      // Several sections can share an item; the first one replaces the Designer placeholder copy.
      if (!filled.has(target)) target.innerHTML = "";
      filled.add(target);
      // Keep the original heading inside the item when the title differs, so the content stays labelled.
      const label = document.createElement("p");
      label.innerHTML = "<strong></strong>";
      label.firstChild.textContent = sectionHeading.textContent.trim();
      const body = section.filter((node) => !(/^H[1-6]$/.test(node.tagName) && normalize(node.textContent) === wanted));
      target.append(...[...(title === wanted ? [] : [label]), ...body].map((node) => node.cloneNode(true)));
      [sectionHeading, ...section].forEach((node) => node.remove());
    });
    // Spacer leftovers from the Shopify editor (<h2><span></span><br></h2>, <p> </p>).
    $$("h1, h2, h3, h4, h5, h6, p", doc).forEach((node) => { if (!node.textContent.trim()) node.remove(); });
  }

  function renderDescription(wrap, product) {
    const { doc, heading, tagline } = parseStory(product);
    if (heading) {
      fill(wrap, "tagline", tagline);
      heading.remove();
    }
    // No heading in the Shopify description: hide the Designer placeholder instead of showing it.
    const taglineEl = $('[data-shop-field="tagline"]', wrap);
    if (taglineEl) setHidden(taglineEl, !tagline);
    if (!fillAccordionSource(wrap, product)) {
      // Letters use the four print items; the fifth exists for products with five CMS sections.
      $$(".accordion_component", wrap).slice(4).forEach((item) => setHidden(item, true));
      fillAccordions(wrap, doc);
    }
    addAccordionIcons(wrap);
    // Children / Location meta lines (bold labels) take the accent colour.
    // Description and stats share the tagline's weight, whatever the Designer sets it to.
    const taglineWeight = getComputedStyle($('[data-shop-field="tagline"]', wrap) ?? document.body).fontWeight;
    $$("p", doc).forEach((paragraph) => {
      if (!paragraph.querySelector("strong")) return;
      paragraph.style.color = "var(--_theme---heading-accent)";
      $$("strong", paragraph).forEach((label) => (label.style.fontWeight = "inherit"));
    });
    $$('[data-shop-field="description"]', wrap).forEach((el) => {
      el.innerHTML = doc.body.innerHTML;
      el.style.fontWeight = taglineWeight;
    });
  }

  async function initProduct() {
    const wrap = $("[data-product-handle]");
    if (!wrap) return;
    document.head.append(Object.assign(document.createElement("style"), { textContent: shopStyles }));
    // ?handle= wins; the wrapper attribute is the Designer-time fallback.
    const handle = new URLSearchParams(location.search).get("handle") || wrap.dataset.productHandle;
    if (!handle) return console.warn("[shop] no product handle");

    const gallery = $('[data-shop="gallery"]', wrap);
    const galleryItem = gallery && $('[data-shop="gallery-item"]', gallery);
    const pillsWrap = $('[data-shop="variant-pills"]', wrap);
    const pillTemplate = pillsWrap && $('[data-shop="variant-pill"]', pillsWrap);
    const addButton = $('[data-shop="add"]', wrap);
    const qtyValue = $('[data-shop-field="qty"]', wrap);
    let current = null;
    let quantity = 1;

    const showVariant = () => {
      fill(wrap, "price", formatMoney(current.price));
      $$('[data-shop="variant-pill"][data-clone]', wrap).forEach((pill) =>
        pill.classList.toggle(config.activeClass, pill.dataset.variantId === current.id)
      );
      if (addButton) {
        const label = $('[data-shop-field="add-label"]', addButton);
        if (label && !addButton.dataset.label) addButton.dataset.label = label.textContent;
        if (label) label.textContent = current.availableForSale ? addButton.dataset.label : "Sold out";
        addButton.setAttribute("aria-disabled", String(!current.availableForSale));
      }
    };

    // Bound once; render() may run twice (cache, then fresh data).
    $$("[data-shop-action]", wrap).forEach((button) =>
      button.addEventListener("click", (event) => {
        event.preventDefault();
        quantity = Math.max(1, quantity + (button.dataset.shopAction === "inc" ? 1 : -1));
        if (qtyValue) qtyValue.textContent = quantity;
      })
    );

    $(".button_main_element", addButton)?.append(Object.assign(document.createElement("span"), { className: "pdp_add_dots", innerHTML: "<span></span><span></span><span></span>" }));
    addButton?.addEventListener("click", (event) => {
      event.preventDefault();
      if (!current?.availableForSale) return;
      withBusy(addButton, async () => {
        // Hold the loader briefly so a fast response doesn't flash it.
        await Promise.all([addToCart(current.id, quantity), new Promise((resolve) => setTimeout(resolve, 700))]);
        setDrawer(true);
      });
    });

    const load = async () => {
      const data = await storefront(
        `query($h: String!) { product(handle: $h) { ${productFields} descriptionHtml images(first: 10) { nodes { url altText } } } }`,
        { h: handle }
      );
      if (!data.product) console.warn("[shop] product not found:", handle);
      return data.product;
    };

    const render = (product) => {
      document.title = `${letterName(product.title)} | Kinditude`;
      fill(wrap, "letter-title", letterName(product.title));
      renderDescription(wrap, product);

      // Gallery: one item per Shopify image.
      if (galleryItem) {
        setHidden(galleryItem, true);
        $$("[data-clone]", gallery).forEach((item) => item.remove());
        product.images.nodes.forEach((image, index) => {
          const el = galleryItem.cloneNode(true);
          el.dataset.clone = "";
          setHidden(el, false);
          fillImage(el, image, product.title);
          if (index > 0) $$('[data-shop-field="image"]', el).forEach((img) => (img.loading = "lazy"));
          gallery.append(el);
        });
      }

      // Variants: pills, price and availability. A refresh keeps the shopper's selection.
      const variants = product.variants.nodes;
      const previous = current?.id;
      current = variants.find((variant) => variant.id === previous) || variants.find((variant) => variant.availableForSale) || variants[0];

      if (pillTemplate) {
        setHidden(pillTemplate, true);
        $$("[data-clone]", pillsWrap).forEach((pill) => pill.remove());
        variants.forEach((variant) => {
          const pill = pillTemplate.cloneNode(true);
          setHidden(pill, false);
          pill.dataset.clone = "";
          pill.dataset.variantId = variant.id;
          $$('[data-shop-field="title"]', pill).forEach((layer) => setPillTitle(layer, variant.title));
          const edition = editionFor(variant.title);
          fill(pill, "edition", edition ? `Limited Edition: ${edition}` : "");
          $$('[data-shop-field="edition"]', pill).forEach((node) => setHidden(node, !edition));
          if (!variant.availableForSale) pill.setAttribute("aria-disabled", "true");
          pill.addEventListener("click", (event) => {
            event.preventDefault();
            if (!variant.availableForSale) return;
            current = variant;
            showVariant();
          });
          pillsWrap.append(pill);
        });
        // A single "Default Title" variant needs no picker.
        if (variants.length === 1 && variants[0].title === "Default Title") setHidden(pillsWrap.parentElement, true);
      }

      showVariant();
      reveal(wrap);
    };

    try { await cached(`kd_v1:product:${handle}`, load, render); }
    finally { reveal(wrap); }
  }

  /* ---------- Boot ---------- */

  async function boot() {
    initCartUi();
    // Cart, grid and product page load in parallel: none of them waits on another.
    const loadCartUi = async () => {
      try { cart = await loadCart(); } catch (err) { console.error("[shop]", err); }
      renderCart();
    };
    await Promise.all([loadCartUi(), initGrid(), initProduct()]).catch((err) => console.error("[shop]", err));
  }

  adoptAccordions();
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", boot) : boot();
})();
