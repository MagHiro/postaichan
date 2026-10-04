-- QRIS transactions using GoPay must use Midtrans' transaction_id for the
-- refund endpoint. Return the provider reference with the durable claim.
drop function public.claim_payment_refund(uuid, integer, text, uuid, uuid);
create function public.claim_payment_refund(
  p_payment_id uuid, p_amount_idr integer, p_reason text,
  p_idempotency_key uuid, p_actor_id uuid
) returns table(attempt_id uuid, amount_idr integer, provider_order_id text,
  provider_transaction_id text, refund_key text, attempt_state text,
  claim_token uuid, already_confirmed boolean)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_payment public.payments%rowtype;
  v_attempt public.refund_attempts%rowtype;
  v_reserved bigint;
  v_token uuid;
begin
  if not public.is_admin_actor(p_actor_id) then raise exception 'ADMIN_NOT_AUTHORIZED'; end if;
  if p_idempotency_key is null or p_reason is null or char_length(trim(p_reason)) not between 3 and 240
     or p_amount_idr is null or p_amount_idr <= 0 then raise exception 'INVALID_REFUND_REQUEST'; end if;
  select * into v_payment from public.payments where id = p_payment_id for update;
  if not found or v_payment.status not in ('settled','partially_refunded')
     or v_payment.method <> 'qris' or v_payment.provider <> 'midtrans' then raise exception 'PAYMENT_NOT_REFUNDABLE'; end if;
  if v_payment.provider_transaction_id is null or char_length(v_payment.provider_transaction_id) not between 1 and 120 then
    raise exception 'PAYMENT_PROVIDER_TRANSACTION_MISSING';
  end if;
  select * into v_attempt from public.refund_attempts
  where payment_id = p_payment_id and idempotency_key = p_idempotency_key for update;
  if found then
    if v_attempt.amount_idr <> p_amount_idr or v_attempt.reason <> trim(p_reason) then raise exception 'REFUND_IDEMPOTENCY_CONFLICT'; end if;
    if v_attempt.state = 'confirmed' then
      attempt_id := v_attempt.id; amount_idr := v_attempt.amount_idr;
      provider_order_id := v_payment.provider_order_id; provider_transaction_id := v_payment.provider_transaction_id;
      refund_key := v_attempt.refund_key; attempt_state := v_attempt.state; claim_token := null;
      already_confirmed := true; return next; return;
    end if;
    if v_attempt.claim_token is not null and v_attempt.claimed_at > timezone('utc', now()) - interval '60 seconds' then raise exception 'REFUND_IN_PROGRESS'; end if;
    select coalesce(sum(ra.amount_idr), 0) into v_reserved from public.refund_attempts ra
    where ra.payment_id = p_payment_id and ra.id <> v_attempt.id and ra.state in ('claimed','submitted','needs_reconciliation');
    if v_payment.refunded_amount_idr::bigint + v_reserved + p_amount_idr > v_payment.amount_idr then raise exception 'INVALID_REFUND_AMOUNT'; end if;
    v_token := gen_random_uuid();
    update public.refund_attempts set state = 'claimed', claim_token = v_token,
      claimed_at = timezone('utc', now()), attempt_count = attempt_count + 1,
      last_error_code = null, updated_at = timezone('utc', now())
    where id = v_attempt.id returning * into v_attempt;
  else
    select coalesce(sum(ra.amount_idr), 0) into v_reserved from public.refund_attempts ra
    where ra.payment_id = p_payment_id and ra.state in ('claimed','submitted','needs_reconciliation');
    if v_payment.refunded_amount_idr::bigint + v_reserved + p_amount_idr > v_payment.amount_idr then raise exception 'INVALID_REFUND_AMOUNT'; end if;
    v_token := gen_random_uuid();
    insert into public.refund_attempts(payment_id, amount_idr, idempotency_key, refund_key, reason, actor_id, claim_token, claimed_at)
    values (p_payment_id, p_amount_idr, p_idempotency_key,
      'refund-' || left(encode(digest(p_payment_id::text || ':' || p_idempotency_key::text, 'sha256'), 'hex'), 40),
      trim(p_reason), p_actor_id, v_token, timezone('utc', now())) returning * into v_attempt;
  end if;
  attempt_id := v_attempt.id; amount_idr := v_attempt.amount_idr;
  provider_order_id := v_payment.provider_order_id; provider_transaction_id := v_payment.provider_transaction_id;
  refund_key := v_attempt.refund_key; attempt_state := v_attempt.state; claim_token := v_attempt.claim_token;
  already_confirmed := false; return next;
end;
$$;
grant execute on function public.claim_payment_refund(uuid, integer, text, uuid, uuid) to postaichan_runtime;
