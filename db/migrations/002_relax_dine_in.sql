-- Allow dine-in sessions without a table QR (free Makan di Tempat / Takeaway switch).
-- The table number becomes optional: sessions from a table QR still link table_id,
-- walk-in dine-in sessions simply carry a null table_id through to orders.
alter table public.customer_sessions drop constraint if exists customer_sessions_check;
alter table public.customer_sessions
  add check ((order_type = 'dine_in') or (order_type = 'takeaway'));
