# Tempat Taichan POS

Operational POS and QR self-ordering foundation for one Tempat Taichan branch.

## Included in this slice

- Mobile-first guest ordering at `/order`
  - table context and takeaway mode
  - category navigation and search
  - product configuration, variants, add-ons, notes, quantities
  - cart review and a QRIS payment state
  - payment success and another-round flow
- Staff workspace at `/pos`
  - live operational overview from Supabase
  - orders needing attention with server-persisted status progression
  - live order detail drawer with item/modifier snapshots
  - cashier POS with server-side QRIS and cash settlement when enabled
  - admin-only menu CRUD, uploaded images, availability and tracked stock
  - admin-only table, general QR, and staff-account management
  - Jakarta settlement-period reports with downloadable PDF close report
- Supabase migrations in `supabase/migrations/001_initial.sql` through `015_payment_inventory_lifecycle.sql`
  - integer IDR money fields
  - explicit order/payment enums
  - immutable order and modifier snapshots
  - idempotency key and unique provider references
  - opaque customer/table tokens, token versioning, and durable rate-limit buckets
  - transactional checkout, payment-attempt, refund, and order-transition RPCs
  - audit and adjustment tables
  - role-aware RLS policies
- Server-only seams for checkout and Midtrans webhooks
  - `POST /api/checkout`
  - `POST /api/webhooks/midtrans`
  - no service-role or Midtrans credentials in client code
- Customer payment recovery
  - guest session token creation
  - real provider QRIS payload rendering
  - server-verified polling and refresh recovery
- Live operational routes
  - `GET /api/pos/orders`
  - `PATCH /api/pos/orders/[id]/status`
  - `GET /api/reports/daily`
  - `GET /api/reports/daily.pdf`

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

The application requires a configured Supabase project for menu, sessions, staff, and orders. QRIS checkout additionally requires a Midtrans server key; local development can use the explicit `ALLOW_DEV_STAFF_BYPASS=true` flag only with `NODE_ENV=development`.

## Domain decisions

- `/order` is the general guest entry point. Table URLs are opaque, hashed server-side, versioned, and invalidated on rotation or deactivation.
- Browser prices and modifier names are never accepted by checkout. The server reloads menu rows, modifier relationships and settings through the transactional `create_checkout_intent` RPC and calculates totals from current authoritative data.
- A settled payment changes an order to `paid` only through the monotonic `apply_payment_transition` RPC, used by webhooks and provider polling. Duplicate and out-of-order notifications are harmless.
- Historical order lines keep product/modifier names, selling prices and estimated costs so menu edits never rewrite reporting history.
- Payment attempts are separate records. Expired QRIS attempts are never overwritten by a retry.
- A guest session has at most one live QR attempt; a retry resumes it or creates a distinct attempt only after expiry/failure.
- QRIS attempts reserve tracked stock atomically; settlement consumes it once, while expiry/failure releases the reservation.
- Reports recognize sales by payment settlement time in `Asia/Jakarta`; refund events are recognized by their processing time.
- Operational transitions are `awaiting_payment → paid → accepted → processing → ready → completed`; settled orders require the refund path for money to leave reports.
- Estimated gross profit is revenue less snapshot COGS and known payment fees; it is not accounting net profit.

## Production completion checklist

Before treating this as the restaurant's authoritative POS:

1. Apply migrations `001_initial.sql` through `015_payment_inventory_lifecycle.sql`; seed real categories, menu, tables and pre-provisioned staff profiles.
2. Use `/admin/tables` and `/admin/general-qr` as an administrator to create or rotate printable opaque ordering URLs. Existing seeded table hashes are intentionally not reversible.
3. Use `/admin/staff` to provision staff accounts. The service-role Auth API is server-only; never expose its key to the browser.
4. Configure Midtrans webhook delivery to `/api/webhooks/midtrans`, verify sandbox settlement, and confirm the merchant's refund permissions before enabling refunds operationally.
5. Set production-only secrets (`SUPABASE_SECRET_KEY`, `MIDTRANS_SERVER_KEY`) in the deployment secret store. Keep `ALLOW_DEV_STAFF_BYPASS` unset or `false`.
6. Configure database backups, monitoring, and a tested restore procedure before launch.

Menu images are deliberately written under `public/uploads/menu` as sanitized WebP files. The deployment must provide a writable, durable filesystem for this directory; immutable/serverless runtimes need a different storage adapter before production use.

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
lib/
  domain/ / security/ / format.ts / schemas.ts / types.ts
  payments/provider.ts / payments/midtrans.ts
  supabase/admin.ts / supabase/server.ts
supabase/migrations/001_initial.sql … 015_payment_inventory_lifecycle.sql
```
