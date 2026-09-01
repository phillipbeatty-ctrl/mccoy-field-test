# Field Coach beta 4 logo failure analysis

## /ATTACK

A logo build can be green while still shipping the wrong art if tests verify only dimensions or nonblank pixels. Beta 4 therefore locks the source bytes and decoded pixels before evaluating derivatives.

## /HOLES

The source, browser cache, PWA icons, Apple touch icon, generated Android resources, compiled APK resources, version identity, download link, and preview all require separate verification.

## /STEELMAN

The beta 3 vector pipeline was deterministic and prevented blank launcher files. Beta 4 retains those strengths while replacing the reconstructed master with the owner-approved upload.

## /SOWHAT

One incorrect master asset propagates to every installation surface. Locking the approved source stops future builds from silently spreading a substitute.

## /ODDS

Confidence is high only after source hashes, pixel equality, generated assets, APK-extracted assets, CI, and the Vercel preview all pass. A single failure blocks promotion.

## /PLAINLY

Do not ship a recreated logo. Ship derivatives of the approved upload and nothing else.

## /NEXT

Complete the branch CI and preview gates, then promote the exact reviewed head.

## /FAILHOW

The correction fails if the source changes without approval, derivatives crop the composition, stale cache/build numbers remain, an old APK link survives, CI skips APK extraction, or production is promoted before preview verification.
