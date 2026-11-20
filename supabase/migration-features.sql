-- TriHatid feature migration — run once in the Supabase SQL editor.
-- Safe to re-run: every statement uses IF NOT EXISTS.
-- Features: SMS notifications, driver details/plate, Special (Arkila), rating tags,
--           driver documents (Operator's Permit, Body No., Rehistro), app feedback.

-- 1) Driver documents + SMS preference on profiles
alter table public.profiles add column if not exists operator_permit_no  text;
alter table public.profiles add column if not exists operator_permit_url text;
alter table public.profiles add column if not exists body_no             text;
alter table public.profiles add column if not exists plate_no            text;
alter table public.profiles add column if not exists rehistro_no         text;
alter table public.profiles add column if not exists rehistro_url        text;
alter table public.profiles add column if not exists notify_sms          boolean default true;

-- 2) Ride columns: driver snapshot, Special (Arkila), ratings
alter table public.rides add column if not exists driver_phone     text;
alter table public.rides add column if not exists driver_plate     text;
alter table public.rides add column if not exists driver_body_no   text;
alter table public.rides add column if not exists driver_permit_no text;
alter table public.rides add column if not exists passenger_count  int  default 1;
alter table public.rides add column if not exists trip_mode        text default 'shared';   -- shared | point_to_point | hourly
alter table public.rides add column if not exists hire_hours       int;
alter table public.rides add column if not exists rating_tags      text;
alter table public.rides add column if not exists passenger_rating int;

-- 2b) Rebook the same driver: a ride can be offered to one specific driver first.
alter table public.rides add column if not exists preferred_driver_id   uuid;
alter table public.rides add column if not exists preferred_driver_name text;

-- 2c) Destination coordinates (so Rebook can recompute the fare correctly) + push token
alter table public.rides    add column if not exists destination_lat double precision;
alter table public.rides    add column if not exists destination_lng double precision;
alter table public.profiles add column if not exists fcm_token text;

-- 3) SMS outbox. The app only writes (ride, recipient, event); the send-sms Edge Function
--    builds the text and sends it, so clients can never choose a phone number or message.
create table if not exists public.sms_outbox (
  id           bigint generated always as identity primary key,
  ride_id      text        not null,
  recipient_id uuid        not null,
  event        text        not null check (event in ('accepted','arriving','started','completed','cancelled')),
  status       text        not null default 'pending',   -- pending | sent | skipped | failed
  error        text,
  created_at   timestamptz not null default now(),
  unique (ride_id, recipient_id, event)                   -- never send the same SMS twice
);
alter table public.sms_outbox enable row level security;

drop policy if exists "ride participants queue sms" on public.sms_outbox;
create policy "ride participants queue sms" on public.sms_outbox
  for insert to authenticated
  with check (
    exists (
      select 1 from public.rides r
      where r.id::text = sms_outbox.ride_id
        and auth.uid() in (r.passenger_id, r.driver_id)
        and sms_outbox.recipient_id in (r.passenger_id, r.driver_id)
    )
  );
-- (No select/update policy: only the service role used by the Edge Function reads this table.)

-- 4) General app feedback
create table if not exists public.feedback (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text,
  category   text,
  rating     int check (rating between 1 and 5),
  message    text not null,
  created_at timestamptz not null default now()
);
alter table public.feedback enable row level security;

drop policy if exists "users send own feedback" on public.feedback;
create policy "users send own feedback" on public.feedback
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "users read own feedback" on public.feedback;
create policy "users read own feedback" on public.feedback
  for select to authenticated using (auth.uid() = user_id);

-- 5) Reports: drivers can now report passengers. reporter_id / reporter_role say who filed it,
--    reported_user_id is the person being reported. passenger_id stays for old passenger reports.
alter table public.reports add column if not exists reporter_id      uuid;
alter table public.reports add column if not exists reporter_role    text default 'passenger';
alter table public.reports add column if not exists reported_user_id uuid;
alter table public.reports alter column passenger_id drop not null;

drop policy if exists "users file own reports" on public.reports;
create policy "users file own reports" on public.reports
  for insert to authenticated
  with check (auth.uid() = reporter_id or auth.uid() = passenger_id);

-- 6. Live driver location (passenger "Locate driver" on the on-trip screen)
alter table public.rides add column if not exists driver_lat double precision;
alter table public.rides add column if not exists driver_lng double precision;
alter table public.rides add column if not exists driver_location_at timestamptz;
-- Optional: instant (realtime) updates on the passenger map. Without it the app polls every 3 s.
do $$ begin
  alter publication supabase_realtime add table public.rides;
exception when others then null; end $$;

-- 7. Driver documents: make sure every driver's Body No., Operator's Permit and Rehistro reach the
--    profiles row (passengers can only read profiles, not the login metadata).
--    7a) Backfill drivers who registered before the columns/trigger existed. Only fills blanks.
update public.profiles p set
  operator_permit_no = coalesce(nullif(trim(p.operator_permit_no), ''), 
                                nullif(trim(u.raw_user_meta_data->>'operator_permit_no'), ''),
                                nullif(trim(u.raw_user_meta_data->>'franchise_no'), '')),
  body_no            = coalesce(nullif(trim(p.body_no), ''),    nullif(trim(u.raw_user_meta_data->>'body_no'), '')),
  rehistro_no        = coalesce(nullif(trim(p.rehistro_no), ''), nullif(trim(u.raw_user_meta_data->>'rehistro_no'), '')),
  plate_no           = coalesce(nullif(trim(p.plate_no), ''),   nullif(trim(u.raw_user_meta_data->>'plate_no'), ''))
from auth.users u
where u.id = p.id and p.role = 'driver';

--    7b) Keep new sign-ups in sync. Separate trigger, so it does not touch your existing signup trigger.
--        Named "zz_" so it fires after the trigger that creates the profile row.
create or replace function public.sync_driver_docs_from_auth() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.raw_user_meta_data->>'role', '') = 'driver' then
    update public.profiles set
      operator_permit_no = coalesce(nullif(trim(operator_permit_no), ''), nullif(trim(new.raw_user_meta_data->>'operator_permit_no'), ''), nullif(trim(new.raw_user_meta_data->>'franchise_no'), '')),
      body_no            = coalesce(nullif(trim(body_no), ''),    nullif(trim(new.raw_user_meta_data->>'body_no'), '')),
      rehistro_no        = coalesce(nullif(trim(rehistro_no), ''), nullif(trim(new.raw_user_meta_data->>'rehistro_no'), '')),
      plate_no           = coalesce(nullif(trim(plate_no), ''),   nullif(trim(new.raw_user_meta_data->>'plate_no'), ''))
    where id = new.id;
  end if;
  return new;
end $$;

drop trigger if exists zz_sync_driver_docs on auth.users;
create trigger zz_sync_driver_docs
  after insert or update of raw_user_meta_data on auth.users
  for each row execute function public.sync_driver_docs_from_auth();
