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

create table if not exists public.maintenance_records (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles (id) on delete cascade,
  item_key text not null,
  completed_km numeric not null,
  completed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint maintenance_records_item_key_check check (item_key in ('engineOil', 'oilFilter', 'airFilter')),
  constraint maintenance_records_completed_km_check check (completed_km >= 0)
);

create index if not exists maintenance_records_vehicle_item_completed_idx
  on public.maintenance_records (vehicle_id, item_key, completed_at desc);

create table if not exists public.speed_zones (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  latitude double precision not null,
  longitude double precision not null,
  radius_m numeric not null,
  speed_limit_kmh numeric not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint speed_zones_radius_check check (radius_m > 0),
  constraint speed_zones_limit_check check (speed_limit_kmh > 0)
);

create index if not exists speed_zones_name_idx
  on public.speed_zones (name);

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

drop trigger if exists maintenance_records_set_updated_at on public.maintenance_records;
create trigger maintenance_records_set_updated_at
before update on public.maintenance_records
for each row
execute function public.set_updated_at();

drop trigger if exists speed_zones_set_updated_at on public.speed_zones;
create trigger speed_zones_set_updated_at
before update on public.speed_zones
for each row
execute function public.set_updated_at();

alter table public.maintenance_records enable row level security;
alter table public.speed_zones enable row level security;

drop policy if exists maintenance_records_anon_select on public.maintenance_records;
create policy maintenance_records_anon_select
  on public.maintenance_records for select
  using (true);

drop policy if exists maintenance_records_anon_insert on public.maintenance_records;
create policy maintenance_records_anon_insert
  on public.maintenance_records for insert
  with check (true);

drop policy if exists speed_zones_anon_select on public.speed_zones;
create policy speed_zones_anon_select
  on public.speed_zones for select
  using (true);

drop policy if exists speed_zones_anon_all on public.speed_zones;
create policy speed_zones_anon_all
  on public.speed_zones for all
  using (true)
  with check (true);
