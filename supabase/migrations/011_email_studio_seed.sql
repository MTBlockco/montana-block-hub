-- Email Studio: brand kit + holiday 2026 calendar and core automated flows (all start as "planned"; nothing is approved).
insert into public.mkt_brand (id, kit) values (1, $kit${
  "name": "Montana Block Co.",
  "legal_name": "Montana Block LLC",
  "address": "7033 Niehenke Ave Unit C, Billings, MT 59101",
  "phone": "406.861.5754",
  "site": "https://mtblock.com",
  "sender_name": "Montana Block Co.",
  "logo_url": "https://mtblock.com/cdn/shop/files/MONTANA_BLOCK_CO-02.png?v=1747022409&width=600",
  "socials": {"instagram": "https://www.instagram.com/montanablockco", "facebook": "https://www.facebook.com/montanablockcompany", "youtube": "https://www.youtube.com/@MontanaBlockCo"},
  "one_liner": "Handmade end grain butcher blocks and hardwood boards, built in Billings, Montana.",
  "story": "A small crew in a 5,000 sq ft Billings shop turning solid walnut, maple and cherry into butcher blocks, cutting, carving and serving boards and magnetic knife holders. Ten straight years of growth by doing the work right. We finish everything in-house, make our own board wax, and laser-engrave in the shop.",
  "voice": ["Plain, warm, confident — a craftsman talking across the bench", "Short sentences. Specific over flowery: species, grain, dimensions, finish", "Montana-direct, a little dry humor, never cute", "Teach first, sell second"],
  "never": ["Discount codes or sitewide % off unless Mitchell writes them into the brief", "Fake scarcity, countdown hype, or invented stock counts", "Made-up reviews, quotes, awards or customer names", "Naming Montana Knife Company, retailers or any customer without Mitchell's written OK", "Featuring Bumblechutes wax (we make our own wax now)", "Hype words: amazing, epic, elevate, unleash, game-changer"],
  "pillars": [
    {"key": "craft", "name": "Built in Billings", "about": "The shop, the crew, the process: milling, glue-ups, flattening, finishing, engraving."},
    {"key": "wood", "name": "Wood school", "about": "End grain vs edge grain, walnut vs maple vs cherry, why end grain is easy on knives."},
    {"key": "gifting", "name": "Gifts that last", "about": "One board for each person on the list; engraving; bundles; gift cards."},
    {"key": "drops", "name": "Shop drops", "about": "Small-batch runs and one-off pieces announced ahead, VIPs first."},
    {"key": "care", "name": "Built for generations", "about": "Oil, wax, care routine, how a board ages; our house-made wax."}
  ],
  "personas": [
    {"key": "home_chef", "name": "The Home Chef", "wants": "A serious end grain block that stays put and spares knife edges.", "products": "The Chef / Sous Chef / Executive Chef / Colossus butcher boards"},
    {"key": "host", "name": "The Host", "wants": "Serving pieces that make the table look put-together.", "products": "Charcuterie, Lazy Susan, Rectangular, Bread Boards, The Perfect Hostess bundle"},
    {"key": "hunter", "name": "The Hunter", "wants": "A huge stable surface for breaking down game.", "products": "Big Game Board, carvers with juice grooves"},
    {"key": "knife_person", "name": "The Knife Person", "wants": "A beautiful way to store and show good knives.", "products": "Magnetic knife stands and wall rails"},
    {"key": "gift_giver", "name": "The Gift Giver", "wants": "Something personal and made in America, delivered on time.", "products": "The Montana board, engraving, bundles, gift cards"}
  ],
  "deadlines_2026": {
    "made_to_order_christmas": "Order by Nov 23 for Christmas (made-to-order butcher blocks)",
    "in_stock_christmas": "Order in-stock boards by Dec 14 for Christmas delivery",
    "local_pickup": "Local pickup in Billings through Dec 23",
    "black_friday": "Black Friday is Nov 27, Cyber Monday Nov 30"
  },
  "fonts": {"display": "Oswald (uppercase, tracked) — falls back to Arial Narrow", "accent": "Lora italic — falls back to Georgia", "body": "Helvetica/Arial in email"},
  "themes": {
    "walnut_brass": {"name": "Walnut & Brass", "bg": "#1f1813", "panel": "#2a2019", "text": "#f3e9dc", "muted": "#c4b2a0", "accent": "#d39b5c", "accent2": "#d6a85a", "button_text": "#1a120c", "dark": true},
    "maple_morning": {"name": "Maple Morning", "bg": "#f4ece0", "panel": "#ffffff", "text": "#2a1d14", "muted": "#6e5a49", "accent": "#8a5a2b", "accent2": "#c48a4a", "button_text": "#ffffff", "dark": false},
    "cherry_ember": {"name": "Cherry Ember (holiday)", "bg": "#2a1410", "panel": "#3a1d16", "text": "#f6e7da", "muted": "#d2b4a2", "accent": "#c9583a", "accent2": "#d6a85a", "button_text": "#ffffff", "dark": true},
    "big_sky": {"name": "Big Sky", "bg": "#eaf0f3", "panel": "#ffffff", "text": "#1d2a33", "muted": "#566874", "accent": "#35596b", "accent2": "#8a5a2b", "button_text": "#ffffff", "dark": false},
    "black_walnut": {"name": "Black Walnut Noir", "bg": "#0f0d0c", "panel": "#1a1715", "text": "#ece6df", "muted": "#a89c90", "accent": "#c79a62", "accent2": "#7a8f6a", "button_text": "#14100c", "dark": true}
  },
  "approved_mentions": "",
  "notes_for_writer": "Use real stock counts only when they're under 10 and helpful (e.g. 'three left in walnut'). Default sign-off: '— Mitchell and the crew at Montana Block'."
}$kit$::jsonb)
on conflict (id) do update set kit = excluded.kit;

