---
name: Calm Minimal Order
source: components/order/*
font: Poppins (400–500 in order UI; 400–800 loaded)
accent: "#FDBD2C" (hover "#ECA90F", dark text on accent)
---

## Source

`components/order/*` is the visual source of truth for the customer order
surface. Routes (`app/order/page.tsx`, `app/order/[accessToken]/page.tsx`,
`app/order/t/[tableToken]/page.tsx`) all render `OrderExperience`;
`tableToken` is an optional prop that preselects "Dine in".

## Principles

- Soft canvas (`#FAFAFA`), lots of whitespace (`px-5`, section gaps `mt-6`–`mt-10`).
- Borderless order cards; dividers (`divide-neutral-100`) instead of boxes
  on the customer surface. Raised surfaces (POS/admin panels, dialogs,
  QR cards, notices) are white (`bg-white`) with `shadow-soft`.
- `font-medium` is the ceiling — no bold/extrabold/black in order UI.
- One accent (`#FDBD2C`), used sparingly: solid on primary CTAs only,
  soft tint for selections, nothing else.
- Icons: Home, ReceiptText, X, Plus, Minus, ArrowLeft only.
- Motion: small fades/rises only (`ord-*`), press shrink on tap, no hovers
  that lift, no emoji ornament.

## Font Loading

- `app/layout.tsx` loads Poppins via `next/font/google`:
  weights `["400","500","600","700","800"]`, `display: "swap"`,
  CSS variable `--font-sans`.
- Base (`app/globals.css`): `font-family: var(--font-sans), "Poppins",
  sans-serif;` `letter-spacing: 0.011em;` antialiased,
  `-webkit-tap-highlight-color: transparent;`
- Order UI uses `font-medium` (500) for emphasis, `font-normal` (400) for
  everything else. Prices/counts always `tabular-nums`. `tracking-tight`
  on titles only.

## Color Tokens

| Token     | Value       | Usage                                              |
| --------- | ----------- | -------------------------------------------------- |
| Canvas    | `#FAFAFA`   | Page, container, header/nav chrome (`bg-[#FAFAFA]`, `/90`, `/95` with blur) |
| Card      | `white`     | Raised surfaces: POS/admin panels, dialogs, sheets, QR cards, notice cards (`bg-white` + `shadow-soft`) |
| Text      | `neutral-900` | Titles, names, active states, values              |
| Secondary | `neutral-500` | Sub copy, prices on cards, inactive segments      |
| Meta      | `neutral-400` | Counts, hints, footnotes, inactive tab icons      |
| Surface   | `neutral-100` | Toggle track, category field, inactive pills, notes |
| Divider   | `neutral-100` | `divide-neutral-100`, hairline borders            |
| Accent    | `#FDBD2C`   | Primary CTA bg (with `neutral-900` text)           |
| Accent +  | `#ECA90F`   | CTA hover                                          |
| Accent ~  | `#FDBD2C/15–20` | Selected pill bg (with `neutral-900` text)     |
| Ring      | `#FDBD2C/50` | Category/note focus ring (with `bg-white`)       |

Dark surfaces (`bg-neutral-900`): qty-plus buttons, cart count badge,
toast, "Pesan lagi" button. Selection:
`selection:bg-[#FDBD2C] selection:text-neutral-900`.

## Elevation

- `.shadow-soft` (`app/globals.css`): `0 8px 24px rgba(24, 24, 27, 0.06)`
  on white (`bg-white`) cards so they float above the `#FAFAFA` canvas.
  Used for: POS metric/order/cashier/report panels, menu-manager list,
  login + error/notice cards, sheets (`ord-sheet`), QR cards.
- `.shadow-sheet`: `0 -12px 32px rgba(24, 24, 27, 0.1)` on bottom sheets.
- Customer order cards stay borderless (no border, no shadow) — dividers
  only. The accent dot/shadow glow variants are not used.

## Type Scale

| Element        | Classes                                                        |
| -------------- | -------------------------------------------------------------- |
| Page title     | `text-[22px] font-medium tracking-tight` (+ `leading-snug`)    |
| Page sub       | `text-[13px] text-neutral-500 mt-1`                            |
| Section label  | `text-sm font-medium`                                          |
| List label     | `text-xs text-neutral-400`                                     |
| Item name      | `text-[13px] font-medium` (`truncate`)                         |
| Item meta      | `text-xs text-neutral-400` (`truncate`)                        |
| Item price     | `text-[13px] tabular-nums text-neutral-500`                    |
| Total value    | `text-[15px] font-medium tabular-nums`                         |
| Sheet title    | `text-lg font-medium tracking-tight`                           |
| Payment amount | `text-3xl font-medium tabular-nums tracking-tight`             |
| Button         | `text-sm font-medium` (`h-12 rounded-full`)                    |
| Tab label      | `text-[11px]` + `font-medium` active / `font-normal` inactive  |
| Badge          | `text-[10–11px] font-medium tabular-nums`                      |

## Canvas

- Page: `bg-[#FAFAFA]`, centered, `text-neutral-900`, `antialiased`.
- Container: `max-w-[440px]`, `bg-[#FAFAFA]`, `px-5`, `pb-36` (room for tabs).
- POS/admin/login pages use the same `#FAFAFA` canvas
  (`--paper: #fafafa`, `themeColor: "#fafafa"`); white (`bg-white`)
  is reserved for raised cards, sheets, dialogs, and QR panels.
- Scrollbars hidden globally (`scrollbar-width: none`,
  `*::-webkit-scrollbar { display: none; }`); scrolling still works.

## Header (sticky)

- Wrapper: `sticky top-0 z-30`, `bg-[#FAFAFA]/90 backdrop-blur-md`,
  `px-5 pb-3 pt-4`, `border-b border-neutral-100`.
- Logo: `/logo.png` (transparent), centered (`justify-center`),
  `h-11 w-auto max-w-[240px] object-contain`; text fallback
  `text-[15px] font-semibold tracking-tight` if the file fails to load.
- Table label: `absolute right-0 text-xs text-neutral-400` (does not shift
  the centered logo).

## Order Type Toggle

- Track: `mt-3 flex rounded-full bg-neutral-100 p-1` (no border, no icons).
- Segments: `flex-1 rounded-full py-1.5 text-center text-[13px] transition`.
- Active: `bg-white font-medium shadow-xs`. Inactive: `text-neutral-500`.
- Labels: "Dine in" / "Takeaway".

## Category Dropdown

- Field: `mt-6 h-12 w-full rounded-2xl bg-neutral-100 px-4 text-[13px]` with a
  visually hidden label, a right-aligned CSS chevron, themed option menu, and
  the standard accent focus ring.
- Categories: "Semua Menu", "Sate Taichan", "Rice Bowl",
  "Gorengan & Kulit", "Minuman Segar", "Paket Hemat" (= `popular` flag).

## Menu Grid

- Section row: `mt-8 flex items-baseline justify-between` —
  `h2.text-sm.font-medium` + count `text-xs text-neutral-400`.
- Grid: `mt-4 grid grid-cols-2 gap-x-3 gap-y-7`.
- Loading: 4 borderless `SkeletonCard`s; empty: `EmptyState`
  (`py-14 text-center`, title `text-sm font-medium`, hint
  `mt-1 text-[13px] text-neutral-500`).

## Product Card (borderless)

- Wrapper: `flex min-w-0 flex-col` (no border, no shadow).
- Photo: `aspect-square w-full rounded-2xl bg-neutral-100 overflow-hidden`;
  real `imageUrl` or initial-letter fallback
  (`text-lg font-medium text-neutral-400`). Unavailable: `opacity-60`.
- Only badge: "Habis" pill `absolute left-2 top-2 rounded-full
  bg-white/90 px-2 py-0.5 text-[11px] font-medium text-neutral-500
  backdrop-blur`. No promo/spice/emoji badges.
- Name: `truncate text-[13px] font-medium leading-snug`
  (descriptions live in the sheet, not the card).
- Price: `mt-0.5 text-[13px] tabular-nums text-neutral-500`.
- Add: `h-7 w-7 rounded-full border border-neutral-200`,
  `Plus` 13, `active:scale-95`, `disabled:opacity-30`.
  Products with options open the sheet instead of quick-add.

## Bottom Tabs (only nav)

- Bar: `fixed inset-x-0 bottom-0 z-40`, inner
  `mx-auto max-w-[440px] border-t border-neutral-100 bg-[#FAFAFA]/95
  backdrop-blur-md` + safe-area padding. No floating cart pill.
- Tabs: `flex-1 flex-col items-center gap-1 py-2.5`; icons 20px
  (`strokeWidth` 2 active / 1.6 inactive); labels `text-[11px]`.
- Active: `text-neutral-900` + `font-medium`. Inactive:
  `text-neutral-400` + `font-normal`.
- Tabs: `Home` (`Home` icon) / `Orders` (`ReceiptText` icon).
- Cart badge on Orders icon: `absolute -right-2 -top-1.5 h-4 min-w-4
  rounded-full bg-neutral-900 px-1 text-[10px] font-medium tabular-nums
  text-white` (neutral, not accent).

## Orders Tab

- Title `Pesanan` (`text-[22px] font-medium tracking-tight`) + context
  sub (`tableLabel · Dine in` / `Takeaway · Ambil di kasir`).
- Empty state links back to Home.
- Cart label: `mt-7 text-xs text-neutral-400` ("Keranjang · N item").
- Cart rows: `divide-y divide-neutral-100`, `py-3.5 flex gap-3`;
  name `truncate text-[13px] font-medium`; modifiers
  `truncate text-xs text-neutral-400` ("variant · addons" or "Original",
  note in quotes); line price `text-[13px] tabular-nums text-neutral-500`.
- `QtyStepper`: minus `h-7 w-7 rounded-full border border-neutral-200
  text-neutral-500` (`Minus` 13); count `w-4 text-[13px] font-medium
  tabular-nums`; plus `h-7 w-7 rounded-full bg-neutral-900 text-white`
  (`Plus` 13).
- Total row: `flex items-baseline justify-between` — label
  `text-[13px] text-neutral-500`, value `text-[15px] font-medium
  tabular-nums`.
- History: label `text-xs text-neutral-400` ("Riwayat"), rows
  `divide-y divide-neutral-100 py-3.5`: number `text-[13px] font-medium`,
  meta `mt-0.5 text-xs text-neutral-400`, amount
  `text-[13px] tabular-nums text-neutral-500`.
- "Pesan lagi": `mt-8 h-12 rounded-full bg-neutral-900 text-sm
  font-medium text-white` (neutral — only checkout CTAs use accent).

## Buttons

- Primary CTA: `h-12 w-full rounded-full bg-[#FDBD2C] text-sm
  font-medium text-neutral-900 hover:bg-[#ECA90F]
  active:scale-[0.98] disabled:opacity-40/60`.
  Used for: Bayar, Tambah, Saya sudah bayar, Buat pembayaran baru,
  Lihat pesanan. This is the ONLY solid accent usage.
- Quiet secondary: `h-12 w-full rounded-full text-sm text-neutral-500`
  ("Kembali ke beranda").
- Errors: centered `text-[13px] text-neutral-500` (no red box).
- Footnote: centered `text-xs text-neutral-400` ("Bayar via QRIS").

## Product Sheet

- Backdrop: `fixed inset-0 z-50 bg-neutral-900/30` (`ord-backdrop`).
- Panel: `max-h-[92vh] max-w-[440px] overflow-y-auto rounded-t-[28px]
  bg-white` (`ord-sheet`). Grabber: `mx-auto h-1 w-9 rounded-full
  bg-neutral-200`.
- Photo: `aspect-[16/10] w-full rounded-2xl`. Close: `absolute
  right-3 top-3 h-8 w-8 rounded-full bg-white/90 text-neutral-500`
  (`X` 15, blur).
- Title `text-lg font-medium tracking-tight`; price `mt-0.5 text-sm
  tabular-nums text-neutral-500`; desc `mt-2 text-[13px] leading-relaxed
  text-neutral-500`.
- Groups `space-y-7`; label `mb-3 text-[13px] font-medium`, hint
  `font-normal text-neutral-400` (" · opsional").
- Option pills `flex flex-wrap gap-2`: `rounded-full px-3.5 py-2
  text-[13px]`; active `bg-[#FDBD2C]/20 font-medium text-neutral-900`;
  inactive `bg-neutral-100 text-neutral-500`. No step numbers, no hints
  per pill (Lontong keeps "· +2rb" suffix).
- Addons: `divide-y divide-neutral-100` rows `py-3`; name `text-[13px]`
  (`font-medium` active / `text-neutral-600` inactive); right side price
  `text-[13px] tabular-nums text-neutral-400` + dot `h-5 w-5
  rounded-full border` (active `border-[#FDBD2C] bg-[#FDBD2C]
  text-neutral-900` with `Plus` 11; inactive `border-neutral-200`).
- Note: label `text-[13px] font-medium` + hint; textarea `rounded-2xl
  bg-neutral-100 px-4 py-3 text-sm placeholder:text-neutral-400`,
  `focus:bg-white focus:ring-2 focus:ring-[#FDBD2C]/50`.
- Footer: `sticky bottom-0 -mx-5 border-t border-neutral-100
  bg-[#FAFAFA]/95 backdrop-blur` + safe-area; qty minus `h-10 w-10
  rounded-full border border-neutral-200`, count `w-5 text-sm
  font-medium tabular-nums`, plus `h-10 w-10 rounded-full
  bg-neutral-900 text-white`; CTA `h-12 flex-1 rounded-full` accent.

## Payment View

- Shell: `max-w-[440px] px-5 pb-10 pt-[safe-area]`; back `mb-8 flex
  gap-2 text-[13px] text-neutral-500` (`ArrowLeft` 15, "Kembali").
- Meta `text-xs text-neutral-400` (order no. · table/takeaway); amount
  `mt-3 text-3xl font-medium tabular-nums tracking-tight`; timer
  `mt-1 text-[13px] text-neutral-400`.
- QR card: `mx-auto mt-8 w-fit rounded-3xl border border-neutral-100
  bg-white shadow-soft p-4`; code `220×220 rounded-2xl`; expired state is plain centered text.
- Hint `mt-6 text-[13px] text-neutral-400` ("Scan dengan e-wallet apa pun").
- CTA block `mx-auto mt-8 max-w-[280px] space-y-3` (accent primary);
  status `text-xs text-neutral-400`. No step grid, no colored panels.
- Polls `/api/customer/payments/[id]` every 7s with the session token;
  back keeps the cart and drops the stale QR (retry mints a fresh order).

## Success View

- Centered column `justify-center px-5 py-10`; eyebrow `text-[13px]
  text-neutral-400` ("Pembayaran berhasil"); title `mt-2 text-[22px]
  font-medium tracking-tight`; sub `mt-2 text-[13px] leading-relaxed
  text-neutral-500`. No success icon/medallion.
- Receipt: `mx-auto mt-8 max-w-[320px] divide-y divide-neutral-100
  border-y border-neutral-100 text-left`; rows `py-3.5`; labels
  `text-[13px] text-neutral-400`; values `text-[13px] font-medium`
  (total `tabular-nums`).
- Actions `mx-auto mt-8 max-w-[320px] space-y-2.5`: accent primary
  ("Lihat pesanan") + quiet secondary ("Kembali ke beranda").

## Toast

- `fixed inset-x-0 bottom-24 z-50 flex justify-center px-5`
  (above the tab bar); pill `rounded-full bg-neutral-900 px-4 py-2
  text-[13px] text-white` (`ord-toast`); auto-dismiss 2200ms.
  Text only, no icon.

## Motion

- `ord-rise` (8px, 0.3s) on tab switches and payment/success entrances;
  `ord-sheet-in` (24px, 0.28s) on the product sheet;
  `ord-backdrop-in` (0.2s); `ord-toast-in` (6px, 0.2s);
  `ord-shimmer` for skeletons.
- Press feedback: `active:scale-95` (icon buttons), `active:scale-[0.98]`
  (full-width buttons). No hover lifts, no staggered entrances.
- `prefers-reduced-motion: reduce` disables all `ord-*` animation.

## Behavior Notes (not visual)

- Menu loads from `/api/menu` with local fallback; loading caps at 2.5s.
- Modifier pricing: each addon +5000, Lontong +2000.
- Checkout posts `idempotencyKey` (fresh UUID), `sessionToken`,
  `orderType`, `tableToken`, and item lines to `/api/checkout`.
- Paid orders append to in-session history (`PlacedOrder`: number,
  amount, type, table, time); history clears on reload — not persisted.
- "Paket Hemat" category = `product.popular` flag.
- `badgeFor` returns only the "Habis" sold-out pill; no promo badges.
