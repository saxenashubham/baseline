# Deploying Baseline

Two things get deployed: a static site (GitHub Pages) and a Cloudflare Worker that holds your Anthropic key. Nothing is compiled.

**Do the site first.** The Worker needs to know your site's exact origin for CORS, and you do not know that until Pages is live. Doing it the other way round means deploying the Worker twice.

Total time: about 20 minutes, most of it waiting for Pages to publish.

---

## What you need

- A GitHub account
- A Cloudflare account (free tier is fine)
- An Anthropic API key from https://console.anthropic.com
- Node 18+ — only for `npx wrangler` and running the tests. The app itself needs no npm install.

---

## Step 0 — Run it locally first

Do not skip this. If it is broken locally it will be broken on Pages, and debugging is far easier here.

```bash
cd baseline
python3 -m http.server 8080
```

Open `http://localhost:8080`. You should land on onboarding.

`file://` will not work — service workers and IndexedDB both need a real origin.

Then look at the app with data in it:

```
http://localhost:8080/#/dev
```

Load "Losing at target". Click through Home, Progress, Insights. Then go back to `#/dev` and load "Flat, but half the week unlogged" and read the Insights screen again. Those two should reach visibly different conclusions from similar-looking scale data — if they do not, something is wrong before you deploy anything.

Run the tests while you are here:

```bash
node tests/run.mjs
```

Expect `54/54 passed`.

---

## Step 1 — Put the site on GitHub Pages

**1a. Create the repo.**

On GitHub: New repository → name it `baseline` → Private is fine (Pages works on private repos for Pro accounts; use Public if you are on Free).

**1b. Push the files.**

```bash
cd baseline
git init
git add .
git commit -m "Baseline"
git branch -M main
git remote add origin https://github.com/<username>/baseline.git
git push -u origin main
```

**1c. Turn on Pages.**

Repo → Settings → Pages → Source: **Deploy from a branch** → Branch: `main`, folder: `/ (root)` → Save.

Wait 1–2 minutes. The page will show your URL:

```
https://<username>.github.io/baseline/
```

**1d. Check it.**

Open that URL on your laptop. You should see onboarding. If you get a 404, Pages has not finished publishing — wait another minute and hard-refresh.

The `.nojekyll` file in the repo root is what stops GitHub from running Jekyll over the files. It is already there; do not delete it.

---

## Step 2 — Deploy the Worker

There are two ways to do this. **The live Worker was set up the dashboard way** —
if you are re-deploying rather than starting fresh, use that path and skip 2a–2d.

<details>
<summary><b>Dashboard path (no Wrangler, no Node)</b></summary>

`worker.js` is a single file with no imports and no build step, so it pastes
straight into the Cloudflare editor. Wrangler buys you nothing here.

1. **Workers & Pages → Create → Start from Hello World → Deploy.** Name it
   `baseline`. You get a URL immediately.
2. **Edit code.** Delete the template, paste the whole of `worker/worker.js`,
   Deploy.
3. **Settings → Variables and Secrets.** Add three, names typed exactly:

   | Name | Type | Value |
   |---|---|---|
   | `ANTHROPIC_API_KEY` | Secret | your key |
   | `ALLOWED_ORIGIN` | Text | `https://<username>.github.io` |
   | `MODEL` | Text | `claude-sonnet-5` |

   Then **Deploy** — saving a variable alone does not always ship it.

Two traps this path has that the CLI path does not:

- **A wrong variable *name* and a wrong *key* produce the identical error.** If
  the name is off by a character, `env.ANTHROPIC_API_KEY` is `undefined`, goes
  upstream as the literal string, and Anthropic answers `invalid x-api-key` —
  indistinguishable from a bad key. Delete and re-add rather than edit.
- **`ALLOWED_ORIGIN` fails open.** Line 25 of `worker.js` reads
  `env.ALLOWED_ORIGIN || '*'`. Misspell it and the proxy accepts every origin
  silently. Prove it with the Origin test in 2e; do not assume.

A GET to the Worker root returning `{"error":"POST only"}` confirms the real
`worker.js` is live rather than the Hello World template.

