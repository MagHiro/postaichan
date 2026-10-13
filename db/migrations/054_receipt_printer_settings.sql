-- Receipt presentation is merchant-controlled; device pairing stays per browser.
create table public.receipt_settings (
  id boolean primary key default true check (id),
  merchant_name text not null default 'Tempat Taichan' check (char_length(merchant_name) between 1 and 80),
  address text not null default '' check (char_length(address) <= 200),
  footer text not null default 'Terima kasih sudah memesan!' check (char_length(footer) <= 240),
  paper_width_mm integer not null default 58 check (paper_width_mm in (58, 80)),
  ble_service_uuid text not null default 'ffe0',
  ble_characteristic_uuid text not null default 'ffe1',
  updated_at timestamptz not null default timezone('utc',now())
);
insert into public.receipt_settings(id) values (true);
grant select on public.receipt_settings to postaichan_runtime;

create function public.update_receipt_settings(
  p_name text, p_address text, p_footer text, p_width integer,
  p_service_uuid text, p_characteristic_uuid text, p_actor_id uuid
) returns public.receipt_settings
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_settings public.receipt_settings%rowtype;
begin
  if not public.is_admin_actor(p_actor_id) then raise exception 'ADMIN_NOT_AUTHORIZED'; end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 80
    or p_address is null or length(p_address) > 200
    or p_footer is null or length(p_footer) > 240
    or p_width not in (58,80)
    or p_service_uuid is null or p_characteristic_uuid is null
    or p_service_uuid !~* '^([0-9a-f]{4}|[0-9a-f]{8}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$'
    or p_characteristic_uuid !~* '^([0-9a-f]{4}|[0-9a-f]{8}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$'
    or p_name ~ '[[:cntrl:]]' or p_address ~ '[[:cntrl:]]' or p_footer ~ '[[:cntrl:]]'
  then raise exception 'INVALID_RECEIPT_SETTINGS'; end if;
  update public.receipt_settings
  set merchant_name = btrim(p_name), address = p_address, footer = p_footer,
      paper_width_mm = p_width, ble_service_uuid = lower(p_service_uuid),
      ble_characteristic_uuid = lower(p_characteristic_uuid),
      updated_at = timezone('utc', now())
  where id = true returning * into v_settings;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, new_value)
  values (p_actor_id, 'receipt_settings_updated', 'receipt_settings', null,
          jsonb_build_object('paper_width_mm',v_settings.paper_width_mm,'merchant_name',v_settings.merchant_name));
  return v_settings;
end;
$$;
revoke all on function public.update_receipt_settings(text,text,text,integer,text,text,uuid) from public;
grant execute on function public.update_receipt_settings(text,text,text,integer,text,text,uuid) to postaichan_runtime;
