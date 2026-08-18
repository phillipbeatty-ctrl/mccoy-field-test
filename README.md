# McCoy Field — Test App

Basic browser test build for the McCoy Platform LLC D2D Rep Efficiency Project.

## Run it

### Easiest
Double-click `index.html`.

### Better for GPS testing
Serve the folder on localhost:

```bash
python3 -m http.server 8080
```

Then open:

```text
http://localhost:8080
```

Browsers generally allow geolocation on localhost. A production deployment should use HTTPS.

## What this test build includes

- Dashboard with 10,000-lead company allocation
- Pacific Northwest team — Aaron Ruff manager
- North Carolina team — intentionally no manager
- Admin workflow to assign Phillip Beatty as North Carolina manager
- Lead pool filtering/searching
- Demo lead generation
- Start/stop field session
- GPS capture
- Door dispositions
- Basic field stats
- Supabase project configuration already present

## Why live database rows are not shown yet

The live Supabase database is secured with Row Level Security and the real app is designed around authenticated users. This demo deliberately avoids creating fake Auth users or weakening those policies.

Next step for a true multi-user test: create/login real Supabase Auth users for Phillip and Aaron, then switch the data layer from the in-browser demo state to the live tables.

## Version 2 efficiency tracking

This build adds:
- Live GPS watch during an active field session
- GPS snapshot at every disposition
- ARRIVE AT DOOR / START VISIT button
- Arrival timestamp + GPS
- Disposition timestamp + GPS
- Time-at-door (dwell time) calculation
- Door-time efficiency averages by disposition
- Route breadcrumb capture in demo memory

For the production native app, lead geofencing can automate arrival detection when the rep enters the configured radius around a mapped lead.

## Version 3 responsiveness change

Version 3 removes blocking GPS calls from the ARRIVE and disposition buttons.

- START KNOCKING begins a continuous `watchPosition` GPS stream.
- ARRIVE AT DOOR starts the timer immediately and snapshots the most recent live GPS fix.
- Disposition buttons update immediately and snapshot the most recent live GPS fix at click time.
- A fresh high-accuracy GPS request can run in the background for diagnostics, but it does not block the UI.
- The activity log displays GPS fix age so testers can see how fresh the click-time location was.

This is closer to the production native-app design, where location is continuously available while the field session is active.

## Version 4 live test telemetry

Version 4 writes testing telemetry into the live Supabase project using dedicated insert-only test tables.

Saved automatically:
- test session start
- session start GPS
- GPS breadcrumbs about every 5 seconds while the browser supplies location updates
- door arrival time + GPS
- disposition time + GPS
- GPS fix age
- dwell time
- session end GPS

The browser is permitted to INSERT test telemetry only. It is not granted SELECT access to these test tables.

After running a test, ask ChatGPT to analyze the latest test and the telemetry can be queried directly from Supabase.

## Version 5 — phone GPS quality testing

Every location measurement is now classified:

- Verified: accuracy <= 25 m AND fix age <= 5 seconds
- Acceptable: accuracy <= 50 m AND fix age <= 10 seconds
- Poor: accuracy <= 100 m AND fix age <= 10 seconds
- Stale: fix age > 10 seconds
- Unverified: no GPS or accuracy > 100 m

Only Verified is marked GPS verified.

The build also includes a local calibration lead workflow:
1. Start Knocking.
2. While physically at the known test address, press SET CURRENT LOCATION AS TEST LEAD.
3. Use that coordinate as the ground-truth test lead.
4. Arrival and disposition events show distance from that calibrated point.
5. Telemetry writes GPS quality, verification boolean, lead coordinates, and distance-to-lead to Supabase.

For a meaningful phone GPS test, serve this app over HTTPS. Mobile browsers generally require a secure context for geolocation.

## Version 6 — adaptive GPS thresholds

Updated quality thresholds:
- Verified: accuracy <= 15 m AND fix age <= 5 seconds
- Acceptable: accuracy <= 30 m AND fix age <= 10 seconds
- Poor: accuracy <= 50 m AND fix age <= 10 seconds
- Stale: fix age > 10 seconds
- Unverified: no GPS or accuracy > 50 m

Important: Version 6 does NOT increase continuous GPS polling just to achieve these tighter thresholds.
The intended production strategy is adaptive:
- routine route tracking at a conservative cadence
- increase precision as the rep approaches a selected lead
- high-quality snapshots at door arrival and disposition
- fall back to lower-power tracking after the event

This is intended to balance proof-of-presence, coaching quality, battery life, and data usage.
