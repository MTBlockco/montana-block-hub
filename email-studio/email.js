// Renders an email's blocks into email-client-safe HTML (tables + inline styles, 600px, works in Gmail/Outlook/Apple Mail).
// The same HTML is what Mitchell previews, what gets approved, and what the email service sends.

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safeUrl = (u) => /^https:\/\/(www\.)?mtblock\.com(\/|$)/i.test(String(u || "")) ? String(u) : "https://mtblock.com";
const sized = (u, w) => String(u) + (String(u).includes("?") ? "&" : "?") + "width=" + w;
const money = (n) => "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 });

// **bold**, *italic*, [link](https://mtblock.com/...), blank-line paragraphs
function inline(text, t, linkColor) {
  return esc(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, url) => `<a href="${esc(safeUrl(url.replace(/&amp;/g, "&")))}" style="color:${linkColor};text-decoration:underline">${label}</a>`)
    .replace(/\n/g, "<br>");
}

const FONT_BODY = "Helvetica, Arial, sans-serif";
const FONT_DISPLAY = "'Oswald', 'Arial Narrow', 'Helvetica Neue', Arial, sans-serif";
const FONT_SERIF = "'Lora', Georgia, 'Times New Roman', serif";

function button(label, url, t) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:6px auto"><tr>
    <td align="center" bgcolor="${t.accent}" style="border-radius:6px">
      <a href="${esc(safeUrl(url))}" target="_blank" style="display:inline-block;padding:14px 30px;font-family:${FONT_DISPLAY};font-size:16px;letter-spacing:2px;text-transform:uppercase;color:${t.button_text};text-decoration:none;font-weight:600;border-radius:6px">${esc(label)}</a>
    </td></tr></table>`;
}

function productCard(p, blurb, t) {
  if (!p) return "";
  const price = p.price_max > p.price ? `From ${money(p.price)}` : money(p.price);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${t.panel};border-radius:10px">
    <tr><td style="padding:0">${p.image ? `<a href="${esc(p.url)}" target="_blank"><img src="${esc(sized(p.image, 1080))}" width="536" alt="${esc(p.title)}" style="display:block;width:100%;max-width:536px;height:auto;border-radius:10px 10px 0 0;border:0"></a>` : ""}</td></tr>
    <tr><td style="padding:18px 20px 22px">
      <div style="font-family:${FONT_DISPLAY};font-size:20px;letter-spacing:1px;text-transform:uppercase;color:${t.text};line-height:1.25">${esc(p.title)}</div>
      <div style="font-family:${FONT_BODY};font-size:15px;color:${t.accent2};margin:6px 0 10px;font-weight:bold">${price}</div>
      ${blurb ? `<div style="font-family:${FONT_BODY};font-size:15px;line-height:1.6;color:${t.muted};margin:0 0 14px">${inline(blurb, t, t.accent)}</div>` : ""}
      <a href="${esc(p.url)}" target="_blank" style="font-family:${FONT_DISPLAY};font-size:14px;letter-spacing:2px;text-transform:uppercase;color:${t.accent};text-decoration:none;font-weight:600">See it in the shop &rarr;</a>
    </td></tr></table>`;
}

function productGrid(list, t) {
  const cells = list.filter(Boolean).map((p) => `<td class="stack" width="50%" valign="top" style="padding:6px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${t.panel};border-radius:10px"><tr><td>
      ${p.image ? `<a href="${esc(p.url)}" target="_blank"><img src="${esc(sized(p.image, 600))}" width="256" alt="${esc(p.title)}" style="display:block;width:100%;height:auto;border-radius:10px 10px 0 0;border:0"></a>` : ""}
      </td></tr><tr><td style="padding:12px 14px 16px">
      <div style="font-family:${FONT_DISPLAY};font-size:15px;letter-spacing:1px;text-transform:uppercase;color:${t.text};line-height:1.3">${esc(p.title)}</div>
      <div style="font-family:${FONT_BODY};font-size:14px;color:${t.accent2};margin:4px 0 8px;font-weight:bold">${p.price_max > p.price ? "From " : ""}${money(p.price)}</div>
      <a href="${esc(p.url)}" target="_blank" style="font-family:${FONT_DISPLAY};font-size:13px;letter-spacing:2px;text-transform:uppercase;color:${t.accent};text-decoration:none">Shop &rarr;</a>
      </td></tr></table></td>`);
  let rows = "";
  for (let i = 0; i < cells.length; i += 2) rows += `<tr>${cells[i]}${cells[i + 1] ?? `<td class="stack" width="50%"></td>`}</tr>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>`;
}

