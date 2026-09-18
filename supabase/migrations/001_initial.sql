-- Tempat Taichan POS: single-branch operational schema.
-- Monetary values are integer IDR. Guest access is token-scoped; staff access is role-scoped.

create extension if not exists pgcrypto;

create type public.staff_role as enum ('operator', 'admin');
create type public.order_type as enum ('dine_in', 'takeaway');
create type public.order_status as enum ('draft', 'awaiting_payment', 'paid', 'accepted', 'processing', 'ready', 'completed', 'cancelled', 'refunded');
create type public.payment_status as enum ('pending', 'settled', 'expired', 'failed', 'refunded', 'partially_refunded');
create type public.payment_method as enum ('qris', 'cash');
create type public.modifier_selection as enum ('single', 'multiple');

create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = timezone('utc', now()); return new; end $$;

create table public.restaurant_settings (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Tempat Taichan',
  timezone text not null default 'Asia/Jakarta',
  qris_enabled boolean not null default true,
  cash_enabled boolean not null default true,
  tax_bps integer not null default 0 check (tax_bps between 0 and 10000),
  service_charge_bps integer not null default 0 check (service_charge_bps between 0 and 10000),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role public.staff_role not null default 'operator',
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  display_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (name)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories(id),
  name text not null,
  description text,
  image_path text,
  price_idr integer not null check (price_idr >= 0),
  estimated_cost_idr integer not null default 0 check (estimated_cost_idr >= 0),
  available boolean not null default true,
  active boolean not null default true,
  display_order integer not null default 0,
  archived_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.variant_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  selection public.modifier_selection not null default 'single',
  required boolean not null default false,
  min_selection integer not null default 0 check (min_selection >= 0),
  max_selection integer not null default 1 check (max_selection >= 1),
  active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.variant_options (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.variant_groups(id) on delete cascade,
  name text not null,
  price_adjustment_idr integer not null default 0,
  cost_adjustment_idr integer not null default 0,
  available boolean not null default true,
  display_order integer not null default 0,
  unique (group_id, name)
);

create table public.product_variant_groups (
  product_id uuid not null references public.products(id) on delete cascade,
  group_id uuid not null references public.variant_groups(id) on delete cascade,
  primary key (product_id, group_id)
);

create table public.addon_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  required boolean not null default false,
  min_selection integer not null default 0 check (min_selection >= 0),
  max_selection integer not null default 1 check (max_selection >= 1),
  active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.addon_options (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.addon_groups(id) on delete cascade,
  name text not null,
  price_adjustment_idr integer not null default 0,
  cost_adjustment_idr integer not null default 0,
  available boolean not null default true,
  display_order integer not null default 0,
  unique (group_id, name)
);

create table public.product_addon_groups (
  product_id uuid not null references public.products(id) on delete cascade,
  group_id uuid not null references public.addon_groups(id) on delete cascade,
  primary key (product_id, group_id)
);

create table public.restaurant_tables (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  code text not null unique,
  active boolean not null default true,
  qr_token_hash text not null unique,
  qr_token_version integer not null default 1,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.customer_sessions (
  id uuid primary key default gen_random_uuid(),
  access_token_hash text not null unique,
  order_type public.order_type not null,
  table_id uuid references public.restaurant_tables(id),
  expires_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now()),
  check ((order_type = 'dine_in' and table_id is not null) or (order_type = 'takeaway'))
);

create sequence public.order_number_seq;

create or replace function public.next_order_number() returns text language sql volatile security definer set search_path = public as $$
  select 'TT-' || to_char(timezone('Asia/Jakarta', now()), 'YYMMDD') || '-' || lpad(nextval('public.order_number_seq')::text, 4, '0');
$$;

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  idempotency_key text not null unique,
  customer_session_id uuid references public.customer_sessions(id),
  table_id uuid references public.restaurant_tables(id),
  order_type public.order_type not null,
  status public.order_status not null default 'draft',
  currency text not null default 'IDR',
  subtotal_idr integer not null default 0 check (subtotal_idr >= 0),
  discount_idr integer not null default 0 check (discount_idr >= 0),
  tax_idr integer not null default 0 check (tax_idr >= 0),
  service_charge_idr integer not null default 0 check (service_charge_idr >= 0),
  total_idr integer not null default 0 check (total_idr >= 0),
  estimated_cost_idr integer not null default 0 check (estimated_cost_idr >= 0),
  visit_reference uuid,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  product_id uuid references public.products(id),
  product_name_snapshot text not null,
  quantity integer not null check (quantity > 0 and quantity <= 99),
  unit_price_idr integer not null check (unit_price_idr >= 0),
  unit_cost_snapshot_idr integer not null check (unit_cost_snapshot_idr >= 0),
  note text,
  line_total_idr integer not null check (line_total_idr >= 0),
  created_at timestamptz not null default timezone('utc', now())
);