Do not mix the two paths. A later `wrangler deploy` overwrites dashboard-edited
code and dashboard-set plaintext vars. Secrets survive.

</details>

**2a. Log in.** *(Wrangler path — skip if you used the dashboard.)*

```bash
cd worker
npx wrangler login
```

A browser window opens. Authorise it.

**2b. Set your origin.**

Open `worker/wrangler.toml` and change one line:

```toml
ALLOWED_ORIGIN = "https://<username>.github.io"
```

**Scheme and host only.** No `/baseline`, no trailing slash. An origin is not a URL — `https://you.github.io/baseline/` here is the single most common way to get this wrong, and it fails silently as a CORS error.

**2c. Store the key.**

```bash
npx wrangler secret put ANTHROPIC_API_KEY
```

Paste the key when prompted. It is encrypted at Cloudflare and never appears in the repo, the bundle, or `wrangler.toml`.

**2d. Deploy.**

```bash
npx wrangler deploy
```

You get back a URL:

```
https://baseline-proxy.<your-subdomain>.workers.dev
```

Copy it. That is the base URL — the app appends `/vision`, `/refine` and `/coach` itself.

**2e. Smoke-test it.**

```bash
curl -i -X POST https://baseline-proxy.<sub>.workers.dev/coach \
  -H "Content-Type: application/json" \
  -d '{"system":"Reply with the JSON {\"ok\":true} and nothing else.","payload":{}}'
```

A 200 with a `text` field means the key works and the route is live. A 502 means the key is wrong. A 403 means `ALLOWED_ORIGIN` is rejecting you — `curl` sends no Origin header, so that should not happen here; if it does, you have a typo.

**That test does not check `ALLOWED_ORIGIN`.** It passes whether the origin lock
works or not, because line 35 only rejects an Origin that is *present* and
mismatched. Run this second one to prove the lock is real:

```bash
curl -i -X POST https://baseline.<sub>.workers.dev/coach \
  -H "Content-Type: application/json" \
  -H "Origin: https://not-your-site.example" \
  -d '{"system":"Reply with ok.","payload":{}}'
```

Expect `403 {"error":"Origin not allowed"}`. **A 200 here means your key is open
to anyone who learns the URL.** Fix `ALLOWED_ORIGIN` before logging any meals.

And know what this does and does not buy you: the Origin header stops *browsers*
on other sites. It does not stop `curl`, which can send any Origin it likes. The
check is worth having, but if the URL is public the key's real protection is your
Anthropic spend limit, not this line.

---

## Step 3 — Firebase (two people, separate plans)

Skip this only if you are the sole user and accept that losing the phone loses the programme.

**3a. Create the project.**

https://console.firebase.google.com → Add project. Analytics off — it does nothing for you here.

You can reuse the Firebase project Receipt360 already lives in. Every collection in this app is prefixed `baseline_`, so nothing collides. If you do reuse it, **merge** the rules rather than replacing them, or you will switch Receipt360 off.

**3b. Turn on the two services.**

- **Authentication** → Sign-in method → **Google** → Enable.
- **Firestore Database** → Create database → production mode → pick a region near you.

Under Authentication → Settings → Authorized domains, add `<username>.github.io`. Sign-in fails silently without it.

**3c. Register a web app.**

Project settings → General → Your apps → Web (`</>`). Copy the config object.

```bash
cp src/config.example.js src/config.js
```

Fill in `firebaseConfig`, and put both Google account emails in `ALLOWED_EMAILS`. `src/config.js` is gitignored — those keys are not secrets, but keeping the project id out of a public repo costs nothing.

Because it is gitignored, it will not be in the repo Pages serves. Either commit it deliberately (`git add -f src/config.js`) or, if the repo is public and you would rather not, leave sync off. There is no third option — the client needs the config to reach Firebase.

**3d. Publish the rules.**

Open `firestore.rules`. Both UIDs are placeholders at this point, which is fine — sign-in works, writes are denied. Paste it into Firebase console → Firestore → Rules → Publish.

**3e. Both of you sign in once.**

Open the app, **Sign in with Google**, on each phone. Then Firebase console → Authentication → Users, copy both UIDs into `household()` in `firestore.rules`, and publish again.

