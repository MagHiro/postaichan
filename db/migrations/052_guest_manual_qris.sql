-- Allow token-scoped guest checkout to select the onsite QRIS channel.
-- Payment confirmation remains exclusively staff-authorized.
create or replace function public.create_manual_qris_intent(
  p_idempotency_key uuid, p_idempotency_fingerprint text,
  p_session_hash text, p_table_id uuid, p_actor_id uuid,
  p_payment_method public.payment_method, p_items jsonb
) returns table(
  order_id uuid, order_number text, payment_id uuid,
  payment_status public.payment_status, amount_idr integer,
  provider_order_id text, qr_string text, expires_at timestamptz, replayed boolean
)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_intent record;
  v_provider text;
begin
  if (p_session_hash is null and not public.is_staff_actor(p_actor_id))
     or p_payment_method <> 'qris' then raise exception 'MANUAL_QRIS_UNAUTHORIZED'; end if;
  select * into v_intent from public.create_checkout_intent(
    p_idempotency_key, p_idempotency_fingerprint, p_session_hash,
    p_table_id, p_actor_id, 'qris'::public.payment_method, p_items
  );
  if not found then raise exception 'MANUAL_QRIS_INTENT_MISSING'; end if;
  -- Both the reservation and channel assignment are committed atomically.
  update public.payments set provider='manual_qris', updated_at=timezone('utc',now())
  where id=v_intent.payment_id and provider='midtrans' and status='pending';
  select provider into v_provider from public.payments where id=v_intent.payment_id;
  if v_provider is distinct from 'manual_qris' then raise exception 'MANUAL_QRIS_PROVIDER_CONFLICT'; end if;
  return query select v_intent.order_id::uuid, v_intent.order_number::text,
    v_intent.payment_id::uuid, v_intent.payment_status::public.payment_status,
    v_intent.amount_idr::integer, v_intent.provider_order_id::text,
    null::text, v_intent.expires_at::timestamptz, v_intent.replayed::boolean;
end;
$$;
revoke all on function public.create_manual_qris_intent(uuid,text,text,uuid,uuid,public.payment_method,jsonb) from public;
grant execute on function public.create_manual_qris_intent(uuid,text,text,uuid,uuid,public.payment_method,jsonb) to postaichan_runtime;
