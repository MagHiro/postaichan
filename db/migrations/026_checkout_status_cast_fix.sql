-- Regression from 025_remove_order_type.sql: rewriting create_checkout_intent
-- dropped the ::public.order_status cast that 007_checkout_status_cast.sql had
-- added. The CASE then yields text, and PostgreSQL rejects the orders INSERT
-- with `column "status" is of type order_status but expression is of type
-- text`, breaking every cashier checkout (cash and QRIS). Restore the cast.
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
    $$case when p_payment_method = 'cash' then 'paid' else 'awaiting_payment' end$$,
    $$case when p_payment_method = 'cash' then 'paid'::public.order_status else 'awaiting_payment'::public.order_status end$$
  );
  if v_next = v_definition then raise exception 'create_checkout_intent_status_cast_fragment_not_found'; end if;
  execute v_next;
end;
$migration$;
