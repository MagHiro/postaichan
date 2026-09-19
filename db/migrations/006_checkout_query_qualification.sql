-- Qualify the payment lookup in the existing checkout function. The output
-- column named order_id is also a PL/pgSQL variable, so an unqualified column
-- reference is ambiguous to the function linter.
do $$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.create_checkout_intent(uuid,text,text,public.order_type,uuid,uuid,public.payment_method,jsonb)'::regprocedure)
    into v_definition;
  v_definition := replace(v_definition, 'from public.payments where order_id = v_order.id', 'from public.payments p where p.order_id = v_order.id');
  execute v_definition;
end;
$$;
