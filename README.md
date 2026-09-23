# Tempat Taichan POS

Operational POS and QR self-ordering application for one Tempat Taichan branch.

## Included

- Mobile-first guest ordering at `/order` with table/general QR context, menu configuration, stock-aware carts, and QRIS checkout.
- Staff workspace at `/pos` with live orders, kitchen progression, cashier cash/QRIS checkout, and role-aware navigation.
- Admin-only menu, uploaded WebP images, stock controls, tables/QR, general QR, staff accounts, and settlement-period reports with PDF export.
- PostgreSQL-backed application authentication with database sessions and scrypt password hashes.
- Atomic PostgreSQL checkout, payment, stock reservation, settlement, refund, idempotency, and audit functions.

## Run locally

The local database is a plain PostgreSQL 16 container defined in `compose.yaml`. It listens on host port `55432` by default so it can coexist with another PostgreSQL service.

```bash
npm install
cp .env.example .env.local
npm run db:up
npm run db:migrate
ADMIN_EMAIL=admin@baraburn.my.id ADMIN_PASSWORD='choose-a-local-password-with-at-least-12-characters' npm run db:seed
npm run dev
```

The application reads `DATABASE_URL`. Migration and seed scripts may use `DATABASE_ADMIN_URL` when the application uses a separate least-privileged database role. Keep both URLs server-side and never expose them to the browser.

The QRIS integration requires `MIDTRANS_SERVER_KEY`. Keep `ALLOW_DEV_STAFF_BYPASS` unset or `false` outside local development.

Useful database commands:

```bash
npm run db:migrate
npm run db:seed
npm run db:down
```

## Domain decisions

- `/order` is the general guest entry point. Table and general QR URLs use opaque tokens, store only SHA-256 hashes, and invalidate immediately after rotation or deactivation.
- Browser prices, names, modifiers, availability, table identity, and totals are never trusted at checkout. PostgreSQL reloads the current menu and calculates the authoritative order.
- Tracked inventory is reserved atomically for QRIS attempts, consumed exactly once at settlement/cash checkout, and released on expiry/failure/cancellation. Refunds do not silently restock prepared food.
- Historical order lines retain immutable product/modifier names, selling prices, and estimated costs.
- Payment attempts remain separate records. Duplicate checkout requests and provider notifications are harmless; out-of-order payment transitions cannot move state backwards.
- Reports recognize sales at payment settlement time in `Asia/Jakarta`; refund events use their processing time.

## Deployment notes

The application owns staff authentication. Cookies contain opaque database-session tokens and are `HttpOnly`, `SameSite=Lax`, and secure in production. Staff roles are checked on server-rendered pages, route handlers, and transactional database functions.

Menu images are sanitized WebP files under `public/uploads/menu`. The deployment must provide a writable, durable filesystem for this directory; immutable/serverless runtimes need a different storage adapter before production use.

Use database backups, monitoring, secret rotation, and a tested restore procedure before launch. The compose file is intended for local/single-host operation, not as a complete production orchestration policy.

## Verification

```bash
npm run typecheck
npm run test
npm run lint
npm run build
```

## Project shape

```text
app/
  api/checkout/route.ts
  api/webhooks/midtrans/route.ts
  order/page.tsx
  pos/page.tsx
components/
  order/
  pos-workspace-live.tsx
  table-manager.tsx
db/
  migrations/001_initial.sql … 016_local_auth.sql
  seed.sql
lib/
  auth/ / db.ts / domain/ / payments/ / reports.ts
scripts/
  migrate.mjs / seed.mjs
```
