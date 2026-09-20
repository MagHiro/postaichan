# UX/UI Audit — Tempat Taichan POS

Status: implemented fixes on `codex/ux-ui-audit-fixes`.

## Scope

Inspected the repository structure, package scripts, Next.js App Router guidance, shared styles, route layouts, server/API handlers, authentication, database-backed data flows, public customer ordering UI, POS workspace, admin screens, QR flows, menu management, staff management, report controls, image handling, and the existing test/build setup.

User-facing routes reviewed:

- Public ordering: `/order`, `/order/[accessToken]`, `/order/g/[token]`, `/order/t/[tableToken]`
- Staff authentication and workspace: `/login`, `/pos`
- Administration: `/admin`, `/admin/tables`, `/admin/general-qr`, `/admin/staff`
- Related API paths for menu loading, customer sessions, checkout/payment polling, POS orders, reports, QR/table management, staff, and menu editing

The application was run locally with the repository's existing npm scripts and a healthy local PostgreSQL container. No dependency or package-manager migration was introduced.

## Product understanding

Tempat Taichan is a restaurant operating system with two connected audiences:

- Guests scan a table or general QR, browse the menu, choose dine-in/takeaway, configure modifiers, build a cart, and pay through QRIS.
- Staff and administrators use the workspace to monitor orders, move kitchen statuses forward, create cashier orders, inspect payment state, manage menu availability/stock, manage tables and QR codes, manage staff, and read daily reports.

The most frequent/high-risk actions are adding and paying for an order, advancing order status, changing menu availability, rotating QR tokens, archiving menu products, disabling staff, and refunding settled payments.

## High-impact findings

| Severity | Location | Problem and impact | Root cause | Fix implemented | Verification |
| --- | --- | --- | --- | --- | --- |
| P1 | `components/pos-workspace-live.tsx` | Order status actions had no per-order in-flight guard and a failed request could leave the user without clear recovery. | The action awaited a fetch directly and relied on the next refresh. | Added `advancingId`, disabled/ busy states, guarded transitions, `try/catch/finally`, persistent failure copy, and refresh after success. | Typecheck, lint, unit tests, production build, and source walkthrough of the status path. |
| P1 | Customer menu and session flow in `components/order/OrderExperience.tsx` | A short timeout and full-page reload made transient menu failures feel like a dead end; session errors were placed outside the currently visible interaction. | Error state was global/implicit and retry used `window.location.reload()`. | Added explicit loading/error state, longer timeout, in-place retry, `role=alert`, and visible toast feedback for unavailable ordering sessions. | `/order` SSR smoke check, `/api/menu` 200 response, typecheck/lint/build. |
| P1 | Login in `app/login/page.tsx` | A network rejection could leave the submit button stuck in loading state; form fields lacked explicit IDs and recovery feedback. | Fetch had no error boundary/finally path. | Added `try/catch/finally`, Indonesian recovery copy, explicit labels/IDs, `aria-busy`, alert semantics, and visible loading text. | `/login` SSR output includes title, h1, and labelled email control; typecheck/lint/build. |
| P1 | Product, cart, order-detail, QR, cashier-payment, and staff dialogs | Dialogs did not consistently trap focus, restore focus, or close with Escape, creating keyboard and screen-reader friction. | Each surface handled open/close behavior independently or not at all. | Added shared `components/use-dialog-focus.ts` and integrated it across the modal/sheet surfaces with labelled dialog headings and safe body-scroll handling. | Typecheck/lint/build plus static keyboard/focus-path review. |
| P1 | Admin forms in `components/menu-manager.tsx`, `components/table-manager.tsx`, `components/admin/general-qr-manager.tsx`, and `components/admin/staff-manager.tsx` | Several actions were click-only, errors could be hidden behind a modal, and mobile fields were unnecessarily dense. | Mutations were wired to buttons rather than native form submission; labels/required metadata were inconsistent. | Converted create/edit flows to native forms, added persistent labels, IDs, required constraints, Enter submission, modal error placement, and mobile stacking. | Typecheck/lint/build and source review of validation/submission paths. |
| P2 | POS navigation and cashier in `components/pos-workspace-live.tsx` | Mobile navigation labels competed for width and the primary “new order” action was ambiguous; cashier could show the wrong payment method and did not refresh the live list after creation. | Desktop labels were reused on the compact bottom bar; payment text was hardcoded. | Added concise mobile labels, changed the action to “Pesanan baru”, made the payment label dynamic, refreshed operations after creation, and added confirmation before clearing a cart. | Responsive class review at the target breakpoints; typecheck/lint/build. |
| P2 | Loading, empty, and recoverable error states across POS/admin/customer surfaces | Some failures appeared as ephemeral notices or blank/unchanged content without a next action. | Data loaders did not retain a recoverable error state. | Added inline alerts, retry buttons, clearer empty-state next steps, disabled/loading labels, and polite live status for transient feedback. | Local runtime API/page smoke checks and static state-path review. |
| P2 | Route metadata and user-facing API copy | Pages shared an unhelpful title and some recoverable API errors surfaced English implementation wording inside an otherwise Indonesian UI. | Metadata was defined only at the root; API fallback messages were inconsistent. | Added route-specific titles and localized customer/POS/report/table error responses with actionable wording. | SSR title checks for `/order`, `/login`, `/admin`, `/admin/tables`, `/admin/staff`, and `/admin/general-qr`; build. |

