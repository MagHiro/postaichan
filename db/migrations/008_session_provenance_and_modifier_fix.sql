-- Preserve the source table QR context even when a customer switches the order
-- type to takeaway. The order itself remains table-free, while the session can
-- still be invalidated if that table is disabled or its QR is rotated.
alter table public.customer_sessions add column if not exists source_table_id uuid references public.restaurant_tables(id);
alter table public.customer_sessions add column if not exists source_table_qr_version integer;
alter table public.customer_sessions drop constraint if exists customer_sessions_source_table_reference_check;
alter table public.customer_sessions add constraint customer_sessions_source_table_reference_check
  check ((source_table_id is null and source_table_qr_version is null)
    or (source_table_id is not null and source_table_qr_version is not null and source_table_qr_version > 0));
create index if not exists customer_sessions_source_table_idx on public.customer_sessions(source_table_id, source_table_qr_version);

-- The function is already live in earlier additive migrations. Replace only
-- the two discovered fragments so the applied history remains immutable.
do $migration$
declare
  v_definition text;
  v_next text;
begin
  select pg_get_functiondef(p.oid)
    into v_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'create_checkout_intent';
  if v_definition is null then raise exception 'create_checkout_intent_not_found'; end if;

  v_next := replace(v_definition,
$needle$    v_table_id := v_session.table_id;
    if v_table_id is not null and not exists (select 1 from public.restaurant_tables rt where rt.id = v_table_id and rt.active = true and rt.qr_token_version = v_session.table_qr_version) then raise exception 'TABLE_NOT_AVAILABLE'; end if;$needle$,
$replacement$    if v_session.source_table_id is not null and not exists (select 1 from public.restaurant_tables rt where rt.id = v_session.source_table_id and rt.active = true and rt.qr_token_version = v_session.source_table_qr_version) then raise exception 'TABLE_NOT_AVAILABLE'; end if;
    v_table_id := v_session.table_id;
    if v_table_id is not null and not exists (select 1 from public.restaurant_tables rt where rt.id = v_table_id and rt.active = true and rt.qr_token_version = v_session.table_qr_version) then raise exception 'TABLE_NOT_AVAILABLE'; end if;$replacement$);
  if v_next = v_definition then raise exception 'create_checkout_intent_table_fragment_not_found'; end if;

  v_next := replace(v_next,
$needle$      select count(*) into v_group_count from public.addon_options where group_id = v_group.id;$needle$,
$replacement$      select count(*) into v_group_count from public.addon_options where group_id = v_group.id and id = any(v_addon_ids);$replacement$);
  if v_next = v_definition then raise exception 'create_checkout_intent_addon_fragment_not_found'; end if;
  execute v_next;
end;
$migration$;
