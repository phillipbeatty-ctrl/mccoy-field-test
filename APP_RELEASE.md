# McCoy installable app release

The production web build is configured as an installable Progressive Web App.

## Included

- Standalone app manifest and branded maskable icon.
- Network-first service worker with an offline shell.
- Live Supabase lead, assignment, session, and sales traffic is never cached.
- Browser install prompt exposed as **INSTALL MCCOY APP** when supported.
- The installed app opens the same production origin and therefore uses the same authentication, permissions, and production database.

## Native-store continuation

The next native packaging step is to wrap the production origin with the existing Capacitor/native-location work, set the final bundle IDs and signing teams, then generate signed Android and iOS release builds. Store signing credentials and developer-account identifiers must remain outside the repository.
