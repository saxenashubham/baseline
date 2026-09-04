/**
 * Entry point.
 *
 * Order matters: hydrate the local database first, render immediately, then
 * bring sync up in the background. The app must be usable before the network
 * is, and on a cold start with no signal it should behave exactly as it does
 * signed out.
 */

import { h } from './core/dom.js';
import { state, subscribe, hydrate, setSyncHooks, setAuth } from './core/store.js';
import { defineRoutes, startRouter, updateCurrent, navigate } from './core/router.js';
import { homeView } from './views/home.js';
import { foodView } from './views/food.js';
import { progressView } from './views/progress.js';
import { trainingView } from './views/training.js';
import { insightsView } from './views/insights.js';
import { profileView } from './views/profile.js';
import { onboardingView } from './views/onboarding.js';
import { accountView } from './views/account.js';
import { devView } from './views/dev.js';
import { toast } from './ui/components.js';
import { todayISO, weekStart } from './core/format.js';

const app = document.getElementById('app');

/**
 * config.js is gitignored and may not exist. A missing config is not an error —
 * it means this install runs local-only, which is a supported mode.
 */
let config = null;
let allowedEmails = [];
let syncEnabled = false;

async function loadConfig() {
  try {
    const mod = await import('./config.js');
    config = mod.firebaseConfig || null;
    allowedEmails = (mod.ALLOWED_EMAILS || []).map((e) => e.toLowerCase());
    syncEnabled = mod.SYNC_ENABLED !== false && !!config?.projectId;
  } catch {
    config = null;
    syncEnabled = false;
  }
}

/* ---------------------------------------------------------------- routes */

function guard(factory) {
  return (ctx) => (state.profile?.programStart ? factory(ctx) : onboardingView(ctx));
}

const accountRoute = () => accountView({ config, onSignIn: doSignIn, onSignOut: doSignOut });

defineRoutes({
  home: guard(homeView),
  food: guard(foodView),
  progress: guard(progressView),
  training: guard(trainingView),
  insights: guard(insightsView),
  profile: guard(profileView),
  onboarding: onboardingView,
  account: accountRoute,
  dev: devView   // #/dev — demo data, deliberately unlinked from the UI
});

/* ------------------------------------------------------------------ auth */

let syncModule = null;

async function sync() {
  if (!syncModule) syncModule = await import('./services/sync.js');
  return syncModule;
}

async function doSignIn() {
  const { signIn } = await import('./services/firebase.js');
  const user = await signIn(config);
  // A redirect flow returns null here and resolves on the next page load.
  if (user) await handleUser(user);
}

async function doSignOut() {
  const [{ signOutUser }, s] = await Promise.all([import('./services/firebase.js'), sync()]);
  s.stopSync();
  setSyncHooks({ push: null, remove: null, profile: null });
  await signOutUser(config);
  setAuth(null);
}

async function handleUser(user) {
  if (!user) {
    setAuth(null);
    return;
  }

  // The allowlist is a courtesy check so a wrong account gets a clear message.
  // The real enforcement is in the Firestore rules — a client check is not a
  // security control and is not treated as one here.
  const email = (user.email || '').toLowerCase();
  if (allowedEmails.length && !allowedEmails.includes(email)) {
    const { signOutUser } = await import('./services/firebase.js');
    await signOutUser(config);
    setAuth(null);
    toast('That account is not part of this household.');
    return;
  }

  setAuth(user);
  const s = await sync();
  setSyncHooks({ push: s.pushRecord, remove: s.pushDelete, profile: s.pushProfile });

  try {
    await s.startSync(config, user, {
      onStatus: (status) => {
        if (status === 'error') toast('Sync error — your data is safe on this device.');
      }
    });
  } catch (err) {
    console.error('sync failed to start', err);
    toast('Could not start sync. Working locally.');
  }
}

async function watchAuth() {
  if (!syncEnabled) return;
  try {
    const { onAuth } = await import('./services/firebase.js');
    await onAuth(config, (user) => { handleUser(user); });
  } catch (err) {
    console.warn('Firebase unavailable, running local-only', err);
  }
}

/* ------------------------------------------------------------------ boot */

function bootError(err) {
  console.error(err);
  app.appendChild(h('div.view.stack', null, [
    h('h2.section', null, 'This device will not open the database'),
    h('p.muted', null,
      'Baseline stores everything locally, which private browsing blocks. Open it in a normal window and it will work.')
  ]));
}

async function boot() {
  await loadConfig();

  try {
    await hydrate();
  } catch (err) {
    bootError(err);
    return;
  }

  // On a fresh install with sync configured, offer the account first — a
  // returning user on a new phone should pull their plan, not re-enter it.
  const fallback = state.profile?.programStart
    ? 'home'
    : (syncEnabled ? 'account' : 'onboarding');

  startRouter(app, { fallback });
  subscribe((s, changed) => updateCurrent(s, changed));

  if (!window.location.hash) navigate(fallback);

  watchAuth();
  registerServiceWorker();
  nudge();
}

/* --------------------------------------------------------- reminders */

/**
 * PRD §45 — three nudges, in-app only. No push permission prompt on first run;
 * an app that asks for notifications before it has earned anything gets denied.
 * These read `state` rather than `view()` on purpose: you are never reminded
 * about somebody else's protein.
 */
function nudge() {
  if (!state.profile?.programStart) return;
  const today = todayISO();
  const hour = new Date().getHours();
  const s = state.settings;

  const weighedToday = state.weights.some((w) => w.date === today);
  if (s.notifyMorning && hour < 12 && !weighedToday) {
    setTimeout(() => toast('Weigh-in takes ten seconds.'), 1400);
    return;
  }

  const protein = state.food
    .filter((f) => f.date === today)
    .reduce((a, f) => a + (f.totals?.protein || 0), 0);
  const target = state.profile?.targets?.protein;
  if (s.notifyEvening && hour >= 18 && target && protein < target * 0.75) {
    setTimeout(() => toast(`${Math.round(protein)} g of protein so far. Dinner is the gap.`), 1400);
    return;
  }

  const isSunday = new Date().getDay() === 0;
  const thisWeek = weekStart(today);
  const reviewed = state.reviews.some((r) => r.weekStart === thisWeek);
  if (s.notifyWeekly && isSunday && !reviewed) {
    setTimeout(() => toast('Your weekly review is ready in Insights.'), 1400);
  }
}

/* --------------------------------------------------- service worker */

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch((err) => {
      console.warn('Service worker registration failed', err);
    });
  });
}

boot();
