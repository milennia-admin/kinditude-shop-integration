#!/usr/bin/env node
/*
 * Mirrors Shopify products into the Webflow "Shop Products" CMS collection so each product
 * gets a real URL (/shop-products/<handle>) with its own title, description and Open Graph tags.
 * Prices, stock, variants and the cart still come live from Shopify via shop.js.
 *
 *   WEBFLOW_TOKEN=... node webflow-shop/sync-cms.mjs            # dry run, prints the plan
 *   WEBFLOW_TOKEN=... node webflow-shop/sync-cms.mjs --apply    # create/update items and publish them
 *   ... --apply --prune                                         # also delete items no longer in Shopify
 *
 * WEBFLOW_TOKEN: Webflow site token with CMS read + write. Never commit it. Needs Node 18+.
 * The public Storefront domain, token and API version are read from shop.js so they live in one place.
 */
import { readFileSync } from "node:fs";
import { trimDescription } from "./description.mjs";

const accordions = JSON.parse(readFileSync(new URL("./accordions.json", import.meta.url), "utf8")); // handle -> "<h2>Title</h2>content..."
const COLLECTION_ID = "6ad361fb0a7acebcc9a86c55"; // Shop Products
const WEBFLOW = "https://api.webflow.com/v2";

const shopSource = readFileSync(new URL("./shop.js", import.meta.url), "utf8");
const fromConfig = (key) => shopSource.match(new RegExp(`${key}:\\s*"([^"]+)"`))?.[1];
const SHOPIFY = { domain: fromConfig("domain"), token: fromConfig("token"), apiVersion: fromConfig("apiVersion") };
if (!SHOPIFY.domain || !SHOPIFY.token || !SHOPIFY.apiVersion) throw new Error("Could not read the Shopify config from shop.js");

const apply = process.argv.includes("--apply");
const prune = process.argv.includes("--prune");
const webflowToken = process.env.WEBFLOW_TOKEN;
if (!webflowToken) {
  console.error("Set WEBFLOW_TOKEN (Webflow site token with CMS read + write).");
  process.exit(1);
}

async function shopify(query) {
  const res = await fetch(`https://${SHOPIFY.domain}/api/${SHOPIFY.apiVersion}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Storefront-Access-Token": SHOPIFY.token },
    body: JSON.stringify({ query }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error("Shopify: " + JSON.stringify(json.errors || res.status));
  return json.data;
}

async function webflow(path, options = {}) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(WEBFLOW + path, {
      ...options,
      headers: { Authorization: `Bearer ${webflowToken}`, "Content-Type": "application/json", accept: "application/json" },
    });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, (Number(res.headers.get("retry-after")) || 5) * 1000));
      continue;
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Webflow ${options.method || "GET"} ${path}: ${res.status} ${JSON.stringify(body)}`);
    return body;
  }
  throw new Error("Webflow: rate limited too many times");
}

// Same format as shop.js: symbol first, comma decimals (€120,00).
const formatPrice = ({ amount, currencyCode }) => {
  const symbol = new Intl.NumberFormat("en", { style: "currency", currency: currencyCode, currencyDisplay: "narrowSymbol" })
    .formatToParts(0).find((p) => p.type === "currency").value;
  return symbol + new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(amount));
};

const decodeEntities = (text) =>
  text.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&amp;/g, "&");
const stripTags = (html) => decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

