# Field Coach beta 4 preview acceptance

Do not promote this branch until every automated check is green and the preview shows the approved artwork on each applicable surface.

## Browser and PWA

- [ ] Main app sidebar uses the approved full composition.
- [ ] Login and account-access branding use the approved full composition.
- [ ] Installation center uses the approved derivative.
- [ ] Browser favicon is visible and nonblank.
- [ ] PWA 192, 512, and maskable icons are visible and nonblank.
- [ ] iPhone/iPad Apple touch icon is visible and nonblank.
- [ ] Service worker reports `field-coach-app-shell-v5-20260901-beta4-approved-logo`.

## Android package

- [ ] APK application label is Field Coach.
- [ ] Package ID is `com.mccoyplatform.app`.
- [ ] Version name is `1.0.0-beta.4`.
- [ ] Version code is `4`.
- [ ] Target SDK is 36.
- [ ] Launcher icon is the approved composition and not the beta 3 vector reconstruction.
- [ ] Splash artwork is the approved composition.
- [ ] The beta 4 APK updates beta 3 rather than installing a second application.

## Data and access regression boundary

- [ ] No Supabase migration is included.
- [ ] No Edge Function deployment is included.
- [ ] No Auth, Resend, lead, assignment, session, sale, compensation, or provider record changes occur.
