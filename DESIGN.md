---
name: Warm Street Minimal
reference: references/order.html
font: Plus Jakarta Sans (400–800) + Public Sans (400–800)
---

## Source

`references/order.html` is the visual source of truth for the customer order
surface. Layout and colors below follow the reference; typography is
intentionally bumped one step for readability (13px minimum for secondary
copy, semibold floor for body text, normal/wide tracking instead of tight).
App behavior (live menu, cart, QRIS checkout, free dine-in/takeaway switch,
`imageUrl` with gradient fallback) layers on top without changing the look.

## Font Loading (exact)

- Reference loads:
  `Plus+Jakarta+Sans:wght@400;500;600;700;800` +
  `Public+Sans:wght@400;500;600;700;800&display=swap`.
- `app/layout.tsx` loads the same weights via `next/font/google`:
  `Plus_Jakarta_Sans` + `Public_Sans`, weights
  `["400","500","600","700","800"]`, `display: "swap"`.
- Tailwind `fontFamily.display`: `["Plus Jakarta Sans", "Public Sans", "sans-serif"]`.
- Base (`app/globals.css`):
  `font-family: var(--font-jakarta), var(--font-public), "Plus Jakarta Sans", "Public Sans", sans-serif;`
  `letter-spacing: 0.011em;`
  `-webkit-tap-highlight-color: transparent;`

## Type Scale (readability bump, implemented)

Rules: 13px floor for secondary copy (`text-[13px]`); body copy semibold
floor; `tracking-normal` on headings/pills/prices (badges and uppercase
eyebrows keep `tracking-wider`/`tracking-wide`); dark surfaces keep
`text-stone-400` for secondary copy so contrast is not lost; count badges
inside fixed `h-4`/`h-5` circles stay `text-[11px]` so numerals fit.

| Element            | Classes                                                                      |
| ------------------ | ---------------------------------------------------------------------------- |
| Brand name         | `text-xs font-black uppercase tracking-wider text-[#18181B]`                 |
| Status             | `text-[13px] font-semibold text-stone-600`                                   |
| Toggle segment     | `text-[13px]` + `font-bold` active / `font-semibold` inactive                |
| Greeting title     | `text-2xl font-extrabold tracking-normal text-[#18181B]`                     |
| Greeting sub       | `text-[13px] font-semibold text-stone-600 mt-0.5`                            |
| Search input       | `text-sm font-semibold text-[#18181B] placeholder-stone-400`                 |
| Category pill      | `text-[13px] tracking-normal` + `font-bold` active / `font-semibold` inactive |
| Section title      | `text-sm font-black uppercase tracking-wider text-[#18181B]`                 |
| Section tag        | `text-[13px] font-bold text-[#FF381E] bg-[#FF381E]/10 rounded px-1.5 py-0.5`  |
| Section count      | `text-[13px] font-semibold text-stone-600`                                   |
| Card name          | `text-sm font-extrabold tracking-wide leading-snug line-clamp-1 text-[#18181B]` |
| Card desc          | `text-[13px] font-semibold tracking-wide leading-relaxed line-clamp-2 text-stone-600 mt-1` |
| Card price label   | `text-xs font-semibold tracking-wide text-stone-600 block` ("Harga")         |
| Card price         | `text-sm font-black tracking-wide text-[#18181B]`                            |
| Card badge         | `text-xs font-extrabold uppercase tracking-wider`                            |
| Spice pill         | `text-xs font-semibold text-white bg-black/60`                               |
| Sambal title       | `text-[13px] font-bold text-[#18181B]`                                       |
| Sambal sub         | `text-[13px] font-semibold text-stone-600`                                   |
| Cart meta          | `text-[13px] font-semibold uppercase tracking-wider text-stone-400`          |
| Cart total         | `text-sm font-extrabold tracking-normal text-white`                          |
| Cart CTA           | `text-[13px] font-bold text-white`                                           |
| Cart badge         | `text-[11px] font-black text-white`                                          |

Extensions (sheets, payment, success) reuse these bumped tokens:

- Sheet titles: `text-2xl font-extrabold tracking-normal text-[#18181B]`.
- Sheet subs: `text-[13px] font-semibold text-stone-600`.
- Eyebrows: `text-xs font-bold uppercase tracking-wider` /
  `text-[13px] font-bold uppercase tracking-wider`.
- Body copy: `text-[13px] font-semibold leading-relaxed text-stone-600`.
- Prices in sheets: `text-sm font-extrabold tracking-normal`.
- Buttons: `text-[13px] font-bold` / `text-sm font-bold` for full-width
  primary.

## Canvas

- Page: `bg-stone-200`, centered, `text-[#18181B]`, `antialiased`,
  `selection:bg-[#FF381E] selection:text-white`.
