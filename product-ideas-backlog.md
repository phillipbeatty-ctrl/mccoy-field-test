# Product Ideas Backlog

Ideas logged for future consideration -- not committed work, not scheduled.
Each entry records the idea, the relevant existing code, and why it was logged
rather than acted on immediately.

---

## Demo Leads as a customer-facing sales/tutorial tool

**Logged:** 2026-09-17

**Idea:** The existing "Add Demo Leads" admin feature (`app-lead-pool.js`,
`app-part1.js`, `app-lead-pool-layout.js`) could be developed into a proper
tutorial/demo mode for showing the app's capabilities to potential customers,
rather than remaining a minimal internal admin utility.

**Current state, as it exists today:** an admin-only button (hidden and
disabled for any non-admin role) that seeds exactly 10 synthetic lead pins
(`isDemo: true`, synthetic IDs starting at 200000) into the map view. These
pins are explicitly excluded from every real workflow action -- starting a
door visit, processing a sale -- via `isDemo !== true` guards in
`app-door-workflow-core.js`. No database persistence at all; it's pure
client-side state, cleared automatically for non-admins and on reload.

**Why logged rather than built:** raised during an assessment of whether this
feature could be removed for performance reasons (it couldn't meaningfully
help -- see D4 of that assessment: zero database footprint, ten in-memory
objects, admin-only). The idea of repurposing it as a customer-facing demo
tool is a separate, forward-looking product direction, not a fix to anything
broken today.

**What "developing this further" would likely involve, if picked up later:**
a richer, more realistic seeded dataset (varied stages, pin colors, a
plausible address spread); a guided walkthrough or scripted narrative that
uses the seeded leads to demonstrate specific features (the door-workflow,
the compensation dashboard, the bonus system); and a clear, deliberate
decision about whether this becomes reachable outside the current
admin-only gate if it's meant for prospective customers to use directly
rather than being admin-driven during a live demo.

**Status:** idea only. No code changes made. The existing feature is
untouched and continues to work exactly as it does today.

---

## Objection-handling / response cards

**Logged:** 2026-09-18
**Priority:** Low, per owner direction.

**Idea:** In-app reference cards helping reps respond to common customer
objections during a door-knock (price concerns, "I need to think about it,"
competitor comparisons, etc.).

**Status:** Idea only, not scoped or designed. Would need actual training
content written (not just a mechanism), likely coordinated with whoever owns
sales training material today.

---

## Additional uses for confirmed-address history data

**Logged:** 2026-09-18

**Idea:** The confirmed-address history built for the predictive next-address
feature (`app-confirmed-address-history.js`) has uses beyond that one
feature, since it's effectively a timestamped record of where and when a rep
was genuinely working:

- **Work-pattern verification:** distinguishing a rep actively knocking
  doors from one who is "going about their day doing errands," based on the
  pacing and structure of confirmed stops.
- **Fraud detection:** flagging reps who may be gaming hard-work bonus
  payouts without genuinely closing sales. Explicitly deferred by the owner
  until the company has a larger reserve fund -- not to be built now.
- **Coverage-pattern analysis:** distinguishing genuinely efficient
  neighborhood coverage from a rep who simply wrapped around at the end of a
  street or worked a cul-de-sac loop, which could otherwise look similar in
  raw movement data.

**Status:** Idea only. None of this is built. The underlying history data
already exists as of this session; these are directions for using it later,
not current functionality.

---

## Gamification roadmap (owner-prioritized, 0-10, 1=build first, 10=build last)

**Logged:** 2026-09-18

1. Rewards-based system (badges, credits, personalization store) — **1, build first**
2. User-created personal goals — **2**
3. Door-knock competitions (vs. others and own records) — **3**
4. Simple user-to-user competitions — **4**
5. Animation gamification — **5**
6. Streak insurance (grace-day banking against loss-aversion) — **6**
7. Conquering-area gaming (map territory claiming) — **7**
8. Make-it-fun knocking paths (route visualization) — **8**
9. Arcade-style mini-games tied to real actions — **9**
10. In-app games unrelated to work — **10, build last.** Owner refinement:
    rather than a fully disconnected game, use emojis that replicate the
    actual work reps are doing (a door icon, a house, a handshake) so the
    "unrelated" game stays thematically tied to the job even while not
    being functional -- directly softens the concern flagged for this idea
    (a work-unrelated game has a built-in incentive to pull attention away
    from selling). Not built -- last in the queue by design.

