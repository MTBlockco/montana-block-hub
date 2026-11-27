// Renders an email's blocks into the Montana Block house template: the same layout, colors and type as the
// Black Walnut Friday email Mitchell approved (dark charcoal, Montserrat, centered, logo, green rule, white
// headline, off-white body, tan accents, white square "Shop now" buttons). Tables + inline styles, 600px wide,
// so it holds up in Gmail, Outlook and Apple Mail. This exact HTML is what's previewed, approved and sent.

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safeUrl = (u) => /^https:\/\/(www\.)?mtblock\.com(\/|$)/i.test(String(u || "")) ? String(u) : "https://mtblock.com";
const sized = (u, w) => String(u) + (String(u).includes("?") ? "&" : "?") + "width=" + w;
const money = (n) => "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// The house template (from the Black Walnut Friday email).
const C = {
  page: "#141414", card: "#202020", headline: "#FFFFFF", text: "#F5F1EA", tan: "#C8B89F",
  link: "#BC7947", rule: "#0A8742", btnBg: "#FFFFFF", btnText: "#202020",
};
const LOGO = "https://cgu.soundestlink.com/image/newsletter/6b088b93ebdc98c5f9f92dbf";
const F = "Montserrat, Verdana, sans-serif";

// Plain text: blank line = new paragraph, single line break kept, [label](https://mtblock.com/...) links.
// Stray markdown asterisks are removed rather than shown.
function inline(text) {
  return esc(String(text ?? "").replace(/\*\*?([^*]+)\*\*?/g, "$1").replace(/\*/g, ""))
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, url) => `<a href="${esc(safeUrl(url.replace(/&amp;/g, "&")))}" target="_blank" style="color:${C.link};text-decoration:underline">${label}</a>`)
    .replace(/\n/g, "<br>");
}
const paras = (text, style) => String(text ?? "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  .map((p, i) => `<p style="margin:${i ? "14px" : "0"} 0 0;${style}">${inline(p)}</p>`).join("");

const section = (inner, pad = "12px 24px") => `<tr><td class="px" style="padding:${pad};background-color:${C.card}">${inner}</td></tr>`;
const cell = (inner, style) => `<table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%"><tr><td style="padding:12px;${style}">${inner}</td></tr></table>`;

function shopButton(url, label = "Shop now") {
  return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:${C.btnBg};border:2px solid ${C.btnText};border-collapse:separate"><tr>
    <td align="center" valign="middle"><a href="${esc(url)}" target="_blank" style="text-decoration:none;display:inline-block;width:100%;padding:16px 0;text-align:center;color:${C.btnText};font-family:${F};font-size:16px;line-height:1.2">${esc(label)}</a></td></tr></table>`;
}

function productCell(p, width) {
  if (!p) return "";
  const price = p.price_max > p.price ? `From ${money(p.price)}` : money(p.price);
  return `<table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%">
    ${p.image ? `<tr><td align="center" style="padding:12px"><a href="${esc(p.url)}" target="_blank"><img src="${esc(sized(p.image, width * 2))}" width="${width}" alt="${esc(p.title)}" class="mobile-image" style="display:block;width:${width}px;max-width:100%;height:auto;border:0"></a></td></tr>` : ""}
    <tr><td align="center" valign="top" height="72" style="height:72px;padding:12px;font-family:${F};font-size:16px;line-height:150%;color:${C.text}">${esc(p.title)}</td></tr>
    <tr><td align="center" style="padding:0 12px 12px;font-family:${F};font-size:14px;line-height:150%;color:${C.tan};font-weight:700">${price}</td></tr>
    <tr><td style="padding:12px">${shopButton(p.url)}</td></tr></table>`;
}

export function renderEmail({ subject, preheader, blocks = [], kit = {}, products = {} }) {
  const socials = kit.socials ?? {};
  const icons = ["facebook", "instagram", "youtube"].filter((k) => socials[k]).map((k) =>
    `<td style="padding:12px"><a href="${esc(socials[k])}" target="_blank"><img width="24" height="24" alt="${k}" border="0" src="https://cgu.soundestlink.com/dynamicImage/social/${k}/48/24/default" style="width:24px;height:auto;display:block"></a></td>`).join("");

  const body = blocks.map((b) => {
    switch (b.type) {
      case "hero": return section(`${b.eyebrow ? cell(esc(b.eyebrow), `text-align:center;font-family:${F};font-size:13px;letter-spacing:2px;text-transform:uppercase;color:${C.tan}`) : ""}
          ${cell(`<strong>${esc(b.headline)}</strong>`, `text-align:center;font-family:${F};font-size:36px;line-height:125%;color:${C.headline}`)}
          ${b.sub ? cell(paras(b.sub, "text-align:center"), `font-family:${F};font-size:14px;line-height:150%;color:${C.text}`) : ""}`);
      case "heading": return section(cell(`<strong>${esc(b.text)}</strong>`, `text-align:center;font-family:${F};font-size:24px;line-height:125%;color:${C.text}`));
      case "text": return section(cell(paras(b.text, "text-align:center"), `font-family:${F};font-size:14px;line-height:150%;color:${C.text}`));
      case "callout": return section(cell(`<strong><em>${inline(b.text)}</em></strong>`, `text-align:center;font-family:${F};font-size:28px;line-height:1.2;color:${C.tan}`));
      case "steps": return section(cell((b.items ?? []).map((it, i) => `<p style="margin:${i ? "12px" : "0"} 0 0;text-align:center"><strong style="color:${C.tan}">${i + 1}.</strong> ${inline(it)}</p>`).join(""), `font-family:${F};font-size:14px;line-height:150%;color:${C.text}`));
      case "product": {
        const p = products[b.handle];
        return p ? section(`<table role="presentation" border="0" cellspacing="0" cellpadding="0" width="300" align="center" class="mobile-table"><tr><td>${productCell(p, 276)}</td></tr></table>
          ${b.blurb ? cell(paras(b.blurb, "text-align:center"), `font-family:${F};font-size:14px;line-height:150%;color:${C.text}`) : ""}`) : "";
      }
      case "products": {
        const list = (b.handles ?? []).map((h) => products[h]).filter(Boolean);
        let rows = "";
        for (let i = 0; i < list.length; i += 2) rows += `<tr><td class="stack-column" valign="top" width="276" style="width:276px">${productCell(list[i], 252)}</td><td class="stack-column" valign="top" width="276" style="width:276px">${list[i + 1] ? productCell(list[i + 1], 252) : ""}</td></tr>`;
        return section(`<table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%">${rows}</table>`, "24px");
      }
      case "button": return section(cell(`<a href="${esc(safeUrl(b.url))}" target="_blank" style="color:${C.link};text-decoration:none"><strong>${esc(String(b.label || "Shop now").toUpperCase())} &rarr;</strong></a>`, `text-align:center;font-family:${F};font-size:20px;line-height:125%`));
      case "quote": return section(cell(`<em>&ldquo;${esc(b.text)}&rdquo;</em>${b.cite ? `<br><span style="font-size:13px;color:${C.tan}">&mdash; ${esc(b.cite)}</span>` : ""}`, `text-align:center;font-family:${F};font-size:16px;line-height:150%;color:${C.text}`));
      case "divider": return section(`<table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%"><tr><td style="padding:6px 12px"><table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%"><tr><td style="font-size:0;line-height:0;border-top:1px dashed #000000">&nbsp;</td></tr></table></td></tr></table>`);
      case "note": return section(cell(paras(b.text, "text-align:center"), `font-family:${F};font-size:13px;line-height:150%;color:${C.tan}`));
      case "signoff": return section(cell(inline(b.text), `text-align:center;font-family:${F};font-size:14px;line-height:150%;color:${C.text}`), "12px 24px 24px");
      default: return "";
    }
  }).join("\n");

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="x-apple-disable-message-reformatting"><meta name="format-detection" content="telephone=no">
<title>${esc(subject)}</title>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;700&display=swap" rel="stylesheet">
<style>
  html,body{margin:0!important;padding:0!important;width:100%!important;-webkit-text-size-adjust:none} table{border-collapse:collapse} img{border:0;-ms-interpolation-mode:bicubic}
  a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important}
  @media screen and (max-width:600px){ .wrap{width:100%!important} .px{padding-left:12px!important;padding-right:12px!important} .mobile-table{width:100%!important} .mobile-image{width:100%!important;height:auto!important} }
  @media screen and (max-width:480px){ .stack-column{display:block!important;width:100%!important} }
