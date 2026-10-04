-- Bound outstanding public QRIS reservations even when requests arrive from
-- many source networks. The transaction advisory lock serializes the capacity
-- check with every reservation insert/reactivation.
create index if not exists inventory_reservations_active_capacity_idx
  on public.inventory_reservations(status, expires_at, payment_id);

create or replace function public.enforce_active_qris_reservation_capacity()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_payment public.payments%rowtype;
  v_active_count bigint;
  v_capacity constant bigint := 1000;
begin
  if new.status <> 'reserved' or new.expires_at <= timezone('utc', now()) then return new; end if;
  select * into v_payment from public.payments where id = new.payment_id;
  if not found or v_payment.method <> 'qris' or v_payment.status <> 'pending'
     or v_payment.expires_at is null or v_payment.expires_at <= timezone('utc', now()) then
    return new;
  end if;

  perform pg_advisory_xact_lock(713142078314::bigint);
  select count(*) into v_active_count
  from public.inventory_reservations ir
  join public.payments p on p.id = ir.payment_id
  where ir.payment_id <> new.payment_id
    and ir.status = 'reserved'
    and ir.expires_at > timezone('utc', now())
    and p.status = 'pending'
    and p.method = 'qris'
    and p.expires_at > timezone('utc', now());
  if v_active_count >= v_capacity then
    raise exception 'QR_RESERVATION_CAPACITY';
  end if;
  return new;
end;
$$;

drop trigger if exists inventory_reservation_capacity_guard on public.inventory_reservations;
create trigger inventory_reservation_capacity_guard
before insert or update of status, expires_at on public.inventory_reservations
for each row execute function public.enforce_active_qris_reservation_capacity();

revoke all on function public.enforce_active_qris_reservation_capacity() from public;
