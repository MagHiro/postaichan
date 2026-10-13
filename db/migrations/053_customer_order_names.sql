-- Persist the handoff name on every new cashier/general-QR order.
-- For a validated table-specific QR, the table is already the primary handoff identifier.
alter table public.orders add column if not exists customer_name text;
alter table public.orders add constraint orders_customer_name_valid
  check (customer_name is null or (
    char_length(customer_name) between 1 and 80
    and customer_name = btrim(customer_name)
    and customer_name !~ '[[:cntrl:]]'
  ));

-- Use one atomic transaction for creating/replaying an intent and assigning its
-- immutable handoff name. This wraps the existing fully validated checkout RPC
-- without copying its security, stock, payment, or idempotency implementation.
create function public.create_named_checkout_intent(
  p_idempotency_key uuid, p_idempotency_fingerprint text,
  p_session_hash text, p_table_id uuid, p_actor_id uuid,
  p_payment_method public.payment_method, p_items jsonb,
  p_customer_name text, p_manual_qris boolean
) returns table(
  order_id uuid, order_number text, payment_id uuid,
  payment_status public.payment_status, amount_idr integer,
  provider_order_id text, qr_string text, expires_at timestamptz, replayed boolean
)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_name text := nullif(btrim(p_customer_name), '');
  v_table_qr boolean := false;
  v_intent record;
  v_existing text;
begin
  if v_name is not null and (
    char_length(v_name) > 80 or v_name ~ '[[:cntrl:]]'
  ) then raise exception 'INVALID_CUSTOMER_NAME'; end if;
  if p_session_hash is not null then
    select s.source_table_id is not null into v_table_qr
      from public.customer_sessions s where s.access_token_hash = p_session_hash;
  end if;
  -- A selected cashier table is not the same as a table-scoped customer QR.
  if not coalesce(v_table_qr, false) and v_name is null then
    raise exception 'CUSTOMER_NAME_REQUIRED';
  end if;

  if p_manual_qris then
    select * into v_intent from public.create_manual_qris_intent(
      p_idempotency_key, p_idempotency_fingerprint, p_session_hash,
      p_table_id, p_actor_id, p_payment_method, p_items
    );
  else
    select * into v_intent from public.create_checkout_intent(
      p_idempotency_key, p_idempotency_fingerprint, p_session_hash,
      p_table_id, p_actor_id, p_payment_method, p_items
    );
  end if;
  if not found or v_intent.order_id is null then
    raise exception 'CHECKOUT_INTENT_MISSING';
  end if;
  if v_intent.replayed then
    select o.customer_name into v_existing from public.orders o
      where o.id = v_intent.order_id for update;
    if v_existing is distinct from v_name then
      raise exception 'IDEMPOTENCY_KEY_REUSED';
    end if;
  else
    update public.orders o set customer_name = v_name
      where o.id = v_intent.order_id;
  end if;

  return query select v_intent.order_id::uuid, v_intent.order_number::text,
    v_intent.payment_id::uuid, v_intent.payment_status::public.payment_status,
    v_intent.amount_idr::integer, v_intent.provider_order_id::text,
    v_intent.qr_string::text, v_intent.expires_at::timestamptz,
    v_intent.replayed::boolean;
end;
$$;
revoke all on function public.create_named_checkout_intent(uuid,text,text,uuid,uuid,public.payment_method,jsonb,text,boolean) from public;
grant execute on function public.create_named_checkout_intent(uuid,text,text,uuid,uuid,public.payment_method,jsonb,text,boolean) to postaichan_runtime;