create table public.order_item_modifiers (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references public.order_items(id) on delete cascade,
  modifier_type text not null check (modifier_type in ('variant', 'addon')),
  modifier_id uuid,
  modifier_name_snapshot text not null,
  price_adjustment_idr integer not null default 0,
  cost_adjustment_snapshot_idr integer not null default 0
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  provider text not null default 'midtrans',
  method public.payment_method not null,
  status public.payment_status not null default 'pending',
  amount_idr integer not null check (amount_idr > 0),
  provider_transaction_id text unique,
  provider_order_id text not null unique,
  qr_string text,
  expires_at timestamptz,
  settled_at timestamptz,
  fee_idr integer not null default 0 check (fee_idr >= 0),
  last_provider_status text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.payment_events (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid references public.payments(id) on delete set null,
  provider_event_key text not null unique,
  provider_transaction_id text,
  event_type text not null,
  payload jsonb not null,
  verified boolean not null default false,
  created_at timestamptz not null default timezone('utc', now())
);

create table public.order_adjustments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  actor_id uuid not null references auth.users(id),
  reason text not null,
  before_state jsonb not null,
  after_state jsonb not null,
  created_at timestamptz not null default timezone('utc', now())
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index orders_created_at_idx on public.orders(created_at desc);
create index orders_status_idx on public.orders(status);
create index orders_table_id_idx on public.orders(table_id);
create index order_items_order_id_idx on public.order_items(order_id);
create index payments_order_id_idx on public.payments(order_id);
create index payments_status_idx on public.payments(status);
create index payment_events_payment_id_idx on public.payment_events(payment_id);
create index audit_logs_created_at_idx on public.audit_logs(created_at desc);
create index products_active_order_idx on public.products(active, display_order);

create trigger restaurant_settings_updated_at before update on public.restaurant_settings for each row execute procedure public.set_updated_at();
create trigger profiles_updated_at before update on public.profiles for each row execute procedure public.set_updated_at();
create trigger categories_updated_at before update on public.categories for each row execute procedure public.set_updated_at();
create trigger products_updated_at before update on public.products for each row execute procedure public.set_updated_at();
create trigger variant_groups_updated_at before update on public.variant_groups for each row execute procedure public.set_updated_at();
create trigger addon_groups_updated_at before update on public.addon_groups for each row execute procedure public.set_updated_at();
create trigger restaurant_tables_updated_at before update on public.restaurant_tables for each row execute procedure public.set_updated_at();
create trigger orders_updated_at before update on public.orders for each row execute procedure public.set_updated_at();
create trigger payments_updated_at before update on public.payments for each row execute procedure public.set_updated_at();

alter table public.restaurant_settings enable row level security;
alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.variant_groups enable row level security;
alter table public.variant_options enable row level security;
alter table public.product_variant_groups enable row level security;
alter table public.addon_groups enable row level security;
alter table public.addon_options enable row level security;
alter table public.product_addon_groups enable row level security;
alter table public.restaurant_tables enable row level security;
alter table public.customer_sessions enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_item_modifiers enable row level security;
alter table public.payments enable row level security;
alter table public.payment_events enable row level security;
alter table public.order_adjustments enable row level security;
alter table public.audit_logs enable row level security;

create or replace function public.is_staff() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active = true);
$$;
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active = true and role = 'admin');
$$;

-- Public clients only read the customer-safe menu projection through a server route.
-- No direct anonymous table/order/payment reads are granted.
create policy staff_read_settings on public.restaurant_settings for select to authenticated using (public.is_staff());
create policy staff_manage_settings on public.restaurant_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy staff_read_profiles on public.profiles for select to authenticated using (public.is_staff());
create policy admin_manage_profiles on public.profiles for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy staff_read_menu on public.categories for select to authenticated using (public.is_staff());
create policy staff_manage_categories on public.categories for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy staff_read_products on public.products for select to authenticated using (public.is_staff());
create policy admin_manage_products on public.products for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy staff_read_modifiers on public.variant_groups for select to authenticated using (public.is_staff());
create policy staff_read_variant_options on public.variant_options for select to authenticated using (public.is_staff());
create policy admin_manage_variant_groups on public.variant_groups for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_manage_variant_options on public.variant_options for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy staff_read_addons on public.addon_groups for select to authenticated using (public.is_staff());
create policy staff_read_addon_options on public.addon_options for select to authenticated using (public.is_staff());
create policy admin_manage_addon_groups on public.addon_groups for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_manage_addon_options on public.addon_options for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy staff_read_tables on public.restaurant_tables for select to authenticated using (public.is_staff());
create policy admin_manage_tables on public.restaurant_tables for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy staff_read_orders on public.orders for select to authenticated using (public.is_staff());
create policy staff_update_orders on public.orders for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy staff_read_order_items on public.order_items for select to authenticated using (public.is_staff());
create policy staff_read_modifiers_snapshot on public.order_item_modifiers for select to authenticated using (public.is_staff());
create policy staff_read_payments on public.payments for select to authenticated using (public.is_staff());
create policy staff_read_payment_events on public.payment_events for select to authenticated using (public.is_admin());
create policy staff_read_adjustments on public.order_adjustments for select to authenticated using (public.is_staff());
create policy staff_create_adjustments on public.order_adjustments for insert to authenticated with check (public.is_staff() and actor_id = auth.uid());
create policy admin_read_audit on public.audit_logs for select to authenticated using (public.is_admin());

-- Server-side service role is used only by controlled checkout/webhook routes to create guest orders/payments.
