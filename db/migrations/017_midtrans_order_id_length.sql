-- Midtrans limits transaction_details.order_id to 50 characters.
-- Keep the order number readable while using a compact unique suffix for
-- repeated payment attempts on the same order.
do $migration$
declare
  v_definition text;
  v_next text;
begin
  select pg_get_functiondef('public.create_checkout_intent(uuid,text,text,public.order_type,uuid,uuid,public.payment_method,jsonb)'::regprocedure)
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
