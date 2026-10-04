-- Qualify references that share names with this function's OUT parameters.
create or replace function public.prepare_provider_confirmed_refund_attempt(
  p_payment_id uuid, p_refund_key text, p_amount_idr integer, p_reason text, p_actor_id uuid
) returns table(attempt_id uuid, amount_idr integer, refund_key text, idempotency_key uuid)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_payment public.payments%rowtype;
  v_attempt public.refund_attempts%rowtype;
  v_reserved bigint;
  v_idempotency uuid;
  v_digest text;
begin
  if not public.is_admin_actor(p_actor_id) then raise exception 'ADMIN_NOT_AUTHORIZED'; end if;
  if p_refund_key is null or char_length(p_refund_key) not between 1 and 160
     or p_amount_idr is null or p_amount_idr <= 0
     or p_reason is null or char_length(trim(p_reason)) not between 3 and 240 then
    raise exception 'INVALID_PROVIDER_REFUND_RECONCILIATION';
  end if;

  select * into v_payment from public.payments where id = p_payment_id for update;
  if not found or v_payment.provider <> 'midtrans' or v_payment.method <> 'qris'
     or v_payment.status not in ('settled','partially_refunded') then
    raise exception 'PAYMENT_NOT_REFUNDABLE';
  end if;
  select * into v_attempt from public.refund_attempts ra where ra.refund_key = p_refund_key for update;
  if found then
    if v_attempt.payment_id <> p_payment_id or v_attempt.amount_idr <> p_amount_idr then
      raise exception 'REFUND_IDEMPOTENCY_CONFLICT';
    end if;
    attempt_id := v_attempt.id; amount_idr := v_attempt.amount_idr;
    refund_key := v_attempt.refund_key; idempotency_key := v_attempt.idempotency_key;
    return next; return;
  end if;

  select coalesce(sum(ra.amount_idr), 0) into v_reserved
  from public.refund_attempts ra
  where ra.payment_id = p_payment_id and ra.state in ('claimed','submitted','needs_reconciliation');
  if v_payment.refunded_amount_idr::bigint + v_reserved + p_amount_idr > v_payment.amount_idr then
    raise exception 'INVALID_REFUND_AMOUNT';
  end if;

  v_digest := encode(digest(p_payment_id::text || ':' || p_refund_key, 'sha256'), 'hex');
  v_idempotency := (substr(v_digest,1,8) || '-' || substr(v_digest,9,4) || '-5' || substr(v_digest,14,3) || '-a' || substr(v_digest,18,3) || '-' || substr(v_digest,21,12))::uuid;
  insert into public.refund_attempts(payment_id, amount_idr, idempotency_key, refund_key, reason, actor_id, state, provider_metadata)
  values (p_payment_id, p_amount_idr, v_idempotency, p_refund_key, trim(p_reason), p_actor_id, 'needs_reconciliation', jsonb_build_object('origin','provider_status_reconciliation'))
  returning * into v_attempt;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, new_value)
  values (p_actor_id, 'provider_refund_reconciliation_started', 'payment', p_payment_id,
    jsonb_build_object('refund_attempt_id', v_attempt.id, 'amount_idr', v_attempt.amount_idr, 'refund_key', v_attempt.refund_key));
  attempt_id := v_attempt.id; amount_idr := v_attempt.amount_idr;
  refund_key := v_attempt.refund_key; idempotency_key := v_attempt.idempotency_key;
  return next;
end;
$$;