None of items 1-10 above are built yet. All are ranked and ready to build
in this order when picked up.

## Sales Games — built this session

**Built:** 2026-09-18, per owner direction (priorities: best-answer
mini-game = 1, Sales Coaching content bank = 2, Feel-Felt-Found/LAER content
= 3, commercial flashcard decks = 5/skipped).

- **New feature: Sales Coaching** (`app-sales-coaching.js`,
  `supabase/functions/sales-coaching/`). Did not previously exist under any
  name -- built from scratch, not added to an existing area.
- **Best-answer mini-game** (priority 1): live, seeded with 3 real
  objection/response sets built on Feel-Felt-Found and LAER (public,
  non-proprietary frameworks -- no licensing concern).
- **Admin-editable tip bank** (priority 2): live, seeded with 3 real
  door-to-door tactics from the session's research (time-of-day re-knocking,
  referral-based expansion, benefit-framed openers). Admins can add, edit,
  and delete both tips and mini-game questions directly in the app.
- **Commercial flashcard decks** (priority 5): skipped, as directed --
  paid products, not used as source material.

---

## Gamification build-out (2026-09-18)

**Built and live, real schema and tested logic, not stubs:**

- **Rewards system (priority 1):** an append-only points ledger, awarded
  automatically from real door knocks (+1) and real sales (+25) via the
  existing `mccoy-door-visit-completed` / `mccoy-sale-saved` events -- never
  from time spent in the app. A badge catalog (First Knock, First Sale,
  Week Strong, Marathon Month, Century Day) and a personalization store
  (5 cosmetic app-color themes, real CSS, not decorative-only) that points
  can be spent on.
- **Personal goals (priority 2):** rep-set daily/weekly targets for doors
  or sales, tracked against real activity.
- **Door-knock competitions, others + own records (priority 3):** personal
  bests (best day ever, doors and sales) computed from real history.
- **Simple user-to-user competitions (priority 4):** a live today's-doors
  leaderboard across the organization.
- **Animation gamification (priority 5) + Arcade-style mini-games
  (priority 9):** built as one shared visual-feedback module, since both
  are the same delivery mechanism at different intensities -- a subtle
  score-pop on every door knock, a bigger celebration sequence on a sale,
  and a badge-unlock toast.
- **Streak insurance (priority 6):** a real "days worked" streak (at least
  one door visit that day), with the grace-day banking mechanic as
  designed -- 1 banked day every 7 consecutive days worked, capped at 3,
  automatically consumed to cover a missed day rather than resetting the
  streak to zero. Verified against a hand-built scenario (8 days worked,
  1 missed, 1 more worked -- streak correctly survived at 9 with the
  banked day consumed).
- **In-app game unrelated to work (priority 10):** built as "Door Dash," a
  standalone, opt-in 30-second timing game using door/handshake/closed-door
  emojis specifically per the owner's refinement (mirrors the real job
  rather than being fully disconnected). Entirely separate from the core
  workflow -- earns no real points, affects no real record.

**Two real bugs caught and fixed during testing, not shipped broken:**
1. The streak-evaluation function initially referenced the wrong schema
   (`private.rep_work_streaks` instead of `public.rep_work_streaks`) --
   caught immediately when the first test run errored.
2. The streak function's first-ever run for any rep would have silently
   produced a permanent zero streak for everyone, because the default
   starting date made its own loop's start and end conditions identical.
   Caught by manually verifying the test scenario's output against hand
   computation before trusting it, not by assuming the code was correct
   because it ran without error.

**Not yet built, still open:**
- **Conquering-area gaming (priority 7)** and **Make-it-fun knocking paths
  (priority 8)** -- both need real map/geospatial integration work
  (street-level territory claims, route-trail visualization) that wasn't
  attempted in this pass, to avoid rushing the more novel, higher-risk
  pieces of this list alongside everything above.



