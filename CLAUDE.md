# CLAUDE.md — Baseline

Read this file, not the whole tree. It is the map. `README.md` is the rationale
(why decisions were made); `DEPLOY.md` is the runbook. Open those only when the
task actually needs them.

## What this is

A 90-day body-composition tracker PWA. Photo food logging → IndexedDB → a pure
decision engine that classifies the week and recommends at most one adjustment.
Two users (Shubham + wife), separate plans, partitioned not shared.

Frameworkless: plain HTML, CSS, ES modules. **No build step, no bundler, no
`npm install`.** Anything that adds one is a change of direction, not a fix.

## Commands

```bash
python3 -m http.server 8080     # serve; localhost or HTTPS only, file:// breaks SW+IDB
node tests/run.mjs              # 70 tests, zero deps. Expect 70/70.
open http://localhost:8080/#/dev  # six demo scenarios, unlinked from UI
```

Deploy = push to GitHub Pages. Proxy = `cd worker && wrangler deploy`.
**Bump `CACHE` in `service-worker.js` on every deploy** or users get stale JS.

## Layout

```
src/core/      dom.js h()/svg()/fill() · db.js IndexedDB (10 stores) ·
               store.js state+actions+pubsub · router.js hash routes · format.js
src/domain/    pure, no DOM, this is where the tests live
               targets.js  Mifflin-St Jeor, macros, observedTDEE, biasStability
               trends.js   rollingMean, ema, slopePerDay, weeklySlope, groupByWeek
               engine.js   classify, recommendAdjustment, intakeTrust,
                           strengthStatus, fatLossConfidence, consistencyScore
               foods.js    FOOD_DB (each row has a `serving` piece weight),
                           portionPrior, defaultGrams, densityOf, usualMeals,
                           oil arithmetic
               questions.js weekly questionnaire (8 kept of PRD's 14)
src/services/  ai.js (vision/refine/coach + local fallbacks) · image.js ·
               firebase.js (lazy CDN) · sync.js (mirror + partner streams)
src/ui/        chart.js hand-drawn SVG · components.js sheet/toast/stepper/chips/nav
src/views/     one module per screen: home food progress training insights
               profile onboarding account dev
worker/        Cloudflare proxy, 3 routes: /vision /refine /coach
```

## Invariants — do not break these

1. **Views never do maths.** `domain/` is pure and takes state as an argument.
   `engine.js` decides, views render. This is what makes the two-person
   switcher and the whole test suite possible.
2. **No `innerHTML`, ever.** Every node is built with `h()`. Model output and
   user text must never become markup.
3. **No whole-page re-render.** Each view returns `{ el, update(state) }` and
   mutates only changed nodes. A global `render()` reintroduces focus loss and
   scroll jump.
4. **Views read `view()`, never `state`.** That is the You/Partner switcher.
   Exception: reminders in `main.js` read `state` on purpose — you are never
   nudged about someone else's protein.
5. **Views never touch `db` directly.** Call a store action; it writes local
   first, queues sync second.
6. **Progress photos never leave the device.** There is no upload path in the
   codebase and `scrub()` in `sync.js` strips Blobs. Do not add one.
7. **The store must not import `sync.js`** — cycle, and it would make the store
   untestable. `main.js` installs hooks via `setSyncHooks`.
8. **Weight and length units are independent.** `profile.weightUnit`
   ('kg'|'lb') and `profile.lengthUnit` ('cm'|'in'), read through
   `weightUnit()` / `lengthUnit()` in format.js, which fall back to the
   pre-split `profile.units` so old profiles keep working. Nothing should read
   `profile.units` directly again. kg + inches is a supported combination, so
   a single `units === 'metric'` branch anywhere is a bug.
9. **Changing a unit converts the history.** Weigh-ins and waists are stored in
   the unit they were typed in, not canonically, so `changeUnits()` in the
   store rewrites every record. Never flip the unit field on its own — 199 lb
   of baseline would reread as 199 kg.