## Accessibility findings

The implementation targets WCAG 2.2 AA where the current product scope allows it.

- Added a consistent, high-contrast `:focus-visible` ring for buttons, links, form controls, and focusable dialog roots; no global outline removal was introduced.
- Added a reduced-motion media query and preserved the existing component-level reduced-motion rules.
- Added descriptive route titles and meaningful h1/dialog headings so App Router route announcements have useful names.
- Added persistent labels/IDs, native form semantics, required constraints, autocomplete metadata for authentication/staff creation, and a semantic fieldset for stock mode.
- Added `aria-pressed` to toggle-like category/order/payment controls, `aria-current` to active navigation, `aria-busy` to in-flight actions, and `role=alert`/`role=status` for errors and dynamic feedback.
- Added item-specific accessible names to quantity controls instead of repeating ambiguous “Tambah”/“Kurangi” labels.
- Added dialog names, Escape handling, focus trapping, focus restoration, and body-scroll locking through the shared dialog hook.
- Added meaningful QR/menu image alt text plus intrinsic dimensions to reduce layout movement.

No automated axe or screen-reader run was possible because this environment has no browser automation/runtime installed. Keyboard behavior was reviewed from the DOM and interaction code; browser-level keyboard validation remains a QA follow-up in an environment with Chromium or equivalent.

## Responsive findings

The responsive implementation was reviewed against 320px, 375px, 390px, 768px, 1024px, 1280px, and 1440px layout targets, including the intermediate behavior implied by Tailwind breakpoints.

- Customer and cashier sheets retain viewport-height limits and scroll internally rather than exceeding the screen.
- The fixed mobile navigation and cart controls preserve safe-area padding and now use shorter navigation labels.
- Menu-editor pricing fields stack below the small breakpoint instead of forcing two narrow columns on phones.
- Admin create/edit forms stack controls on small screens and retain full-width touch targets.
- The POS workspace keeps its desktop sidebar at large widths and uses the compact bottom navigation below the large breakpoint.
- Search, category filters, and order filters remain horizontally scrollable without forcing page-width overflow.

The repository has no browser renderer available in this execution environment, so these are code/layout verification results rather than screenshot-based viewport evidence. The audit report deliberately records that limitation instead of claiming pixel-level browser verification.

## Design-system findings

- Preserved the existing Poppins typography, neutral surfaces, yellow accent, rounded controls, compact max-width customer ordering layout, Lucide icon set, and Tailwind 4 setup.
- Reused existing `.input`, sheet/backdrop, spacing, and shadow patterns rather than introducing another UI library or a parallel visual language.
- Added one reusable interaction primitive, `useDialogFocus`, because the same focus behavior was needed by multiple modal/sheet surfaces.
- Standardized common interaction feedback through disabled/busy labels, inline alerts, retry actions, and live regions.
- No new package dependency, CSS framework, or backend schema was introduced.

## Deferred issues

- Browser screenshots, real keyboard walkthroughs, and screen-reader announcements require Chromium/Playwright or an equivalent QA environment, which was unavailable here. The local server, SSR output, API responses, source behavior, and production build were verified instead.
- The QR/table/staff/archive confirmations still use the platform's native `window.confirm`. They are keyboard-accessible and preserve the required safety stop, but a custom shared confirmation dialog would provide more consistent visuals and richer context if the product wants that follow-up.
- Live Midtrans settlement/webhook behavior was not exercised because the repository's external payment credentials/provider environment were not in scope. Payment polling and failure paths were inspected and hardened without fabricating a payment result.
- The repository has no component/browser test harness, so no new UI automation suite was invented. The existing unit tests and full build remain the regression gate.
- No dark theme was added because the current product has no established theme concept; adding one would be a product/design-system decision rather than an audit fix.

## Validation record

Baseline before edits: `npm run typecheck`, `npm run lint`, `npm run test`, and `npm run build` all passed.

Final validation after edits:

- `npm run typecheck` — passed
- `npm run lint` — passed
- `npm run test` — passed, 9 tests
- `npm run build` — passed; Next.js generated all 26 application routes
- `git diff --check` — passed
- Runtime smoke checks — `/order` 200, `/login` 200, unauthenticated `/pos` 307 to `/login?next=/pos`, `/api/menu` 200, and protected admin routes redirecting when unauthenticated; protected route titles were also verified in route metadata/build output
