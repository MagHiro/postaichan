-- Safe starter data for the first Tempat Taichan branch.
-- Run in Supabase SQL Editor after 001_initial.sql.

insert into public.restaurant_settings (name, timezone, qris_enabled, cash_enabled)
select 'Tempat Taichan', 'Asia/Jakarta', true, true
where not exists (select 1 from public.restaurant_settings);

insert into public.categories (name, display_order)
values
  ('Sate Taichan', 1),
  ('Rice', 2),
  ('Extras', 3),
  ('Drinks', 4)
on conflict (name) do nothing;

insert into public.variant_groups (name, selection, required, min_selection, max_selection, display_order)
select group_name, 'single', true, 1, 1, group_order
from (values
  ('Level pedas', 1),
  ('Pilihan karbo', 2)
) as groups(group_name, group_order)
where not exists (select 1 from public.variant_groups existing where existing.name = groups.group_name);

insert into public.variant_options (group_id, name, display_order)
select vg.id, option_name, option_order
from public.variant_groups vg
cross join (values
  ('Level pedas', 'No chili', 1),
  ('Level pedas', 'Mild', 2),
  ('Level pedas', 'Medium', 3),
  ('Level pedas', 'Spicy', 4),
  ('Level pedas', 'Extra spicy', 5),
  ('Pilihan karbo', 'No rice', 1),
  ('Pilihan karbo', 'Rice', 2),
  ('Pilihan karbo', 'Lontong', 3)
) as options(group_name, option_name, option_order)
where vg.name = options.group_name
  and not exists (
    select 1 from public.variant_options vo
    where vo.group_id = vg.id and vo.name = options.option_name
  );

update public.variant_options vo
set price_adjustment_idr = 2000
from public.variant_groups vg
where vo.group_id = vg.id
  and vg.name = 'Pilihan karbo'
  and vo.name = 'Lontong';

insert into public.addon_groups (name, required, max_selection, display_order)
select 'Tambahan', false, 3, 1
where not exists (select 1 from public.addon_groups where name = 'Tambahan');

insert into public.addon_options (group_id, name, price_adjustment_idr, cost_adjustment_idr, display_order)
select ag.id, option_name, price_idr, cost_idr, option_order
from public.addon_groups ag
cross join (values
  ('Extra sambal', 5000, 1500, 1),
  ('Telur mata sapi', 5000, 2500, 2),
  ('Kerupuk kulit', 5000, 2000, 3)
) as options(option_name, price_idr, cost_idr, option_order)
where ag.name = 'Tambahan'
  and not exists (
    select 1 from public.addon_options ao
    where ao.group_id = ag.id and ao.name = options.option_name
  );

insert into public.products (category_id, name, description, price_idr, estimated_cost_idr, display_order)
select c.id, p.name, p.description, p.price_idr, p.cost_idr, p.display_order
from public.categories c
cross join (values
  ('Sate Taichan', 'Sate Taichan 10 Tusuk', 'Sate ayam juicy, sambal khas, dan perasan jeruk limau.', 28000, 10500, 1),
  ('Sate Taichan', 'Sate Taichan 5 Tusuk', 'Porsi ringan dengan sambal khas Tempat Taichan.', 17000, 6500, 2),
  ('Sate Taichan', 'Sate Kulit Crispy', 'Kulit ayam renyah dengan bumbu gurih pedas.', 22000, 8000, 3),
  ('Rice', 'Rice Bowl Taichan', 'Nasi hangat, ayam taichan, telur, dan sambal.', 27000, 10500, 1),
  ('Extras', 'Extra Sambal', 'Sambal taichan ekstra pedas, dibuat fresh.', 5000, 1500, 1),
  ('Extras', 'Lontong', 'Lontong pulen untuk teman makan sate.', 6000, 2000, 2),
  ('Drinks', 'Es Teh Manis', 'Teh melati dingin, manisnya pas.', 8000, 2000, 1),
  ('Drinks', 'Es Jeruk', 'Jeruk peras segar dengan es batu.', 12000, 3500, 2)
) as p(category_name, name, description, price_idr, cost_idr, display_order)
where c.name = p.category_name
  and not exists (select 1 from public.products existing where existing.name = p.name and existing.category_id = c.id);

update public.products
set popular = true
where name in ('Sate Taichan 10 Tusuk', 'Rice Bowl Taichan');

insert into public.product_variant_groups (product_id, group_id)
select p.id, vg.id
from public.products p
join public.variant_groups vg on vg.name = case when p.name = 'Rice Bowl Taichan' then 'Pilihan karbo' else 'Level pedas' end
where p.name in ('Sate Taichan 10 Tusuk', 'Sate Taichan 5 Tusuk', 'Sate Kulit Crispy', 'Rice Bowl Taichan')
on conflict do nothing;

insert into public.product_addon_groups (product_id, group_id)
select p.id, ag.id
from public.products p cross join public.addon_groups ag
where p.name in ('Sate Taichan 10 Tusuk', 'Sate Taichan 5 Tusuk', 'Sate Kulit Crispy', 'Rice Bowl Taichan')
  and ag.name = 'Tambahan'
on conflict do nothing;

insert into public.restaurant_tables (label, code, qr_token_hash)
select 'Table ' || lpad(n::text, 2, '0'), 'TBL-' || lpad(n::text, 2, '0'), encode(digest('tempat-taichan-table-' || n::text || '-' || gen_random_uuid()::text, 'sha256'), 'hex')
from generate_series(1, 8) as numbers(n)
where not exists (select 1 from public.restaurant_tables t where t.code = 'TBL-' || lpad(n::text, 2, '0'));
