create or replace function public.record_admin_reconciliation_request(
  p_actor_id uuid, p_action text, p_entity_id uuid, p_amount_idr integer
) returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_admin_actor(p_actor_id) then raise exception 'ADMIN_NOT_AUTHORIZED'; end if;
  if p_action not in ('accept_settlement','refund_settlement','reconcile_refund_attempt','reconcile_provider_refund')
     or p_entity_id is null or (p_amount_idr is not null and p_amount_idr <= 0) then raise exception 'INVALID_RECONCILIATION_ACTION'; end if;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, new_value)
  values (p_actor_id, 'admin_reconciliation_requested', 'reconciliation', p_entity_id,
    jsonb_build_object('action', p_action, 'amount_idr', p_amount_idr));
  return true;
end;
$$;
grant execute on function public.record_admin_reconciliation_request(uuid, text, uuid, integer) to postaichan_runtime;