</style>
</head>
<body style="margin:0;padding:0;background-color:${C.page}">
<div style="display:none;font-size:0;line-height:0;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">${esc(preheader)}${"&#847; &zwnj; ".repeat(60)}</div>
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:${C.page}"><tr><td align="center">
<table role="presentation" class="wrap" width="600" border="0" cellpadding="0" cellspacing="0" style="width:600px;margin:0 auto;background-color:${C.card}">
  <tr><td align="center" style="padding:36px 24px 12px;background-color:${C.card}"><a href="https://mtblock.com" target="_blank"><img src="${LOGO}" width="247" alt="Montana Block Co." style="display:block;width:247px;max-width:80%;height:auto;margin:0 auto;border:0"></a></td></tr>
  <tr><td style="padding:12px 36px 0;background-color:${C.card}"><table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%"><tr><td style="font-size:0;line-height:0;border-top:4px solid ${C.rule}">&nbsp;</td></tr></table></td></tr>
  ${body}
  <tr><td class="px" style="padding:24px 36px;background-color:${C.card}">
    ${icons ? `<table role="presentation" border="0" cellspacing="0" cellpadding="0"><tr>${icons}</tr></table>` : ""}
    <div style="padding:12px;font-family:${F};font-size:12px;line-height:150%;color:#FFFFFF">
      <p style="margin:0">&copy; ${esc(kit.legal_name || "Montana Block")}</p><br>
      <p style="margin:0">${esc(kit.address || "")}${kit.phone ? ` &middot; ${esc(kit.phone)}` : ""}</p><br>
      <p style="margin:0">You're getting this email because you subscribed on our site or bought from us.</p><br>
      <p style="margin:0"><a href="[[unsubscribe_link]]" target="_blank" style="color:${C.tan}">Unsubscribe</a></p>
    </div>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}
