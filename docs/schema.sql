create extension if not exists pgcrypto;

create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  unit_code text,
  vehicle_number text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.vehicles add column if not exists unit_code text;

drop index if exists vehicles_vehicle_number_key;
create unique index if not exists vehicles_unit_vehicle_number_key
  on public.vehicles (coalesce(unit_code, ''), vehicle_number);

create index if not exists vehicles_unit_code_idx
  on public.vehicles (unit_code);

create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  unit_code text,
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
  purpose text,
  operator_name text,
  operator_rank text,
  user_name text,
  user_rank text,
  daily_km numeric,
  start_odometer numeric,
  end_odometer numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trips_status_check check (status in ('in_progress', 'completed', 'canceled'))
);

-- Migration: add extended trip columns if they don't exist yet
alter table public.trips add column if not exists unit_code text;
alter table public.trips add column if not exists purpose text;
alter table public.trips add column if not exists operator_name text;
alter table public.trips add column if not exists operator_rank text;
alter table public.trips add column if not exists user_name text;
alter table public.trips add column if not exists user_rank text;
alter table public.trips add column if not exists daily_km numeric;
alter table public.trips add column if not exists start_odometer numeric;
alter table public.trips add column if not exists end_odometer numeric;
alter table public.trips alter column vehicle_id drop not null;

create index if not exists trips_status_start_time_idx
  on public.trips (status, start_time desc);

create index if not exists trips_unit_code_start_time_idx
  on public.trips (unit_code, start_time desc);

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
  unit_code text,
  name text not null,
  latitude double precision not null,
  longitude double precision not null,
  radius_m numeric not null,
  speed_limit_kmh numeric not null,
  zone_kind text not null default 'circle',
  polygon_points jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint speed_zones_radius_check check (radius_m > 0),
  constraint speed_zones_limit_check check (speed_limit_kmh > 0),
  constraint speed_zones_kind_check check (zone_kind in ('circle', 'polygon')),
  constraint speed_zones_polygon_check check (
    zone_kind = 'circle'
    or (jsonb_typeof(polygon_points) = 'array' and jsonb_array_length(polygon_points) >= 3)
  )
);

alter table public.speed_zones add column if not exists zone_kind text not null default 'circle';
alter table public.speed_zones add column if not exists polygon_points jsonb;
alter table public.speed_zones add column if not exists unit_code text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'speed_zones_kind_check'
      and conrelid = 'public.speed_zones'::regclass
  ) then
    alter table public.speed_zones
      add constraint speed_zones_kind_check check (zone_kind in ('circle', 'polygon'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'speed_zones_polygon_check'
      and conrelid = 'public.speed_zones'::regclass
  ) then
    alter table public.speed_zones
      add constraint speed_zones_polygon_check check (
        zone_kind = 'circle'
        or (jsonb_typeof(polygon_points) = 'array' and jsonb_array_length(polygon_points) >= 3)
      );
  end if;
end $$;

create index if not exists speed_zones_name_idx
  on public.speed_zones (name);

create index if not exists speed_zones_unit_code_idx
  on public.speed_zones (unit_code);

create index if not exists speed_zones_zone_kind_idx
  on public.speed_zones (zone_kind);

create table if not exists public.obd_logs (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid references public.vehicles (id) on delete cascade,
  trip_id uuid references public.trips (id) on delete set null,
  rpm integer,
  speed_kmh numeric,
  coolant_temp_c numeric,
  battery_voltage numeric,
  fuel_level_percent numeric,
  engine_load_percent numeric,
  throttle_percent numeric,
  intake_air_temp_c numeric,
  ignition_status text,
  dtc_codes text[],
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint obd_logs_rpm_check check (rpm is null or rpm >= 0),
  constraint obd_logs_speed_check check (speed_kmh is null or speed_kmh >= 0),
  constraint obd_logs_fuel_check check (fuel_level_percent is null or (fuel_level_percent >= 0 and fuel_level_percent <= 100))
);

create index if not exists obd_logs_vehicle_recorded_idx
  on public.obd_logs (vehicle_id, recorded_at desc);

create index if not exists obd_logs_trip_id_idx
  on public.obd_logs (trip_id);

create table if not exists public.units (
  code text primary key,
  name text not null,
  commander_pin text,
  created_at timestamptz not null default now()
);

insert into public.units (code, name, commander_pin)
values
  ('1862', '1862부대', '1862'),
  ('5969', '5969부대', '1862')
on conflict (code) do update
set name = excluded.name,
    commander_pin = excluded.commander_pin;

alter table public.units enable row level security;

drop policy if exists units_anon_all on public.units;
create policy units_anon_all
  on public.units for all
  using (true)
  with check (true);

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
alter table public.obd_logs enable row level security;
alter table public.vehicles enable row level security;
alter table public.trips enable row level security;
alter table public.gps_points enable row level security;

drop policy if exists vehicles_anon_select on public.vehicles;
create policy vehicles_anon_select
  on public.vehicles for select
  using (true);

drop policy if exists vehicles_anon_insert on public.vehicles;
create policy vehicles_anon_insert
  on public.vehicles for insert
  with check (true);

drop policy if exists vehicles_anon_update on public.vehicles;
create policy vehicles_anon_update
  on public.vehicles for update
  using (true)
  with check (true);

drop policy if exists vehicles_anon_delete on public.vehicles;
create policy vehicles_anon_delete
  on public.vehicles for delete
  using (true);

drop policy if exists trips_anon_select on public.trips;
create policy trips_anon_select
  on public.trips for select
  using (true);

drop policy if exists trips_anon_insert on public.trips;
create policy trips_anon_insert
  on public.trips for insert
  with check (true);

drop policy if exists trips_anon_update on public.trips;
create policy trips_anon_update
  on public.trips for update
  using (true)
  with check (true);

drop policy if exists trips_anon_delete on public.trips;
create policy trips_anon_delete
  on public.trips for delete
  using (true);

drop policy if exists gps_points_anon_select on public.gps_points;
create policy gps_points_anon_select
  on public.gps_points for select
  using (true);

drop policy if exists gps_points_anon_insert on public.gps_points;
create policy gps_points_anon_insert
  on public.gps_points for insert
  with check (true);

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

drop policy if exists obd_logs_anon_select on public.obd_logs;
create policy obd_logs_anon_select
  on public.obd_logs for select
  using (true);

drop policy if exists obd_logs_anon_insert on public.obd_logs;
create policy obd_logs_anon_insert
  on public.obd_logs for insert
  with check (true);