- Container: `max-w-[440px]`, `bg-[#FAF8F5]`, `shadow-2xl`,
  `border-x border-stone-200`, `pb-28`.

## Header (sticky)

- Wrapper: `sticky top-0 z-30`, `bg-[#FAF8F5]/90 backdrop-blur-md`,
  `px-4 pt-3 pb-2`, `border-b border-stone-200/80`.
- Brand mark: `w-8 h-8 rounded-full bg-[#18181B]`, flame icon
  `text-sm text-[#FF381E]` filled.
- Live dot: `w-1.5 h-1.5 rounded-full bg-[#FF381E] animate-pulse`.
- Status icon: emerald `schedule` at `text-[13px]` ("Buka Sekarang").
- Bell: `w-9 h-9 rounded-full bg-white border border-stone-200 shadow-xs`.

## Order Type Toggle

- Track: `mt-3 bg-stone-100 p-1 rounded-xl border border-stone-200/70`.
- Segments: `flex-1 py-1.5 text-xs rounded-lg`, icon `text-xs` + label.
- Active: `font-bold bg-white text-[#18181B] shadow-sm`, icon
  `text-[#FF381E]` filled. Inactive: `font-semibold text-stone-500`.
- Labels: "Makan di Tempat" / "Takeaway (Bungkus)".

## Search

- Input: `bg-white text-sm`, `pl-10 pr-10 py-2.5`, `rounded-xl`,
  `border border-stone-200`, `placeholder-stone-400`, `shadow-xs`,
  `focus:ring-2 focus:ring-[#FF381E] focus:border-transparent`.
- Left icon `search` at `text-lg`; right `tune` button at `text-base`.

## Category Pills

- Rail: `-mx-4 px-4 overflow-x-auto no-scrollbar`, `gap-2`, `mb-5`.
- Pills: `shrink-0 px-4 py-2 rounded-full text-xs tracking-tight`.
- Active: `bg-[#18181B] text-white font-bold shadow-sm`.
- Inactive: `bg-white text-stone-700 border border-stone-200 font-semibold`.
- Paket Hemat: `text-[#FF381E] border-red-200 bg-red-50/50 font-bold`
  ("Paket Hemat 🔥").

## Menu Cards

- Card: `bg-white rounded-2xl p-2.5 border border-stone-200/80 shadow-xs
  hover:shadow-md`, `flex flex-col justify-between`, `group`.
- Photo: `aspect-square rounded-xl overflow-hidden bg-stone-100 mb-2`;
  img `object-cover group-hover:scale-105 transition-transform duration-300`.
- Badge: `absolute top-2 left-2 px-2 py-0.5 text-[10px] font-extrabold
  uppercase rounded-full tracking-wider shadow-sm`
  (FAVORIT `#FF381E` / KENYANG `#18181B` / CRISPY `amber-500` /
  SEGER `emerald-600`).
- Spice: `absolute bottom-1.5 left-2 bg-black/60 px-1.5 py-0.5 rounded
  text-[10px] text-white` (🌶️ × level).
- Footer: `mt-3 pt-2 border-t border-stone-100`.
- Add: `w-8 h-8 rounded-full bg-[#18181B] text-white`,
  `hover:bg-[#FF381E] active:scale-95 shadow-sm`, `add` icon `text-sm`.

## Sambal Banner

- `mt-5 p-3.5 rounded-2xl bg-white border border-stone-200/90`.
- Icon chip `w-9 h-9 rounded-xl bg-red-50 text-[#FF381E]`, filled
  `restaurant` icon `text-lg`.
- Trailing `chevron_right` `text-lg text-stone-400`.

## Floating Cart Bar

- Wrapper: `fixed bottom-3 inset-x-0 mx-auto max-w-[420px] px-3 z-40`.
- Bar: `bg-[#18181B] rounded-2xl p-2.5 pl-4 shadow-2xl border border-stone-800`.
- Bag: `w-10 h-10 rounded-xl bg-stone-800/90 border border-stone-700`,
  icon `text-xl`; badge `-top-1 -right-1 w-4 h-4 bg-[#FF381E]
  text-[10px] font-black border-2 border-[#18181B]`.
- CTA: `bg-[#FF381E] hover:bg-[#e03018] text-xs font-bold py-2.5 px-4
  rounded-xl shadow-md active:scale-95` ("Lihat Pesanan" + arrow `text-sm`).

## Behavior Notes (not in reference)

- Dine-in/takeaway toggle is live; greeting, cart meta, and checkout follow it.
- `imageUrl` renders the photo; otherwise a category gradient + icon fallback.
- Spice 🌶️ level and badges derive from product data.
- Search keeps a single availability toggle; category "Paket Hemat" = popular.