-- Holiday 2026 campaign calendar (Mountain time) and the core automations.
insert into public.mkt_campaigns (kind, title, goal, persona, planned_at, status, brief, theme) values
 ('campaign', 'Built in Billings: meet the shop', 'Re-introduce the brand to the list before the holiday push; story of the crew and the new house-made board wax. Soft sell: best sellers.', 'all', '2026-11-17 09:15-07', 'planned', '{"pillar":"craft"}', '{"key":"walnut_brass"}'),
 ('campaign', 'Last call: made-to-order butcher blocks for Christmas', 'Real deadline: made-to-order butcher blocks must be ordered by Nov 23 for Christmas. Explain the build time honestly.', 'home_chef', '2026-11-19 10:15-07', 'planned', '{"pillar":"craft","deadline":"Nov 23"}', '{"key":"maple_morning"}'),
 ('campaign', 'The gift guide: one board for every person on your list', 'Persona-based gift guide (Home Chef, Host, Hunter, Knife Person, Gift Giver) with engraving as the personal touch.', 'gift_giver', '2026-11-21 08:45-07', 'planned', '{"pillar":"gifting"}', '{"key":"cherry_ember"}'),
 ('campaign', 'VIP early access: the Black Friday shop drop', 'Small-batch drop announced to engaged subscribers and past buyers first, 48 hours ahead. No discount; value is first pick of limited pieces. Mitchell to confirm what is in the drop.', 'all', '2026-11-25 09:15-07', 'planned', '{"pillar":"drops","needs_from_mitchell":"Which pieces and how many are in the drop"}', '{"key":"black_walnut"}'),
 ('campaign', 'Black Friday drop is live: five boards, five people', 'MKC-style persona drops: one featured piece for each persona, live Nov 27 morning. Full price, real quantities.', 'all', '2026-11-27 07:30-07', 'planned', '{"pillar":"drops"}', '{"key":"cherry_ember"}'),
 ('campaign', 'Cyber Monday: what is left from the drop + gift cards', 'Honest recap of what sold out and what is left; gift cards for the hard-to-shop-for.', 'gift_giver', '2026-11-30 09:15-07', 'planned', '{"pillar":"gifting"}', '{"key":"walnut_brass"}'),
 ('campaign', 'Make it theirs: engraving guide', 'How custom engraving works, ideas (names, ranch brands, dates, recipes), and the engraving order cutoff.', 'gift_giver', '2026-12-03 10:15-07', 'planned', '{"pillar":"gifting","needs_from_mitchell":"Engraving cutoff date"}', '{"key":"maple_morning"}'),
 ('campaign', 'Built for generations: board care 101', 'Pure value email: how to oil and wax, what not to do, featuring our house-made wax. Builds trust before the final push.', 'home_chef', '2026-12-08 10:15-07', 'planned', '{"pillar":"care"}', '{"key":"big_sky"}'),
 ('campaign', 'Order by Dec 14 for Christmas delivery', 'Real shipping cutoff for in-stock boards; show what is in stock now.', 'all', '2026-12-11 09:15-07', 'planned', '{"pillar":"gifting","deadline":"Dec 14"}', '{"key":"cherry_ember"}'),
 ('campaign', 'Too late to ship? Gift cards and Billings pickup', 'After the cutoff: digital gift cards (instant) and local pickup in Billings through Dec 23.', 'gift_giver', '2026-12-15 09:15-07', 'planned', '{"pillar":"gifting"}', '{"key":"walnut_brass"}'),
 ('campaign', 'Thank you from the shop', 'Year-end thank you, a look back at the year in the shop, no selling. Ask readers to reply with a photo of their board in use.', 'all', '2026-12-29 10:15-07', 'planned', '{"pillar":"craft"}', '{"key":"black_walnut"}'),
 ('flow', 'Welcome 1: Welcome to the shop', 'First email after signup: who we are, what makes our boards different, best sellers.', 'all', null, 'planned', '{"trigger":"Signs up","delay":"Immediately"}', '{"key":"walnut_brass"}'),
 ('flow', 'Welcome 2: End grain vs edge grain', 'Wood school: which board is right for which job.', 'home_chef', null, 'planned', '{"trigger":"Welcome","delay":"2 days"}', '{"key":"maple_morning"}'),
 ('flow', 'Welcome 3: Gifts that last + engraving', 'Gifting and engraving; social proof only if real.', 'gift_giver', null, 'planned', '{"trigger":"Welcome","delay":"5 days"}', '{"key":"walnut_brass"}'),
 ('flow', 'Abandoned cart 1: Still on the bench', 'Friendly reminder 1 hour after cart abandonment; answer common questions (shipping, care, made in Billings).', 'all', null, 'planned', '{"trigger":"Abandoned cart","delay":"1 hour"}', '{"key":"walnut_brass"}'),
 ('flow', 'Abandoned cart 2: Why end grain', 'Next-day follow up that handles objections (price vs value, longevity, care).', 'all', null, 'planned', '{"trigger":"Abandoned cart","delay":"24 hours"}', '{"key":"maple_morning"}'),
 ('flow', 'Abandoned cart 3: Last note', 'Final short note at 72 hours; no discount by default.', 'all', null, 'planned', '{"trigger":"Abandoned cart","delay":"72 hours"}', '{"key":"walnut_brass"}'),
 ('flow', 'Post-purchase 1: Thank you + first oiling', 'Thank you, what to expect, how to oil before first use.', 'all', null, 'planned', '{"trigger":"Order placed","delay":"Immediately after fulfillment"}', '{"key":"big_sky"}'),
 ('flow', 'Post-purchase 2: Care routine', 'Care routine at day 10; introduce the house-made wax.', 'all', null, 'planned', '{"trigger":"Order placed","delay":"10 days"}', '{"key":"big_sky"}'),
 ('flow', 'Post-purchase 3: Show us your board', 'Ask for a review/photo at day 21.', 'all', null, 'planned', '{"trigger":"Order placed","delay":"21 days"}', '{"key":"walnut_brass"}'),
 ('flow', 'Win-back: It''s been a while', 'For buyers with no order in 120 days: what''s new in the shop.', 'all', null, 'planned', '{"trigger":"No purchase in 120 days","delay":"—"}', '{"key":"black_walnut"}');

update public.mkt_campaigns set flow_name = regexp_replace(split_part(title, ':', 1), '\s*\d+$', ''),
  flow_step = nullif(regexp_replace(split_part(title, ':', 1), '\D', '', 'g'), '')::int
where kind = 'flow';
