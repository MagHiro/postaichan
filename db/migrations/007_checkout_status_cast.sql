do $do$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.create_checkout_intent(uuid,text,text,public.order_type,uuid,uuid,public.payment_method,jsonb)'::regprocedure)
    into v_definition;
  v_definition := replace(v_definition, $$case when p_payment_method = 'cash' then 'paid' else 'awaiting_payment' end, v_subtotal$$, $$case when p_payment_method = 'cash' then 'paid'::public.order_status else 'awaiting_payment'::public.order_status end, v_subtotal$$);
  execute v_definition;
end;
$do$;
