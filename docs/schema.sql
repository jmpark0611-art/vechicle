create extension if not exists pgcrypto;

create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  vehicle_number text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists vehicles_vehicle_number_key
  on public.vehicles (vehicle_number);

create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid references public.vehicles (id) on delete restrict,
  start_place text,
  end_place text,
  start_time timestamptz not null default now(),
  end_time timestamptz,
  start_lat double precision,
  start_lng double precision,
  end_lat double precision,
  end_lng double precision,
  status text not null default 'in_progress',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trips_status_check check (status in ('in_progress', 'completed', 'canceled'))
);

create index if not exists trips_status_start_time_idx
  on public.trips (status, start_time desc);

create index if not exists trips_vehicle_id_start_time_idx
  on public.trips (vehicle_id, start_time desc);

create table if not exists public.gps_points (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  latitude double precision not null,
  longitude double precision not null,
  speed_kmh double precision,
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists gps_points_trip_id_recorded_at_idx
  on public.gps_points (trip_id, recorded_at desc);

create table if not exists public.app_access_counters (
  name text primary key,
  total_count bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.app_access_counters enable row level security;

drop policy if exists "anon_select_app_access_counters" on public.app_access_counters;
create policy "anon_select_app_access_counters" on public.app_access_counters
  for select to anon using (true);

create or replace function public.increment_access_counter(counter_name text default 'app_open')
returns table(total_count bigint, updated_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  insert into public.app_access_counters as counters (name, total_count, updated_at)
  values (counter_name, 1, now())
  on conflict (name)
  do update set
    total_count = counters.total_count + 1,
    updated_at = now()
  returning counters.total_count, counters.updated_at;
end;
$$;

grant execute on function public.increment_access_counter(text) to anon;

-- RLS 정책 (anon 키로 CRUD 허용)
-- gps_points: RLS 활성화 + SELECT/INSERT
alter table public.gps_points enable row level security;

drop policy if exists "anon_select_gps_points" on public.gps_points;
create policy "anon_select_gps_points" on public.gps_points
  for select to anon using (true);

drop policy if exists "anon_insert_gps_points" on public.gps_points;
create policy "anon_insert_gps_points" on public.gps_points
  for insert to anon with check (true);

-- vehicles: RLS 활성화 + 전체 CRUD
alter table public.vehicles enable row level security;

drop policy if exists "anon_select_vehicles" on public.vehicles;
create policy "anon_select_vehicles" on public.vehicles
  for select to anon using (true);

drop policy if exists "anon_insert_vehicles" on public.vehicles;
create policy "anon_insert_vehicles" on public.vehicles
  for insert to anon with check (true);

drop policy if exists "anon_update_vehicles" on public.vehicles;
create policy "anon_update_vehicles" on public.vehicles
  for update to anon using (true) with check (true);

drop policy if exists "anon_delete_vehicles" on public.vehicles;
create policy "anon_delete_vehicles" on public.vehicles
  for delete to anon using (true);

-- trips: RLS 활성화 + 전체 CRUD
alter table public.trips enable row level security;

drop policy if exists "anon_select_trips" on public.trips;
create policy "anon_select_trips" on public.trips
  for select to anon using (true);

drop policy if exists "anon_insert_trips" on public.trips;
create policy "anon_insert_trips" on public.trips
  for insert to anon with check (true);

drop policy if exists "anon_update_trips" on public.trips;
create policy "anon_update_trips" on public.trips
  for update to anon using (true) with check (true);

drop policy if exists "anon_delete_trips" on public.trips;
create policy "anon_delete_trips" on public.trips
  for delete to anon using (true);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists vehicles_set_updated_at on public.vehicles;
create trigger vehicles_set_updated_at
before update on public.vehicles
for each row
execute function public.set_updated_at();

drop trigger if exists trips_set_updated_at on public.trips;
create trigger trips_set_updated_at
before update on public.trips
for each row
execute function public.set_updated_at();
