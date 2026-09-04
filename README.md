# Baseline

A 90-day body-composition tracker. Photo-based food logging, trend analysis, and a weekly review that mostly tells you to change nothing.

Frameworkless PWA — plain HTML, CSS and ES modules. No build step, no bundler, no npm install. Same stack shape as Receipt360; the code organisation is different (see below).

---

## Run it

```
python3 -m http.server 8080      # or any static server
open http://localhost:8080
```

Service workers and IndexedDB both need a secure origin, so `localhost` or HTTPS. `file://` will not work.

**Deploy:** push to a GitHub Pages branch. Nothing to compile.

## The AI proxy

The API key must never be in the bundle, so meal photos go through a Cloudflare Worker.

```
cd worker
wrangler secret put ANTHROPIC_API_KEY
wrangler deploy
```

`wrangler.toml`:

```toml
name = "baseline-proxy"
main = "worker.js"
compatibility_date = "2026-01-01"

[vars]
ALLOWED_ORIGIN = "https://<you>.github.io"
MODEL = "claude-sonnet-5"
```

Then paste the Worker URL into **Profile → Food estimator**. Three routes: `/vision`, `/refine`, `/coach`.

Without a proxy the app still runs — search, quick add, all the trend maths, and a locally-written weekly review. Only photo estimation needs the network.

---

## Architecture

```
index.html            shell
styles.css            design tokens + components
service-worker.js     offline cache — bump CACHE on every deploy
manifest.webmanifest

src/
  main.js             boot, route table, reminders
  core/
    dom.js            h() / svg() / fill() — real nodes, never innerHTML
    db.js             IndexedDB, 10 stores, promise wrapper
    store.js          state + actions + pub/sub
    router.js         hash routing with view lifecycle
    format.js         dates, units, rounding
  domain/             all the maths, zero DOM
    targets.js        Mifflin-St Jeor, macro splits, observed expenditure
    trends.js         rolling mean, EMA, least-squares slope, weekly grouping
    engine.js         state classification, adjustment rules, confidence, consistency
    foods.js          food table, portion priors, meal memory, oil arithmetic
    questions.js      the weekly questionnaire
  services/
    ai.js             vision + coaching calls, prompts, JSON parsing, fallbacks
    image.js          downscale, EXIF-correct, thumbnail
    firebase.js       lazy CDN load, Google auth, Firestore handles
    sync.js           mirrors local writes to Firestore, merges remote, streams partner
  ui/
    chart.js          hand-drawn SVG line and bar charts
    components.js     sheet, toast, stepper, chips, nav
  views/              one module per screen
worker/worker.js      Cloudflare proxy
firestore.rules       mutual read, own-write-only
src/config.example.js copy to src/config.js and fill in
```

Three rules the code follows throughout:

1. **Views never do maths.** Everything in `domain/` is pure and testable without a DOM. `engine.js` decides; views render.
2. **No whole-page re-render.** Each view returns `{ el, update(state) }` and mutates only the nodes that changed. That is what fixes the focus-loss and scroll-jump problems that come with a single global `render()`.
3. **No `innerHTML`.** Every node is built with `h()`, so model output and user text can never become markup.

### Tests

```
node tests/run.mjs        # 54 tests, no dependencies, no install
```

`domain/` has no DOM dependency, so the decision layer runs under Node directly. That is where the tests are, because that is the part that can be quietly wrong — a UI bug is visible the first time you open the screen, a classification bug tells you to cut 150 calories for a month for no reason.

What is covered:

- **Date arithmetic** — month boundaries, leap day, Monday-anchored weeks.
- **Targets** — Mifflin-St Jeor against the published equation, macros summing back to the calorie target, protein tracking bodyweight rather than calories, the floor holding under an aggressive rate.
- **The bias-cancellation claim**, explicitly: someone under-logging by 20% still receives a target that puts them at a true 500 kcal deficit. Plus the cases where the property is refused — thin coverage, absurd results, drifting bias.
- **Trend maths** — a 3 lb overnight spike moves the 7-day trend by under 0.5 lb; gaps become nulls rather than zeros.
- **Strength** — one wrecked session does not flag a decline; a sustained one does.
- **The full decision table** — all seven states, each asserted from synthetic history.
- **The distinction the whole design rests on**: identical flat scale data classified three different ways at 100%, 70% and 35% logging coverage.
- **Adjustment rules 1–3**, including that poor adherence is never answered with a calorie cut.
- **Food** — priors needing three corrections, medians resisting a fat-finger entry, unlogged days ignored rather than counted as zero.

### Demo data

Open `#/dev`. Six scenarios — on track, recomposition, deficit too steep, genuine plateau, the same plateau with half the week unlogged, and day 4. Each card shows what the engine concludes *before* you load it, so you can check the verdict without committing.

These are the same scenarios the tests assert on, generated by the same code (`src/dev/scenarios.js`), so demo data and test fixtures cannot drift apart. Loading one replaces the database. It is not linked from the UI.

---

## PRD coverage

Everything in the spec is built. Sections map to files as follows.

| PRD | Where |
|---|---|
| §5 Setup, baseline, goal config | `views/onboarding.js`, `domain/targets.js` |
| §6–7 Navigation, home dashboard | `views/home.js`, `ui/components.js` |
| §8–13 Photo logging, recognition, portions, confidence | `views/food.js`, `services/ai.js` |
| §14 Indian food | `domain/foods.js` + the vision system prompt |
| §15 Recipe / oil intelligence | `views/food.js` (asked locally, added arithmetically) |
| §16–17 Search, quick add, repeat, saved meals, meal memory | `views/food.js`, `domain/foods.js` |
| §18–19 Nutrition dashboard, macros as guidelines | `views/home.js` |
| §20–22 Weight entry, trend algorithm, chart | `domain/trends.js`, `ui/chart.js` |
| §23–24 Waist, progress photos, slider compare | `views/progress.js` |
| §25 Photo privacy | local-only Blobs; no upload path exists in the codebase |
| §26–27 Strength logging and trend | `views/training.js`, `engine.strengthStatus` |
| §28–31 Steps, sleep, energy, daily check-in | `views/home.js` |
| §32–33 Weekly review and interpretation | `views/insights.js`, `services/ai.js` |
| §34 Fat-loss confidence | `engine.fatLossConfidence` |
| §35 Trend states | `engine.classify` |
| §36 Adjustment engine | `engine.recommendAdjustment` |
| §37 Water-weight explanation | `engine.fluctuationNote` |
| §38 Weekly questions | `domain/questions.js` |
| §39 Four-part coaching output | `services/ai.js` coach prompt |
| §40 Correction feedback loop | `store.recordCorrection`, `foods.portionPrior` |
| §41–43 Confidence levels, follow-ups, restaurant mode | `views/food.js` |
| §44 Meal timeline | `views/food.js` |
| §45 Notifications | `main.js` (three, in-app) |
| §46 Consistency score | `engine.consistencyScore` |
| §47–48 Timeline and day-90 report | `views/progress.js`, `views/insights.js` |
| §49 Data model | `core/db.js` |
| §50 Three separate AI jobs | `services/ai.js` + `worker/worker.js` |
| §51 Safety | Profile page; no diagnosis anywhere; calorie floor in `targets.js` |
| §52–54 MVP / v2 / v3 staging | all built; personalised portions are live, wearable sync is not |

## Two people, separate plans

The PRD assumes one user. It is built for two, and that is a partitioning problem rather than a sharing one — if both sets of weigh-ins landed in one series the trend engine would average two people together and every conclusion would be wrong.

**How it works.** Each person owns `baseline_users/{uid}` and writes only there. The rules allow either member to *read* either space and only the owner to *write* it, so a shared view can never corrupt a plan. The partner's records are streamed into `state.partner` in memory and are never written to the local database — that is the structural guarantee that the two record sets cannot mix.

