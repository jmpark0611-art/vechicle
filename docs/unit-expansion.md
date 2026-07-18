# Unit Expansion Guardrail

This note records the safe path for expanding from the current 2 test units to about 30 units.

## Core Rule

Treat unit expansion as a Supabase schema and data-layer migration first, then a UI option expansion second.

The recent regressions happened because the app started writing unit-aware columns before production Supabase had those columns. Avoid repeating that pattern.

## Required Supabase Columns

Apply `docs/schema.sql` and confirm these columns exist before shipping a unit-expanded APK:

- `vehicles.unit_code`
- `trips.unit_code`
- `speed_zones.unit_code`
- `speed_zones.zone_kind`
- `speed_zones.polygon_points`

## Implementation Rules

- Keep unit definitions centralized in `lib/unit.ts` or the `units` table.
- Do not duplicate hard-coded unit lists in individual screens.
- Pass `unit_code` only through data-layer functions such as `lib/readonly-data.ts` and `lib/location-data.ts`.
- Keep legacy fallback paths until every field device has the updated APK and the production Supabase schema is confirmed.
- Do not remove schema fallback logic only because local tests pass.

## Regression Checklist

Test each unit independently:

- Mode selection persists after app restart.
- Driver mode only shows the trip screen.
- Commander mode excludes the driver trip tab.
- Vehicle list filters correctly by unit.
- Vehicle registration blocks duplicate vehicle numbers.
- Vehicle delete works without breaking old trip records.
- Trip start/end works.
- Records and monthly Excel export show only the selected unit's data.
- Diagnosis OBD snapshot saves and displays.
- Maintenance/inspection alerts show for the selected unit.
- Speed-zone save/read works.
- Overspeed alert still fires inside saved zones.

## Next AI Instruction

When asked to expand to 30 units, first inspect Supabase schema compatibility and the data-layer fallback paths. Do not start by changing UI cards or tab layouts.
