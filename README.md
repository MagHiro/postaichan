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
  - cashier POS that creates a server-side QRIS attempt
  - menu CRUD and availability toggles
  - Jakarta daily report with downloadable PDF close report
- Supabase migration in `supabase/migrations/001_initial.sql`
  - integer IDR money fields
  - explicit order/payment enums
  - immutable order and modifier snapshots
  - idempotency key and unique provider references
  - customer session boundaries separate from table identity
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

The visual demo works without Supabase credentials. Checkout API calls require a configured Supabase project and Midtrans server key.

## Domain decisions

- `/order` is the general guest entry point; a production table QR should resolve to a signed/opaque table token and create a separate customer session.
- Browser prices are never accepted by checkout. The server reloads menu rows and calculates totals from current authoritative data.
- A settled payment changes an order to `paid` only through verified provider notification. Duplicate webhook events are ignored by `payment_events.provider_event_key`.
- Historical order lines keep product/modifier names, selling prices and estimated costs so menu edits never rewrite reporting history.
- Payment attempts are separate records. Expired QRIS attempts are never overwritten by a retry.
- Estimated gross profit is revenue less snapshot COGS and known payment fees; it is not accounting net profit.

## Production completion checklist

Before treating this as the restaurant's authoritative POS:

1. Apply the Supabase migration and seed the real categories, menu, tables and staff profiles.
2. Add the server-side session/token issuance route for general and table QR flows.
3. Move modifier validation and order/payment creation into a Postgres transaction or RPC so line snapshots and payment intent creation cannot partially commit.
4. Wire the Midtrans QR string to the provider's current QRIS response contract and verify merchant credentials in sandbox.
5. Add authenticated staff sign-in, middleware, rate limiting and a report/export route.
6. Add database backups and a tested restore procedure before launch.

## Project shape

```text
app/
  api/checkout/route.ts
  api/webhooks/midtrans/route.ts
  order/page.tsx
  pos/page.tsx
components/
  order-experience.tsx
  pos-workspace.tsx
lib/
  data.ts / format.ts / schemas.ts / types.ts
  payments/provider.ts / payments/midtrans.ts
  supabase/admin.ts / supabase/server.ts
supabase/migrations/001_initial.sql
```

Build verification: `npm run typecheck` and `npm run build` pass.