**One switcher, every screen.** Views read through `view()` instead of touching `state`, so a single You/<name> control at the top of Home, Food, Progress, Training and Insights re-renders any of them against the other person's data. This works because `domain/` was already pure and took state as an argument — running the engine over someone else's history is the same function with a different argument. No maths changed.

**Photos never sync.** Not "sync disabled" — there is no upload path in the codebase, and `scrub()` in `sync.js` strips Blobs before anything is written. Viewing the other person's Progress screen shows an explicit note rather than an empty grid.

**Writes are hidden, not disabled, when viewing the other person.** A greyed-out button invites a tap and then explains why it did nothing.

**Local-first, sync second.** Every write hits IndexedDB and is queued for Firestore afterwards, so the app behaves identically signed out and on a dead connection. Merges are last-write-wins on `updatedAt`, which is the right call here and would not be for a shared document: these are single-author records, so two versions of one weigh-in mean the same person edited it twice on two devices.

## Where this deviates from the PRD, and why

**1. Expenditure is measured, not assumed.** §36 sets calorie changes from a fixed table (−100 to −150 kcal). The app already holds everything needed to compute expenditure directly: intake minus the change in trend weight equals calories out. `targets.observedTDEE` does that, and after two weeks the adjustment comes from the measurement rather than the table. The useful property is that a *consistent* logging bias cancels — under-log by 20% and the computed expenditure comes out 20% low, so the target it hands back is still correct in your own logging units. `biasStability` checks the bias is actually consistent across two windows before anything leans on it.

**2. Plateau and poor adherence are not separated by calories alone.** §35 splits STATE 4 from STATE 5 on whether the calorie target was hit — but photo-estimated intake cannot settle that, and those two states have opposite prescriptions. `intakeTrust` gates it instead: below 60% logging coverage the engine calls it poor adherence; between 60 and 85% it returns UNDECIDED rather than guessing. It never recommends a calorie cut off a week it cannot see.

**3. Cooking oil is asked, never inferred.** §15 asks about oil; this build makes it structural. The vision prompt is explicitly told not to guess at cooking fat, and the app adds it arithmetically from the user's answer. On home-cooked gravy it is the single largest error term.

**4. Six of the fourteen weekly questions were removed.** Sleep average, energy average, workouts completed, protein, waist change and calorie adherence are all already in the database. Asking a person to re-answer what the app measured is how a 30-second check-in becomes a chore nobody finishes. `domain/questions.js` keeps only what the sensors cannot see.

**5. Nav is five tabs, not six.** Profile lives behind the header link. Six bottom-bar targets on a phone is a mis-tap generator.

**6. Estimates carry a range everywhere except the total.** §13 asks for internal ranges; entries store `range` alongside the point value, so the weekly engine can tell a week of confident logs from a week of guesses.

**7. Strength needs five sessions of a lift, not four.** §27 says not to flag a single bad workout. A mean of the last two sessions against the two before them lets one wrecked session swing the verdict by a third, which is precisely that false alarm. The engine compares medians of three against three instead. This was found by a test, not by reading the code.

## Known limits

- Steps and sleep are manual. HealthKit is not reachable from a PWA on iOS — that needs a native shell or a Shortcuts automation writing into the export format.
- Portion priors need three corrections per food before they apply, so the first fortnight runs on the model's estimates alone.
- Progress photos live in IndexedDB and are included in no backup and no sync. Export JSON deliberately excludes them; if you clear site data they are gone. This is the accepted cost of keeping them out of a cloud bucket.
- Partner data needs a connection on first load of a session. It is held in memory, not cached locally, so the switcher is empty until the streams attach.
- The email allowlist in `config.js` is a courtesy check for a clear error message. The Firestore rules are the actual control.
- Sauced and layered dishes are the weakest case for photo estimation. That is why the app is built to be right about the *trend* even when it is wrong about a meal.
