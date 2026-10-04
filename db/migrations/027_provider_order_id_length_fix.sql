-- Regression from 025_remove_order_type.sql: rewriting create_checkout_intent
-- restored the full-uuid provider_order_id suffix that
-- 017_midtrans_order_id_length.sql had shortened to 16 hex chars. Midtrans
-- rejects transaction_details.order_id longer than 50 characters, so new QR
-- payments fail at the provider (order_number 14 chars + '-' + 36-char uuid
-- = 51). Restore the compact suffix. replace() rewrites both occurrences
-- (new-order and idempotency-replay branches) in one pass.
do $migration$
declare
  v_definition text;
  v_next text;
begin
  select pg_get_functiondef('public.create_checkout_intent(uuid,text,text,uuid,uuid,public.payment_method,jsonb)'::regprocedure)
    into v_definition;
  if v_definition is null then raise exception 'create_checkout_intent_not_found'; end if;

  v_next := replace(
    v_definition,
    $$case when p_payment_method = 'cash' then 'cash-' || v_order.order_number || '-' || gen_random_uuid()::text else v_order.order_number || '-' || gen_random_uuid()::text end$$,
    $$case when p_payment_method = 'cash' then 'cash-' || v_order.order_number || '-' || left(replace(gen_random_uuid()::text, '-', ''), 16) else v_order.order_number || '-' || left(replace(gen_random_uuid()::text, '-', ''), 16) end$$
  );
  if v_next = v_definition then raise exception 'create_checkout_intent_provider_order_id_fragment_not_found'; end if;
  execute v_next;
end;
$migration$;