export function renderEmail({ subject, preheader, blocks = [], theme, kit, heroUrl, heroAlt, products = {} }) {
  const t = theme;
  const pad = (inner, extra = "") => `<tr><td style="padding:0 32px ${extra}" class="px">${inner}</td></tr>`;
  const body = blocks.map((b) => {
    switch (b.type) {
      case "hero": return `${heroUrl ? `<tr><td style="padding:0"><img src="${esc(heroUrl)}" width="600" alt="${esc(heroAlt || [b.eyebrow, b.headline, b.sub].filter(Boolean).join(" — "))}" style="display:block;width:100%;max-width:600px;height:auto;border:0"></td></tr>`
        : `<tr><td style="padding:44px 32px 8px;text-align:center" class="px">
            ${b.eyebrow ? `<div style="font-family:${FONT_DISPLAY};font-size:13px;letter-spacing:4px;text-transform:uppercase;color:${t.accent2}">${esc(b.eyebrow)}</div>` : ""}
            <div style="font-family:${FONT_DISPLAY};font-size:38px;line-height:1.1;letter-spacing:1px;text-transform:uppercase;color:${t.text};margin:10px 0">${esc(b.headline)}</div></td></tr>`}
        ${b.sub ? pad(`<div style="font-family:${FONT_SERIF};font-style:italic;font-size:19px;line-height:1.5;color:${t.accent2};text-align:center;padding-top:26px">${esc(b.sub)}</div>`) : ""}`;
      case "heading": return pad(`<div style="font-family:${FONT_DISPLAY};font-size:24px;line-height:1.2;letter-spacing:1px;text-transform:uppercase;color:${t.text};padding-top:28px">${esc(b.text)}</div>`);
      case "text": return pad(String(b.text ?? "").split(/\n\s*\n/).map((para) => `<p style="font-family:${FONT_BODY};font-size:16px;line-height:1.65;color:${t.text};margin:16px 0 0">${inline(para.trim(), t, t.accent)}</p>`).join(""));
      case "product": return pad(`<div style="padding-top:24px">${productCard(products[b.handle], b.blurb, t)}</div>`);
      case "products": return `<tr><td style="padding:18px 26px 0" class="px2">${productGrid((b.handles ?? []).map((h) => products[h]), t)}</td></tr>`;
      case "quote": return pad(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px"><tr><td style="border-left:3px solid ${t.accent2};padding:6px 0 6px 18px">
          <div style="font-family:${FONT_SERIF};font-style:italic;font-size:19px;line-height:1.5;color:${t.text}">&ldquo;${esc(b.text)}&rdquo;</div>
          ${b.cite ? `<div style="font-family:${FONT_BODY};font-size:13px;color:${t.muted};margin-top:8px">&mdash; ${esc(b.cite)}</div>` : ""}</td></tr></table>`);
      case "button": return pad(`<div style="padding-top:26px">${button(b.label || "Shop now", b.url, t)}</div>`);
      case "steps": return pad(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:18px">${(b.items ?? []).map((it, i) => `<tr>
          <td width="40" valign="top" style="padding:8px 0"><div style="width:30px;height:30px;line-height:30px;border-radius:15px;background:${t.accent};color:${t.button_text};text-align:center;font-family:${FONT_DISPLAY};font-size:15px">${i + 1}</div></td>
          <td valign="top" style="padding:12px 0 8px;font-family:${FONT_BODY};font-size:16px;line-height:1.5;color:${t.text}">${inline(it, t, t.accent)}</td></tr>`).join("")}</table>`);
      case "divider": return pad(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:30px"><tr><td style="border-top:1px solid ${t.accent2};font-size:0;line-height:0;opacity:.6">&nbsp;</td></tr></table>`);
      case "note": return pad(`<div style="font-family:${FONT_BODY};font-size:13px;line-height:1.55;color:${t.muted};margin-top:20px;padding:12px 14px;border:1px dashed ${t.accent2};border-radius:8px">${inline(b.text, t, t.accent)}</div>`);
      case "signoff": return pad(`<div style="font-family:${FONT_SERIF};font-style:italic;font-size:17px;line-height:1.5;color:${t.accent2};margin-top:28px">${inline(b.text, t, t.accent)}</div>`);
      default: return "";
    }
  }).join("\n");

  const socials = Object.entries(kit.socials ?? {}).map(([k, u]) => `<a href="${esc(u)}" target="_blank" style="color:${t.muted};text-decoration:underline">${esc({ youtube: "YouTube", instagram: "Instagram", facebook: "Facebook" }[k] ?? k)}</a>`).join(" &nbsp;&middot;&nbsp; ");
  const header = "#261811";

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="${t.dark ? "dark" : "light"}"><meta name="supported-color-schemes" content="light dark">
<title>${esc(subject)}</title>
<link href="https://fonts.googleapis.com/css2?family=Lora:ital@1&family=Oswald:wght@500;600&display=swap" rel="stylesheet">
<style>
  body{margin:0;padding:0;background:${t.bg}} img{border:0;outline:none;text-decoration:none}
  a{color:${t.accent}} table{border-collapse:collapse}
  @media (max-width:620px){ .wrap{width:100%!important} .px{padding-left:20px!important;padding-right:20px!important} .px2{padding-left:14px!important;padding-right:14px!important} .stack{display:block!important;width:100%!important} }
</style>
</head>
<body style="margin:0;padding:0;background:${t.bg}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${esc(preheader)}${"&#8199;&#65279;&#847; ".repeat(40)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${t.bg}"><tr><td align="center" style="padding:24px 10px">
<table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:${t.bg}">
  <tr><td align="center" bgcolor="${header}" style="background:${header};padding:22px 20px;border-radius:12px 12px 0 0">
    <a href="https://mtblock.com" target="_blank"><img src="${esc(kit.logo_url)}" width="220" alt="Montana Block Co." style="display:block;width:220px;max-width:70%;height:auto;margin:0 auto;border:0"></a>
  </td></tr>
  ${body}
  <tr><td style="padding:40px 32px 10px" class="px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid ${t.panel};font-size:0;line-height:0">&nbsp;</td></tr></table></td></tr>
  <tr><td align="center" style="padding:6px 32px 34px;font-family:${FONT_BODY};font-size:12px;line-height:1.7;color:${t.muted}" class="px">
    <div style="font-family:${FONT_DISPLAY};font-size:13px;letter-spacing:3px;text-transform:uppercase;color:${t.accent2};margin-bottom:6px">Handmade in Billings, Montana</div>
    ${socials ? `<div style="margin-bottom:8px">${socials}</div>` : ""}
    ${esc(kit.legal_name || kit.name)} &middot; ${esc(kit.address)}${kit.phone ? ` &middot; ${esc(kit.phone)}` : ""}<br>
    You're getting this because you signed up or ordered at mtblock.com.<br>
    <a href="[[unsubscribe_link]]" style="color:${t.muted};text-decoration:underline">Unsubscribe</a>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}