Until you do this, sync fails and the app tells you so. It keeps working locally throughout.

**3f. Check it.**

Once both accounts have signed in, a **You / <name>** switcher appears at the top of Home, Food, Progress, Training and Insights. Tap it. Every screen re-renders against the other person's numbers, read-only.

What crosses: weight, waist, meals, workouts, daily metrics, saved meals, portion corrections, weekly reviews. What does not: progress photos, in either direction, by design and with no code path that could.

---

## Step 4 — Connect the two

On your phone, open `https://<username>.github.io/baseline/`.

1. Complete onboarding — age, height, activity, baseline weight and waist, goal and rate.
2. Go to **Profile → Food estimator**.
3. Paste the Worker URL. Tap **Save**.
4. Go to **Food → Photograph a meal** and shoot something real.

If it comes back with items and gram estimates, both halves are working.

---

## Step 5 — Install it on your phone

iOS Safari (this only works in Safari, not Chrome on iOS):

1. Open the Pages URL.
2. Share button → **Add to Home Screen**.
3. Open it from the home screen icon, not from Safari.

This matters for more than the icon. Home-screen web apps get a standalone window, correct safe-area insets, and — importantly — are exempt from Safari's 7-day eviction of script-writable storage. Used from a Safari tab, your data can be cleared after a week of not opening it.

---

## Step 6 — Back it up

With Firebase on, your rows survive a lost phone — sign in on the new one and they come back. **Photos do not.** They are the one thing with no second copy anywhere, which is the price of not putting them in a cloud bucket.

Signed out, nothing has a second copy.

**Profile → Export JSON**, weekly, either way. Firebase protects you from a dead phone, not from a bad rules publish or a fat-fingered delete.

Note what the export does *not* include: progress photos. They are deliberately excluded — they are the most sensitive thing in the app and the export is the easiest place to leak them. If you want them backed up, save them out of Photos separately.

---

## Shipping changes

There is no build step, so a change is a commit:

```bash
git add . && git commit -m "..." && git push
```

Pages redeploys in about a minute.

**One catch: bump the service worker cache.** Open `service-worker.js` and increment:

```js
const CACHE = 'baseline-v2';   // → 'baseline-v3'
```

If you skip this, the old files stay cached and your change appears not to have shipped. Your app data is in IndexedDB and is never touched by a cache bump.

If you add a new file under `src/`, also add it to the `SHELL` array in the same file, or the app will break when offline.

---

## When something is wrong

**"Could not reach the estimator."**
Almost always CORS. Open the browser console on the phone (Mac: Safari → Develop → your iPhone). A CORS error means `ALLOWED_ORIGIN` does not match your origin exactly. Fix `wrangler.toml`, redeploy the Worker.

**Photo estimates fail but everything else works.**
Check the Worker URL in Profile is the *base* URL with no path and no trailing slash.

**The app opens but shows nothing / errors on start.**
You are probably in Private Browsing, which blocks IndexedDB. The app says so on the start screen. Open it in a normal window.

**Changes are not appearing.**
Cache version. See above. To force it now: on iOS, delete the home-screen icon and re-add it.

**"Missing or insufficient permissions" in the console.**
The UIDs in `firestore.rules` are still placeholders, or you published rules to the wrong project. Firebase console → Authentication → Users has the real ones.

**Sign-in popup opens and immediately closes.**
`<username>.github.io` is missing from Authentication → Settings → Authorized domains.

**The switcher never appears.**
Both of you have to sign in at least once. It is driven by the `baseline_meta/household` document, which each account writes on first sign-in.

**502 from the Worker.**
Bad or expired API key, or you are out of credit. `npx wrangler secret put ANTHROPIC_API_KEY` again.

**Pages shows a 404.**
Either Pages is still publishing, or the branch/folder in Settings → Pages is wrong. It should be `main` and `/ (root)`.

---

## What costs money

Pages and the Cloudflare Worker free tier will both comfortably cover one person. The only real cost is Anthropic API usage: one vision call per meal photo plus one coaching call per week. Photos are downscaled to 1024 px before they are sent, which keeps the image token count small. At three or four logged meals a day this is cents per week, not dollars — but check your console after the first week rather than taking my word for it.
