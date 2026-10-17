// Shopify bodies hold: <h2>Heal - tagline</h2>, the story paragraph, <p><strong>Children:</strong> 390 Children</p>,
// <p><strong>Location:</strong> Norway</p>, then print sections (LIMITED EDITION, PAPER QUALITY, ...) that
// shop.js moves into the accordions. The CMS Description keeps only the story: the tagline lives in its own
// field and the sections are accordion copy. Non-letter bodies have no sections, so they keep every paragraph.
export function trimDescription(html = "") {
  const blocks = html.replace(/<meta[^>]*>/gi, "").match(/<(h[1-6]|p|div|ul|ol|table)\b[\s\S]*?<\/\1>/gi) ?? [];
  const isHeading = (block) => /^<h[1-6]\b/i.test(block);
  const first = blocks.findIndex(isHeading);
  const body = first === -1 ? blocks : blocks.slice(first + 1);
  const next = body.findIndex(isHeading);
  return (next === -1 ? body : body.slice(0, next))
    .filter((block) => /^<p\b/i.test(block))
    .map((block) =>
      block
        .replace(/^<p\b[^>]*>/i, "<p>")
        .replace(/<\/?span\b[^>]*>/gi, "")
        .replace(/(<br\s*\/?>\s*)+<\/p>$/i, "</p>")
        .replace(/(<strong>Children:<\/strong>)\s*([\d.,]+)\s*Children\s*<\/p>/i, "$1 $2</p>")
        .replace(/&nbsp;/g, " "),
    )
    .filter((block) => block.replace(/<[^>]+>/g, "").trim())
    .join("\n");
}
