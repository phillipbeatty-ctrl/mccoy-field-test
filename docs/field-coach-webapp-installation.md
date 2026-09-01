# Field Coach web app installation and release download

Field Coach is distributed to iPhone and iPad users as an installable production web app. The public installation method is Safari **Add to Home Screen**, not an IPA, TestFlight build, App Store purchase, configuration profile, or downloaded ZIP.

## Production routes

- Installation center: `https://mccoyplatform.com/download.html`
- iPhone and iPad guide: `https://mccoyplatform.com/install-ios.html`
- Application: `https://mccoyplatform.com/`

The installation pages use external JavaScript controllers because the production Content Security Policy intentionally rejects inline scripts.

## Administrator release archive

The `Field Coach Web App Download` GitHub Actions workflow builds:

- `Field-Coach-Web-App-1.0.0-beta.2.zip`
- `Field-Coach-Web-App-1.0.0-beta.2.zip.sha256`
- `field-coach-web-release.json`
- `README.txt`

The archive contains only allowlisted static web application files and assets. It excludes serverless API handlers, Supabase functions and migrations, scripts, tests, GitHub metadata, documentation sources, dependencies, build output, and environment files.

The ZIP exists for integrity verification and controlled hosting. It is not an iOS installer. Unzipping it in Files would move the app away from its production origin and would not create the required Safari-installed web application.

## iPhone and iPad installation

1. Open `https://mccoyplatform.com/install-ios.html` in Safari.
2. Tap Safari's Share button.
3. Scroll to and select **Add to Home Screen**.
4. Keep the name **Field Coach** and tap **Add**.
5. Open the new Home Screen icon.
6. Sign in with the organization-assigned account.
7. Allow location and camera permissions when Field Coach requests them for field functions.

## Access model

Installing the web app does not grant application access. Server-authoritative organization state, membership, assigned role, and enabled feature entitlements remain the access authority. The installation surface intentionally contains no price, purchase, checkout, subscription, or in-app-purchase action.