## State shape (`core/store.js`)

`{ ready, profile, settings, weights[], waists[], food[], workouts[],
   metrics{byDate}, photos[], savedMeals[], corrections[], reviews[],
   partner, viewing:'self'|'partner', auth }`

`profile` is `null` until onboarding completes — every route is guarded on
`profile.programStart`. `partner` is in-memory only, never written to IndexedDB;
that separation is the structural guarantee two people's weigh-ins can't mix.

IndexedDB stores: `kv weights waists foodEntries workouts dailyMetrics photos
savedMeals corrections reviews`. DB_VERSION 1 — bump it and write an upgrade
path if you change `SCHEMA`.

Firestore: each person owns `baseline_users/{uid}`; rules are mutual-read,
own-write-only. 8 synced collections (photos absent by design). Merge is
last-write-wins on `updatedAt` — valid only because these are single-author
records.

## Engine states

`on_track · recomposition · excessive_deficit · plateau · poor_adherence ·
undecided · baseline`

The design rests on one distinction: identical flat scale data classifies
differently at 100% / 70% / 35% logging coverage. `intakeTrust` gates it —
below 60% coverage it's poor adherence, 60–85% returns `undecided`. **The engine
never recommends a calorie cut off a week it cannot see.** If a change makes
poor adherence answerable with a deficit, it's wrong.

Deadbands are unit-aware (`bands(weightUnit, lengthUnit)` in engine.js) — the
two tables are independent and neither is a conversion of the other. Weight
bands come from the weight unit, the waist band from the length unit.

## Deliberate deviations from the PRD

Documented in README "Where this deviates". Short version, so they don't get
"fixed" back: expenditure is measured (`observedTDEE`) not table-driven;
plateau vs. adherence splits on coverage not calories; cooking oil is asked and
added arithmetically, never inferred by the model; 6 of 14 weekly questions
removed because the DB already knows the answers; 5 nav tabs not 6; strength
needs 5 sessions and compares medians of 3 vs 3.

## Gotchas

- `src/config.js` is gitignored and may not exist. Missing config is a
  supported mode (local-only), not an error.
- The email allowlist in config is a courtesy message. Firestore rules are the
  control. Don't treat the client check as security.
- `src/{core,domain,services,ui,views}/` is an empty stray directory from a
  shell brace-expansion that didn't expand. Safe to delete.
- Demo scenarios and test fixtures come from the same `src/dev/scenarios.js`, so
  they cannot drift. Keep it that way.
- Steps and sleep are manual — HealthKit is unreachable from a PWA on iOS.
- Portion priors need 3 corrections per food before they apply. Below that the
  default is the food's own `serving` weight (one egg, one roti), and only then
  a flat 150 g. Hand-added foods used to skip straight to 150 g, which logged
  one boiled egg as three.
- **A refill is not a correction.** An item raised past `aiGrams` asks why, and
  `item.refilled` suppresses `recordCorrection` for it. Photographing two puris
  and eating four must not teach the prior that a photo of two puris means
  four — three of those and the app inflates every future plate on its own.
  The "I went back for more" button on a logged meal always sets the flag.
- Food search is token-based: every word must appear in the name or tags, in
  any order. A single-substring match could not find "Whole egg (boiled)" from
  "boiled egg".
- FOOD_DB provenance is in the file header: USDA FoodData Central for generic
  foods, IFCT 2017 for Indian ones, recipe-derived (±20%) for Indian composite
  dishes. A test checks every row against the Atwater identity, with alcohol
  and high-fibre foods named as exemptions.
- The app works with no proxy: search, quick add, all trend maths, and a locally
  written weekly review. Only photo estimation needs the network.

## Working style

Shubham wants challenge-first, confidence-tagged ([Certain]/[Likely]/[Guessing]),
no agreement openers, no padding, and no unsolicited redesigns of approved work.
Tests are the check on `domain/` — run them before claiming a change is safe.