// "B – Brave (Namibia)" -> "Brave". Empty for non-letter products.
const letterName = (title) => title.match(/^[A-Z]\s+[–-]\s+([^(]+?)\s*(?:\(|$)/)?.[1] || "";

function toFieldData(product, index) {
  const html = product.descriptionHtml || "";
  const displayTitle = letterName(product.title) || product.title;
  // "Awaken - Start your day with wonder." -> "Start your day with wonder." (same as shop.js)
  const esc = displayTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tagline = stripTags(html.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i)?.[1] || "").replace(new RegExp(`^\\s*${esc}\\s*[-–—]\\s*`, "i"), "");
  const images = product.images.nodes;
  const price = product.priceRange.minVariantPrice;
  const multiple = product.variants.nodes.length > 1;
  return {
    name: product.title,
    slug: product.handle,
    "shopify-handle": product.handle,
    "shopify-product-id": product.id,
    letter: displayTitle, // "Display Title" in the CMS: heading on the product page
    tagline,
    description: trimDescription(html), // story only: tagline and accordion sections live elsewhere
    "seo-description": (product.seo?.description || stripTags(html)).slice(0, 300),
    "price-label": (multiple ? "From " : "") + formatPrice(price),
    currency: price.currencyCode,
    "price-amount": Number(price.amount).toFixed(2), // plain number for the Product JSON-LD in the template head
    availability: `https://schema.org/${product.availableForSale ? "InStock" : "OutOfStock"}`,
    available: product.availableForSale,
    ...(images[0] && { "main-image": { url: images[0].url, alt: images[0].altText || product.title } }),
    gallery: images.map((img) => ({ url: img.url, alt: img.altText || product.title })),
    "sort-order": index,
    // Non-letter products only. Letters leave it empty: shop.js builds their accordions from the Shopify description.
    ...(accordions[product.handle] && { "accordion-sections": accordions[product.handle] }),
  };
}

// Webflow re-hosts images, so compare those by count only.
const comparable = (fd) => ({
  name: fd.name, tagline: fd.tagline, letter: fd.letter, description: (fd.description || "").trim(),
  "seo-description": fd["seo-description"], "price-label": fd["price-label"], currency: fd.currency,
  available: !!fd.available, "price-amount": fd["price-amount"], availability: fd.availability, "sort-order": fd["sort-order"], "shopify-product-id": fd["shopify-product-id"],
  gallery: fd.gallery?.length || 0,
  accordions: stripTags(fd["accordion-sections"] || ""),
});
const same = (a, b) => JSON.stringify(comparable(a)) === JSON.stringify(comparable(b));

async function listWebflowItems() {
  const items = [];
  for (let offset = 0; ; offset += 100) {
    const page = await webflow(`/collections/${COLLECTION_ID}/items?limit=100&offset=${offset}`);
    items.push(...page.items);
    if (items.length >= page.pagination.total) return items;
  }
}

const products = (await shopify(`{ products(first: 100) { nodes {
  id handle title descriptionHtml availableForSale seo { description }
  priceRange { minVariantPrice { amount currencyCode } }
  variants(first: 2) { nodes { id } }
  images(first: 10) { nodes { url altText } }
} } }`)).products.nodes;

const existing = new Map((await listWebflowItems()).map((item) => [item.fieldData.slug, item]));
const wanted = products.map(toFieldData);

const toCreate = wanted.filter((fd) => !existing.has(fd.slug));
const toUpdate = wanted.filter((fd) => existing.has(fd.slug) && !same(existing.get(fd.slug).fieldData, fd));
const toRemove = [...existing.values()].filter((item) => !wanted.some((fd) => fd.slug === item.fieldData.slug));

console.log(`Shopify products: ${products.length}`);
console.log(`  create: ${toCreate.map((fd) => fd.slug).join(", ") || "-"}`);
console.log(`  update: ${toUpdate.map((fd) => fd.slug).join(", ") || "-"}`);
console.log(`  not in Shopify anymore: ${toRemove.map((i) => i.fieldData.slug).join(", ") || "-"}${prune ? " (will be deleted)" : " (kept, pass --prune to delete)"}`);

if (!apply) {
  console.log("\nDry run. Re-run with --apply to write to Webflow.");
  process.exit(0);
}

const toPublish = [];

for (const fd of toCreate) {
  const item = await webflow(`/collections/${COLLECTION_ID}/items`, {
    method: "POST",
    body: JSON.stringify({ isArchived: false, isDraft: false, fieldData: fd }),
  });
  toPublish.push(item.id);
  console.log("created", fd.slug);
}

for (const fd of toUpdate) {
  const id = existing.get(fd.slug).id;
  await webflow(`/collections/${COLLECTION_ID}/items/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ isArchived: false, isDraft: false, fieldData: fd }),
  });
  toPublish.push(id);
  console.log("updated", fd.slug);
}

if (prune) {
  for (const item of toRemove) {
    await webflow(`/collections/${COLLECTION_ID}/items/${item.id}`, { method: "DELETE" });
    console.log("deleted", item.fieldData.slug);
  }
}

if (toPublish.length) {
  await webflow(`/collections/${COLLECTION_ID}/items/publish`, { method: "POST", body: JSON.stringify({ itemIds: toPublish }) });
  console.log(`published ${toPublish.length} item(s)`);
}
console.log("Done.");
