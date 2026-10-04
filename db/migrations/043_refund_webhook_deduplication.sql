create or replace function public.mark_provider_refund_notification(
  p_payment_id uuid, p_provider_status text, p_metadata jsonb
) returns integer
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_count integer;
  v_keys jsonb := coalesce(p_metadata->'refundKeys', '[]'::jsonb);
  v_unknown_keys jsonb;
  v_alert_key text;
begin
  if p_provider_status not in ('refund','partial_refund') then
    raise exception 'INVALID_PROVIDER_REFUND_STATUS';
  end if;
  if jsonb_typeof(v_keys) <> 'array' then raise exception 'INVALID_PROVIDER_REFUND_METADATA'; end if;

  update public.refund_attempts ra
  set state = 'needs_reconciliation', claim_token = null, claimed_at = null,
      provider_metadata = ra.provider_metadata || coalesce(p_metadata, '{}'::jsonb),
      updated_at = timezone('utc', now())
  where ra.payment_id = p_payment_id and ra.state <> 'confirmed'
    and (jsonb_array_length(v_keys) = 0 or ra.refund_key in (select jsonb_array_elements_text(v_keys)));
  get diagnostics v_count = row_count;

  if jsonb_array_length(v_keys) > 0 then
    select coalesce(jsonb_agg(keys.refund_key), '[]'::jsonb) into v_unknown_keys
    from (select distinct jsonb_array_elements_text(v_keys) as refund_key) keys
    where not exists (
      select 1 from public.refund_attempts ra
      where ra.payment_id = p_payment_id and ra.refund_key = keys.refund_key
    );
    if jsonb_array_length(v_unknown_keys) = 0 then return v_count; end if;
  elsif v_count > 0 then
    return v_count;
  else
    v_unknown_keys := '[]'::jsonb;
  end if;

  v_alert_key := 'provider-refund-webhook:' || md5(p_payment_id::text || ':' || p_provider_status || ':' || coalesce(p_metadata::text, ''));
  perform public.record_provider_reconciliation_alert(v_alert_key, p_payment_id,
    'provider_refund_without_local_attempt',
    jsonb_build_object('providerStatus', p_provider_status, 'metadata', coalesce(p_metadata, '{}'::jsonb), 'unknownRefundKeys', v_unknown_keys));
  return v_count;
end;
$$;
grant execute on function public.mark_provider_refund_notification(uuid, text, jsonb) to postaichan_runtime;
