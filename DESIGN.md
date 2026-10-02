---
name: Calm Warm Minimal
source: components/order/*
font: Poppins (400–500 in order UI; 400–800 loaded)
accent: "#FDBD2C" (hover "#ECA90F", dark text on accent)
gray: warm stone derived from accent (canvas "#FAF7F1", ink "#1C1917")
depth: layered soft (hairline warm border + 2-level shadow + top highlight)
---

## Source

`components/order/*` is the visual source of truth for the customer order
surface. Routes (`app/order/page.tsx`, `app/order/[accessToken]/page.tsx`,
`app/order/t/[tableToken]/page.tsx`) all render `OrderExperience`;
`tableToken` is an optional prop that preselects "Dine in".

## Principles

- Warm soft canvas (`#FAF7F1`), lots of whitespace (`px-5`, section gaps `mt-6`–`mt-10`).
- Borderless order cards; warm dividers (`divide-[#E9E1D1]`) instead of boxes
  on the customer surface. Raised surfaces (POS/admin panels, dialogs,
  QR cards, notices) are warm white (`#FFFEFB`) with hairline warm border
  (`border-[#EFE7D6]`) + layered soft shadow (see Elevation).
- `font-medium` is the ceiling — no bold/extrabold/black in order UI.
- One accent (`#FDBD2C`), used sparingly: solid on primary CTAs only,
  soft tint for selections, nothing else. Grays inherit warmth from the
  accent (stone family) so yellow never feels pasted on cool gray.
- Icons: Home, ReceiptText, X, Plus, Minus, ArrowLeft only on the
  customer surface. POS additionally allows Search, BookOpen, TrendingUp,
  Download, RefreshCw for staff speed, plus warm ornaments (see Icon
  Ornaments) in empties, metrics, and closed cards only.
- Touch + feedback: key targets min 44px (`h-11`/`h-12`), press shrink
  on every tap (`active:scale`), sticky filter/search blocks on long
  lists, skeleton + toast for every async wait — never a dead blank.
- Depth, not decoration: 2-level shadows + 1px warm border + subtle top
  highlight on cards. No gradients, no glow except the primary CTA ambient
  (optional). Motion: small fades/rises only (`ord-*`), press shrink on
  tap, no hovers that lift, no emoji ornament.

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

## Color Tokens (warm stone, derived from `#FDBD2C`)

| Token     | Value       | Usage                                              |
| --------- | ----------- | -------------------------------------------------- |
| Canvas    | `#FAF7F1`   | Page, container, header/nav chrome (`bg-[#FAF7F1]`, `/90`, `/95` with blur) |
| Card      | `#FFFEFB`   | Raised surfaces: POS/admin panels, dialogs, sheets, QR cards, notice cards (`bg-[#FFFEFB]` + `border-[#EFE7D6]` + `shadow-soft`) |
| Text      | `#1C1917`   | Titles, names, active states, values (`text-[#1C1917]`, Tailwind `stone-900` equivalent) |
| Secondary | `#78716C`   | Sub copy, prices on cards, inactive segments (`stone-500`) |
| Meta      | `#A8A29E`   | Counts, hints, footnotes, inactive tab icons (`stone-400`) |
| Surface   | `#F3EFE6`   | Toggle track, category field, inactive pills, notes |
| Surface 2 | `#EDE8DB`   | Pressed / hover fill on warm surfaces (pills, icon buttons) |
| Divider   | `#E9E1D1`   | `divide-[#E9E1D1]`, hairline borders (`border-[#EFE7D6]` on cards) |
| Accent    | `#FDBD2C`   | Primary CTA bg (with `#1C1917` text)               |
| Accent +  | `#ECA90F`   | CTA hover                                          |
| Accent ~  | `#FDBD2C/15–20` | Selected pill bg (with `#1C1917` text)         |
| Ring      | `#FDBD2C/50` | Category/note focus ring (with `bg-[#FFFEFB]`)   |

Dark surfaces (`bg-[#1C1917]`): qty-plus buttons, cart count badge,
toast, "Pesan lagi" button. Selection:
`selection:bg-[#FDBD2C] selection:text-[#1C1917]`.

Migration note (cool → warm): `neutral-900/500/400/100` →
`#1C1917` / `#78716C` / `#A8A29E` / `#F3EFE6`. `bg-white` on raised
surfaces → `bg-[#FFFEFB]` + `border-[#EFE7D6]`. Canvas
`#FAFAFA` → `#FAF7F1` (see `--paper`, `themeColor`).

## Elevation (layered soft)

- `.shadow-soft` (`app/globals.css`): `0 1px 2px rgba(28, 25, 23, 0.05), 0 8px 24px rgba(28, 25, 23, 0.06)`
  on warm-white (`bg-[#FFFEFB]`) cards so they float above the `#FAF7F1` canvas.
  Used for: POS metric/order/cashier/report panels, menu-manager list,
  login + error/notice cards, sheets (`ord-sheet`), QR cards.
- `.shadow-sheet`: `0 -1px 0 rgba(255, 255, 255, 0.6) inset, 0 -12px 32px rgba(28, 25, 23, 0.12)` on bottom sheets.
- Card recipe (raised): `bg-[#FFFEFB] border border-[#EFE7D6] shadow-soft`
  + subtle top highlight via `shadow-soft` inset layer. One level only —
  no nested cards with shadows; inner rows use dividers.
- Primary CTA ambient (optional): `shadow-[0_6px_16px_rgba(253,189,44,0.35)]`
  on the single accent CTA per view. Never on pills, badges, or dots.
- Customer order cards stay borderless (no border, no shadow) — warm
  dividers only. The accent dot/shadow glow variants are not used.

## Icon Ornaments (warm thin, POS only)

- Placement (only): empty states, metric cards, `CashierClosedCard`,
  `Shift berjalan` hero. Never on queue/order rows, pills, badges,
  nav tabs, or buttons — rows stay text-only for scan speed.
- Style: Lucide `strokeWidth 1.6`, `16–20px`, muted `#A8A29E`, inside
  a warm circle `h-10 w-10 rounded-full bg-[#F3EFE6]`. One ornament per
  card, top-left or centered with the empty copy. No solid chips, no
  accent fills, no emoji.
- Allowed set: `Wallet` (bersih/cash), `ClipboardList` (aktif/queue),
  `Hourglass` (menunggu), `Store` (kasir tutup/buka), `ChefHat`
  (diproses/dapur), `History` (riwayat/lunas), `Package` (menu/stok),
  `ChartNoAxesColumn` (laporan), `QrCode` (QRIS), `Banknote` (tunai),
  `ReceiptText` (rekap/invoice), `ShoppingBag` (keranjang). Reuse,
  don't invent per screen.
- Metrics: ornament sits above the label (`mb-2`), label stays
  `xs #A8A29E`, value `22px medium tabular`. Closed card: ornament
  above title. Empty: centered ornament + `sm medium` title +
  `13px` hint + quiet/inline CTA.
- A11y: ornaments are `aria-hidden="true"` always; meaning comes from
  the adjacent text label, never the icon alone.

## Type Scale

| Element        | Classes                                                        |
| -------------- | -------------------------------------------------------------- |
| Page title     | `text-[22px] font-medium tracking-tight` (+ `leading-snug`)    |
| Page sub       | `text-[13px] text-[#78716C] mt-1`                            |
| Section label  | `text-sm font-medium`                                          |
| List label     | `text-xs text-[#A8A29E]`                                     |
| Item name      | `text-[13px] font-medium` (`truncate`)                         |
| Item meta      | `text-xs text-[#A8A29E]` (`truncate`)                        |
| Item price     | `text-[13px] tabular-nums text-[#78716C]`                    |
| Total value    | `text-[15px] font-medium tabular-nums`                         |
| Sheet title    | `text-lg font-medium tracking-tight`                           |
| Payment amount | `text-3xl font-medium tabular-nums tracking-tight`             |
| Button         | `text-sm font-medium` (`h-12 rounded-full`)                    |
| Tab label      | `text-[11px]` + `font-medium` active / `font-normal` inactive  |
| Badge          | `text-[10–11px] font-medium tabular-nums`                      |

## Canvas

- Page: `bg-[#FAF7F1]`, centered, `text-[#1C1917]`, `antialiased`.
- Container: `max-w-[440px]`, `bg-[#FAF7F1]`, `px-5`, `pb-36` (room for tabs).
- POS/admin/login pages use the same `#FAF7F1` canvas
  (`--paper: #faf7f1`, `themeColor: "#faf7f1"`); warm white (`bg-[#FFFEFB]`)
  is reserved for raised cards, sheets, dialogs, and QR panels.
- Scrollbars hidden globally (`scrollbar-width: none`,
  `*::-webkit-scrollbar { display: none; }`); scrolling still works.

## Header (sticky)

- Wrapper: `sticky top-0 z-30`, `bg-[#FAF7F1]/90 backdrop-blur-md`,
  `px-5 pb-3 pt-4`, `border-b border-[#E9E1D1]`.
- Logo: `/logo.png` (transparent), centered (`justify-center`),
  `h-11 w-auto max-w-[240px] object-contain`; text fallback
  `text-[15px] font-semibold tracking-tight` if the file fails to load.
- Table label: `absolute right-0 text-xs text-[#A8A29E]` (does not shift
  the centered logo).

## Order Type Toggle

- Track: `mt-3 flex rounded-full bg-[#F3EFE6] p-1` (no border, no icons).
- Segments: `flex-1 rounded-full py-1.5 text-center text-[13px] transition`.
- Active: `bg-[#FFFEFB] font-medium shadow-xs border border-[#EFE7D6]`. Inactive: `text-[#78716C]`.
- Labels: "Dine in" / "Takeaway".

## Category Dropdown

- Field: `mt-6 h-12 w-full rounded-2xl bg-[#F3EFE6] px-4 text-[13px]` with a
  visually hidden label, a right-aligned CSS chevron, themed option menu, and
  the standard accent focus ring.
- Categories: "Semua Menu", "Sate Taichan", "Rice Bowl",
  "Gorengan & Kulit", "Minuman Segar", "Paket Hemat" (= `popular` flag).

## Menu Grid

- Section row: `mt-8 flex items-baseline justify-between` —
  `h2.text-sm.font-medium` + count `text-xs text-[#A8A29E]`.
- Grid: `mt-4 grid grid-cols-2 gap-x-3 gap-y-7`.
- Loading: 4 borderless `SkeletonCard`s; empty: `EmptyState`
  (`py-14 text-center`, title `text-sm font-medium`, hint
  `mt-1 text-[13px] text-[#78716C]`).

## Product Card (borderless)

- Wrapper: `flex min-w-0 flex-col` (no border, no shadow).
- Photo: `aspect-square w-full rounded-2xl bg-[#F3EFE6] overflow-hidden`;
  real `imageUrl` or initial-letter fallback
  (`text-lg font-medium text-[#A8A29E]`). Unavailable: `opacity-60`.
- Only badge: "Habis" pill `absolute left-2 top-2 rounded-full
  bg-[#FFFEFB]/90 px-2 py-0.5 text-[11px] font-medium text-[#78716C]
  backdrop-blur`. No promo/spice/emoji badges.
- Name: `truncate text-[13px] font-medium leading-snug`
  (descriptions live in the sheet, not the card).
- Price: `mt-0.5 text-[13px] tabular-nums text-[#78716C]`.
- Add: `h-7 w-7 rounded-full border border-[#E5DCC8]`,
  `Plus` 13, `active:scale-95`, `disabled:opacity-30`.
  Products with options open the sheet instead of quick-add.

## Bottom Tabs (only nav)

- Bar: `fixed inset-x-0 bottom-0 z-40`, inner
  `mx-auto max-w-[440px] border-t border-[#EFE7D6] bg-[#FAF7F1]/95
  backdrop-blur-md` + safe-area padding. No floating cart pill.
- Tabs: `flex-1 flex-col items-center gap-1 py-2.5`; icons 20px
  (`strokeWidth` 2 active / 1.6 inactive); labels `text-[11px]`.
- Active: `text-[#1C1917]` + `font-medium`. Inactive:
  `text-[#A8A29E]` + `font-normal`.
- Tabs: `Home` (`Home` icon) / `Orders` (`ReceiptText` icon).
- Cart badge on Orders icon: `absolute -right-2 -top-1.5 h-4 min-w-4
  rounded-full bg-[#1C1917] px-1 text-[10px] font-medium tabular-nums
  text-white` (neutral, not accent).

## Orders Tab

- Title `Pesanan` (`text-[22px] font-medium tracking-tight`) + context
  sub (`tableLabel · Dine in` / `Takeaway · Ambil di kasir`).
- Empty state links back to Home.
- Cart label: `mt-7 text-xs text-[#A8A29E]` ("Keranjang · N item").
- Cart rows: `divide-y divide-[#E9E1D1]`, `py-3.5 flex gap-3`;
  name `truncate text-[13px] font-medium`; modifiers
  `truncate text-xs text-[#A8A29E]` ("variant · addons" or "Original",
  note in quotes); line price `text-[13px] tabular-nums text-[#78716C]`.
- `QtyStepper`: minus `h-7 w-7 rounded-full border border-[#E5DCC8]
  text-[#78716C]` (`Minus` 13); count `w-4 text-[13px] font-medium
  tabular-nums`; plus `h-7 w-7 rounded-full bg-[#1C1917] text-white`
  (`Plus` 13).
- Total row: `flex items-baseline justify-between` — label
  `text-[13px] text-[#78716C]`, value `text-[15px] font-medium
  tabular-nums`.
- History: label `text-xs text-[#A8A29E]` ("Riwayat"), rows
  `divide-y divide-[#E9E1D1] py-3.5`: number `text-[13px] font-medium`,
  meta `mt-0.5 text-xs text-[#A8A29E]`, amount
  `text-[13px] tabular-nums text-[#78716C]`.
- "Pesan lagi": `mt-8 h-12 rounded-full bg-[#1C1917] text-sm
  font-medium text-white` (neutral — only checkout CTAs use accent).

## Buttons

- Primary CTA: `h-12 w-full rounded-full bg-[#FDBD2C] text-sm
  font-medium text-[#1C1917] hover:bg-[#ECA90F]
  active:scale-[0.98] disabled:opacity-40/60`.
  Used for: Bayar, Tambah, Saya sudah bayar, Buat pembayaran baru,
  Lihat pesanan. This is the ONLY solid accent usage.
- Quiet secondary: `h-12 w-full rounded-full text-sm text-[#78716C]`
  ("Kembali ke beranda").
- Errors: centered `text-[13px] text-[#78716C]` (no red box).
- Footnote: centered `text-xs text-[#A8A29E]` ("Bayar via QRIS").

## Product Sheet

- Backdrop: `fixed inset-0 z-50 bg-[#1C1917]/30` (`ord-backdrop`).
- Panel: `max-h-[92vh] max-w-[440px] overflow-y-auto rounded-t-[28px]
  bg-[#FFFEFB]` (`ord-sheet`). Grabber: `mx-auto h-1 w-9 rounded-full
  bg-[#E5DCC8]`.
- Photo: `aspect-[16/10] w-full rounded-2xl`. Close: `absolute
  right-3 top-3 h-8 w-8 rounded-full bg-[#FFFEFB]/90 text-[#78716C]`
  (`X` 15, blur).
- Title `text-lg font-medium tracking-tight`; price `mt-0.5 text-sm
  tabular-nums text-[#78716C]`; desc `mt-2 text-[13px] leading-relaxed
  text-[#78716C]`.
- Groups `space-y-7`; label `mb-3 text-[13px] font-medium`, hint
  `font-normal text-[#A8A29E]` (" · opsional").
- Option pills `flex flex-wrap gap-2`: `rounded-full px-3.5 py-2
  text-[13px]`; active `bg-[#FDBD2C]/20 font-medium text-[#1C1917]`;
  inactive `bg-[#F3EFE6] text-[#78716C]`. No step numbers, no hints
  per pill (Lontong keeps "· +2rb" suffix).
- Addons: `divide-y divide-[#E9E1D1]` rows `py-3`; name `text-[13px]`
  (`font-medium` active / `text-[#57534E]` inactive); right side price
  `text-[13px] tabular-nums text-[#A8A29E]` + dot `h-5 w-5
  rounded-full border` (active `border-[#FDBD2C] bg-[#FDBD2C]
  text-[#1C1917]` with `Plus` 11; inactive `border-[#E5DCC8]`).
- Note: label `text-[13px] font-medium` + hint; textarea `rounded-2xl
  bg-[#F3EFE6] px-4 py-3 text-sm placeholder:text-[#A8A29E]`,
  `focus:bg-[#FFFEFB] focus:ring-2 focus:ring-[#FDBD2C]/50`.
- Footer: `sticky bottom-0 -mx-5 border-t border-[#EFE7D6]
  bg-[#FAF7F1]/95 backdrop-blur` + safe-area; qty minus `h-10 w-10
  rounded-full border border-[#E5DCC8]`, count `w-5 text-sm
  font-medium tabular-nums`, plus `h-10 w-10 rounded-full
  bg-[#1C1917] text-white`; CTA `h-12 flex-1 rounded-full` accent.

## Payment View

- Shell: `max-w-[440px] px-5 pb-10 pt-[safe-area]`; back `mb-8 flex
  gap-2 text-[13px] text-[#78716C]` (`ArrowLeft` 15, "Kembali").
- Meta `text-xs text-[#A8A29E]` (order no. · table/takeaway); amount
  `mt-3 text-3xl font-medium tabular-nums tracking-tight`; timer
  `mt-1 text-[13px] text-[#A8A29E]`.
- QR card: `mx-auto mt-8 w-fit rounded-3xl border border-[#EFE7D6]
  bg-[#FFFEFB] shadow-soft p-4`; code `220×220 rounded-2xl`; expired state is plain centered text.
- Hint `mt-6 text-[13px] text-[#A8A29E]` ("Scan dengan e-wallet apa pun").
- CTA block `mx-auto mt-8 max-w-[280px] space-y-3` (accent primary);
  status `text-xs text-[#A8A29E]`. No step grid, no colored panels.
- Polls `/api/customer/payments/[id]` every 7s with the session token;
  back keeps the cart and drops the stale QR (retry mints a fresh order).

## Success View

- Centered column `justify-center px-5 py-10`; eyebrow `text-[13px]
  text-[#A8A29E]` ("Pembayaran berhasil"); title `mt-2 text-[22px]
  font-medium tracking-tight`; sub `mt-2 text-[13px] leading-relaxed
  text-[#78716C]`. No success icon/medallion.
- Receipt: `mx-auto mt-8 max-w-[320px] divide-y divide-[#E9E1D1]
  border-y border-[#EFE7D6] text-left`; rows `py-3.5`; labels
  `text-[13px] text-[#A8A29E]`; values `text-[13px] font-medium`
  (total `tabular-nums`).
- Actions `mx-auto mt-8 max-w-[320px] space-y-2.5`: accent primary
  ("Lihat pesanan") + quiet secondary ("Kembali ke beranda").

## Toast

- `fixed inset-x-0 bottom-24 z-50 flex justify-center px-5`
  (above the tab bar); pill `rounded-full bg-[#1C1917] px-4 py-2
  text-[13px] text-white` (`ord-toast`); auto-dismiss 2200ms.
  Text only, no icon. POS shares the same toast and timing.

## Motion

- `ord-rise` (8px, 0.3s) on tab switches and payment/success entrances;
  `ord-sheet-in` (24px, 0.28s) on the product sheet;
  `ord-backdrop-in` (0.2s); `ord-toast-in` (6px, 0.2s);
  `ord-shimmer` for skeletons.
- Press feedback: `active:scale-95` (icon buttons), `active:scale-[0.98]`
  (full-width buttons). No hover lifts, no staggered entrances.
- `prefers-reduced-motion: reduce` disables all `ord-*` animation.

## POS Workspace (`/pos`, phone-first)

`components/pos-workspace-live.tsx` (+ `pos-confirm-sheet.tsx`,
`menu-manager.tsx`) follows the same tokens, type scale, and motion,
with staff-speed exceptions noted here. Desktop keeps the same cards
in wider grids (`lg:`) plus a `266px` sidebar.

- Mobile headers: `text-[22px] font-medium tracking-tight` + `13px
  #78716C` sub, compact `h-11` accent `Pesanan baru` CTA
  (compact header exception vs customer `h-12` primary). Kasir hides
  the CTA while active; sub shows `N aktif · date`.
- Metrics: `grid-cols-2 gap-2.5` compact cards (`min-h-[108px] p-4`,
  `sm:p-5`, `lg:min-h-0`) using the shared `Metric` type
  (`xs #A8A29E / 22px medium tabular / 13px #78716C`).
- Search: `h-12 rounded-2xl bg-[#F3EFE6] text-[13px]` with `Search`
  16 + clear `X`, `focus:bg-[#FFFEFB] focus:ring-2
  focus:ring-[#FDBD2C]/50` (POS icon exception).
- Filter/pill rows: `h-11 rounded-full text-[13px]` (Kasir categories
  `min-h-[44px] px-3.5 py-2`); active `bg-[#FDBD2C]/20 font-medium`, inactive
  `bg-[#F3EFE6] text-[#78716C]`, `aria-pressed`, counts
  `tabular-nums`.
- Dropdowns (`.select` in `globals.css`): inherit `.input` fill
  (`#F3EFE6`, `rounded-2xl`, accent focus ring) with `appearance:
  none` + right-aligned CSS chevron (`12×8 #A8A29E`). Used for
  Menu editor category + Kasir table select. All POS dialogs render
  via `createPortal(..., document.body)` so `fixed` positioning is
  never trapped by the `ord-rise` transform ancestor.
- Loading: `ListSkeleton` rows (`ord-skeleton` bars + pill) instead
  of plain text. Empty: `EmptyBlock` (`py-8`, centered warm ornament +
  `sm medium` title + `13px text-[#78716C]` hint, slim inline with CTA).
  Errors: warm white card
  (`rounded-2xl border-[#EFE7D6] bg-[#FFFEFB] shadow-soft px-4 py-3
  text-[13px] text-[#78716C]`) + dark `h-9 Muat ulang`.
- ConfirmSheet (`pos-confirm-sheet.tsx`): replaces all native
  `window.confirm` (cancel order, clear cart, archive menu, download
  PDF). Backdrop `fixed inset-0 z-[70] bg-[#1C1917]/30`
  (`ord-backdrop`); panel `max-w-[440px] rounded-t-[28px] bg-[#FFFEFB]
  border-[#EFE7D6] p-5` (`ord-sheet`) + grabber; title `15px font-medium
  tracking-tight`, desc `13px text-[#78716C]`; accent `h-12` confirm +
  quiet `h-12 Batal`. Focus trap + ESC via `use-dialog-focus`.

### POS Beranda

- Admin: Penjualan bersih + Pesanan aktif. Operator: Pesanan aktif +
  Menunggu bayar.
- `Perlu tindakan` warm white card (`p-4 sm:p-5 border-[#EFE7D6] shadow-soft`): accent dot +
  `sm medium` + count pill (`bg-[#F3EFE6] text-xs tabular`);
  metrics carry warm ornaments (`Wallet` bersih, `ClipboardList` aktif,
  `Hourglass` menunggu);
  mobile shows 3 queue rows + `Lihat N lainnya` (slim `py-5` empty with
  `ClipboardList` ornament + inline `h-11` CTA);
  desktop (`lg:grid-cols-[minmax(0,1fr)_360px]`) 5 with
  Terima/Mulai/Siap/Selesaikan (`h-11`, accent; `Menunggu` warm surface
  when Pending).
- `Terlaris hari ini` borderless warm `divide-y` (empty: slim inline
  with `ChartNoAxesColumn` ornament); `Tutup kasir` / `Rekap harian`
  warm white cards with `ReceiptText` ornament + dark `bg-[#1C1917] h-11
  w-full sm:w-auto Unduh PDF` routed through ConfirmSheet.

### POS Pesanan

- Closed: guided `CashierClosedCard` on top (warm card + `h-12` accent
  `Buka kasir`); list stays read-only — advance buttons become quiet
  `Lihat` (`bg-[#F3EFE6]`), detail stays openable, no status changes.
- Summary card: `Selesai hari ini` (`22px medium tabular`) + `N
  aktif perlu tindakan` (`13px tabular text-[#78716C]`).
- Search + filters in one sticky block (`sticky top-0 bg-[#FAF7F1]/95
  backdrop-blur`, static on `lg:`); mobile `h-10` pills, `mt-3`.
- List: slim rows in ONE warm card (`rounded-2xl border-[#EFE7D6]
  bg-[#FFFEFB] px-4`, rows `border-b border-[#E9E1D1] py-3
  last:border-b-0`): number `13px medium`, meta `xs
  text-[#A8A29E]`, total `13px tabular text-[#78716C]`, status pill
  `text-[11px] px-3 py-1.5` (active tint `bg-[#FDBD2C]/20`,
  done `bg-[#F3EFE6]`). No per-order cards on mobile.
- OrderDetail dialog: panel `max-w-[440px]` phone
  (`lg:max-w-[560px]` desktop), `max-h-[94dvh] rounded-t-[28px]`
  + grabber; status pill `text-[11px]`; title `lg medium
  tracking-tight`; date `13px text-[#78716C]`; chips `bg-[#F3EFE6]`;
  items warm `divide-y py-3.5`; total `13px / 15px medium tabular`;
  footer `bg-[#FAF7F1]/95` with accent `h-12` primary + quiet `h-11
  text-[13px]` (`Cek pembayaran / Tampilkan QR / Batalkan`);
  Batalkan routes through ConfirmSheet. Nested resume-QR overlay
  `max-w-[300px] rounded-3xl`, code `192px rounded-2xl p-2`.

### POS Kasir

- Closed: full guided `CashierClosedCard` (warm card + `h-12 w-full sm:w-auto`
  accent `Buka kasir`); no menu/cart rendered until open (was blank `null`).
- Open two-pane refined: menu in one warm card (`overflow-hidden`,
  inner `p-5 sm:p-6`); desktop `lg:grid-cols-[minmax(0,1fr)_360px]`
  + sticky cart, mobile 2-col grid + floating dark bar + sheet.
  Search + categories sticky (`sticky top-0 bg-[#FFFEFB]/95 blur`);
  cart empty has `ShoppingBag` ornament.
- Toggles (`Dine in / Takeaway`, `Tunai / QRIS`): `bg-[#F3EFE6]
  p-1 rounded-full`, `h-11 text-[13px]`, active `bg-[#FFFEFB] border-[#EFE7D6] shadow-xs
  medium`. Table `select.input h-12 rounded-2xl`, label `13px
  medium + opsional`.
- Menu grid `grid-cols-2 gap-3`: warm white `p-2.5 border-[#EFE7D6] shadow-soft` cards
  (POS exception, not borderless); phone shows name + price only
  (desc `hidden sm:block`); `Habis` pill `left-2 top-2 text-[11px]
  bg-[#FFFEFB]/90`; qty badge dark `×N`; stock line only when tracked
  and `≤ 5`; Plus `h-7 border`.
- Floating cart bar (POS exception to "no floating pill"):
  `bottom-[84px+safe] max-w-[440px]`, dark `rounded-2xl
  bg-[#1C1917]`, `xs text-[#A8A29E] + 15px medium tabular`, CTA
  `h-10 rounded-full bg-[#FDBD2C] Lihat`.
- Cart sheet `max-w-[440px] rounded-t-[28px]` + grabber; rows
  `14px medium / xs text-[#A8A29E] / 13px tabular` + `QtyStepper h-9`;
  footer total `13px / base medium tabular`; CTA `h-12` accent
  `Buat pembayaran · Rp`; `Kosongkan` quiet → ConfirmSheet.
- ProductSheet (shared with customer): footer `bg-[#FAF7F1]/95`,
  label `Total` (not "Total amount"); POS keeps grid variants +
  stepper addons as staff exception.
- CashierPayment dialog `max-w-[320px]`; amount `3xl medium
  tabular`; QR card `rounded-3xl border-[#EFE7D6] bg-[#FFFEFB] shadow-soft p-4`,
  code `220px rounded-2xl`; hint `13px text-[#A8A29E]`; CTA `h-12`
  accent; polls every 7s; plain settled/expired/failed states.

### POS Menu (admin)

- Count `13px text-[#78716C]` + `Tambah h-12` accent; search `h-12`;
  `Aktif|Arsip h-11` pills with `aria-pressed`.
- Rows: `px-4 py-3.5`, thumb `h-14 rounded-xl`, name `13px medium`,
  meta `xs tabular text-[#A8A29E]` (no "unlimited" noise); status pill
  `h-9 text-[11px]` + dot; whole row is the edit target (no `···`).
  Empty `py-8` slim (was `py-14`).
- Editor sheet `max-w-[440px]`; image `16/10 rounded-2xl`; stock
  mode as `bg-[#F3EFE6]` pill toggle (Unlimited / Track stok);
  Simpan `h-12` accent, Arsipkan quiet → ConfirmSheet, Pulihkan
  accent (only one accent at a time), Batal quiet.

### POS Laporan (admin)

- Presets `Hari ini / Kemarin / 7 hari` (`h-11`) all get
  `aria-pressed` + accent `/20` when active; tapping a preset
  auto-loads (manual `Muat` kept as refresh).
- Metrics `grid-cols-2 gap-3` compact on phone (Bersih / Kotor /
  Refund) via unified `ReportMetric` (same type as `Metric`).
- `Shift berjalan` is the hero card: warm card `p-5 sm:p-6` with accent
  dot + `sm medium` header, hero value `22px medium tabular`
  + `13px tabular` sub, then Tunai/QRIS/Refund rows (`py-3`,
  warm `divide-y`). Always above period metrics.
- Sections stay warm white cards: `Rincian / Per hari / Terlaris /
  Lunas` (last 12), headers `sm medium`, rows `13px medium / xs
  text-[#A8A29E] / 13px tabular`, warm `divide-y`.
- Empties slim `py-8` (was `py-14`); loading uses metric skeletons;
  empty copy points to presets.

## Cashier Shifts (open / close / stock intake)

- No order can exist without an open shift. A `BEFORE INSERT` trigger
  (`orders_require_open_shift`, migration `020`) stamps every new order
  with the open `shift_id` and raises `SHIFT_CLOSED` otherwise — so the
  rule holds for customer QR, POS cash, and POS QR alike. Replays insert
  no rows and keep settling after close.
- Opening (`POST /api/pos/shifts/open`, either role): requires a stock
  count for **every** active tracked product (`SHIFT_INTAKE_INCOMPLETE`
  names the missing ones). Counts are set absolutely, logged as
  `manual_set` ("Stok awal shift …"), and snapshotted into
  `shift_stock_intakes`. `ShiftOpenSheet` (`pos-shift.tsx`): per-product
  stepper + numeric input with last-stock hint, optional note, accent
  `h-12 Buka kasir`.
- Closing (`POST /api/pos/shifts/close`): blocked while QR payments are
  pending (`SHIFT_CLOSE_BLOCKED:N`). `ShiftCloseSheet` shows the full
  recap first — net/gross/refund/cash/QRIS, orders, items sold,
  per-product Terjual, per-product Sisa stok (awal · terjual ·
  tersisa) — then a neutral `h-12 Tutup kasir`. QRs minted before close
  keep settling afterwards.
- Closed states: shared `CashierClosedCard` (`rounded-2xl
  border-[#EFE7D6] bg-[#FFFEFB] p-5 sm:p-6 shadow-soft`): accent dot +
  `sm medium` title + `13px` sub + `h-12 w-full sm:w-auto sm:px-8`
  accent `Buka kasir`. Beranda shows it + `Buka kasir` CTA;
  all `Pesanan baru` buttons become `Buka kasir`; Pesanan shows it on
  top with read-only list; Kasir renders ONLY the card (no blank);
  `/order` shows a quiet notice and blocks checkout with
  "Kasir sedang tutup…". Desktop sidebar + mobile header carry a
  Buka/Tutup pill.
- Reports: `getReport(from, to, shiftId?)` — daily/range reports now
  exclude `cancelled`/`draft` orders with live settlements
  (fail-closed) and normalize `settled_at` Date objects to ISO before
  comparing (the pg driver returns `Date`, and `Date >= string` is
  always false — this previously zeroed **every** daily report).
  Laporan tab adds a `Shift berjalan` live section (net · orders,
  Tunai, QRIS, Refund, Item terjual) fed by `GET
  /api/pos/shifts/recap`.

## Behavior Notes (not visual)

- Menu loads from `/api/menu` with local fallback; loading caps at 2.5s.
- Modifier pricing: each addon +5000, Lontong +2000.
- Checkout posts `idempotencyKey` (fresh UUID), `sessionToken`,
  `orderType`, `tableToken`, and item lines to `/api/checkout`.
- Paid orders append to in-session history (`PlacedOrder`: number,
  amount, type, table, time); history clears on reload — not persisted.
- "Paket Hemat" category = `product.popular` flag.
- `badgeFor` returns only the "Habis" sold-out pill; no promo badges.
