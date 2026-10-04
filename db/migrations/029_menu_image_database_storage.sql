-- Durable image storage for serverless deployments with read-only filesystems.
-- Keep existing image URLs and product records unchanged.
create table public.menu_images (
  image_path text primary key check (image_path ~ '^/uploads/menu/[A-Za-z0-9_-]+[.]webp$'),
  data bytea not null check (octet_length(data) between 1 and 10485760),
  created_at timestamptz not null default timezone('utc', now())
);
