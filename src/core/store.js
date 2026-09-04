/**
 * Application store.
 *
 * One state object, one set of actions, a subscriber list. Views never write to
 * `state` directly and never touch `db` directly — they call actions, the action
 * writes to IndexedDB, updates the in-memory slice, and notifies subscribers with
 * the names of the slices that changed so a view can skip work it doesn't need.
 */

import { db, newId } from './db.js';
import { todayISO, weekStart } from './format.js';

const listeners = new Set();

/**
 * Sync hook. The store deliberately does not import the sync module — that
 * would be a cycle, and it would also make the store impossible to test without
 * Firebase. main.js installs these once a session is live.
 */
let syncHooks = { push: null, remove: null, profile: null };

export function setSyncHooks(hooks) {
  syncHooks = { ...syncHooks, ...hooks };
}

function mirror(slice, record) {
  if (syncHooks.push) Promise.resolve(syncHooks.push(slice, record)).catch((err) => console.warn('sync push failed', err));
}

function mirrorDelete(slice, id) {
  if (syncHooks.remove) Promise.resolve(syncHooks.remove(slice, id)).catch((err) => console.warn('sync delete failed', err));
}

/** @type {object} */
export const state = {
  ready: false,
  profile: null,        // null until onboarding completes
  settings: defaultSettings(),
  weights: [],          // [{ id, date, ts, weight, note }] ascending by date
  waists: [],           // [{ id, date, waist, site }]
  food: [],             // [{ id, date, ts, mealType, items[], totals{}, confidence, photoId, source }]
  workouts: [],         // [{ id, date, name, sets[] }]
  metrics: {},          // { [date]: { date, steps, sleepHours, sleepQuality, energy, hunger, stress } }
  photos: [],           // [{ id, date, pose, blob, w, h }]
  savedMeals: [],       // [{ id, name, items[], totals{}, uses, lastUsed }]
  corrections: [],      // [{ id, foodKey, aiGrams, userGrams, ts }]
  reviews: [],          // [{ weekStart, data, coaching, answers, createdAt }]

  // --- two-person additions -------------------------------------------
  // The partner's records live here, in memory only, and are never written to
  // the local database. Keeping them in a separate object is what guarantees
  // two people's weigh-ins can never end up in the same series.
  partner: null,        // same shape as above, plus { uid, name }, photos always []
  viewing: 'self',      // 'self' | 'partner' — which dataset the screens render
  auth: null            // { uid, name, email } when signed in
};

/**
 * The dataset the screens should render.
 *
 * Every view reads through this instead of touching `state` directly, so one
 * switcher in the header makes every screen work for either person. The engine
 * already takes state as an argument, so nothing in domain/ changes.
 */
export function view() {
  return state.viewing === 'partner' && state.partner ? state.partner : state;
}

/** True when the screens are showing someone else's data. Writes are disabled. */
export function isReadOnly() {
  return state.viewing === 'partner' && !!state.partner;
}

export function setViewing(who) {
  if (who === 'partner' && !state.partner) return;
  state.viewing = who;
  notify('viewing');
}

export function setPartner(partner) {
  state.partner = partner;
  if (!partner && state.viewing === 'partner') state.viewing = 'self';
  notify('partner');
}

export function setAuth(user) {
  state.auth = user ? { uid: user.uid, name: user.displayName || user.email, email: user.email } : null;
  notify('auth');
}

function defaultSettings() {
  return {
    units: 'imperial',
    // Default proxy for a device that has never saved settings. Saved settings
    // win over this (see loadAll: defaults spread first, kv.settings second),
    // so a device with an existing empty value still needs Profile -> AI once.
    aiEndpoint: 'https://baseline.shubhamsaxena1492.workers.dev',
    aiEnabled: true,
    notifyMorning: true,
    notifyEvening: true,
    notifyWeekly: true,
    photoConsentCloud: false   // stays false; there is no cloud path in this build
  };
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(...changed) {
  for (const fn of listeners) fn(state, changed);
}

const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
const byTs = (a, b) => (a.ts || 0) - (b.ts || 0);

/* ------------------------------------------------------------------ boot */

export async function hydrate() {
  const [kv, weights, waists, food, workouts, metrics, photos, savedMeals, corrections, reviews] =
    await Promise.all([
      db.getAll('kv'),
      db.getAll('weights'),
      db.getAll('waists'),
      db.getAll('foodEntries'),
      db.getAll('workouts'),
      db.getAll('dailyMetrics'),
      db.getAll('photos'),
      db.getAll('savedMeals'),
      db.getAll('corrections'),
      db.getAll('reviews')
    ]);

  const kvMap = Object.fromEntries(kv.map((r) => [r.key, r.value]));
  state.profile = kvMap.profile || null;
  state.settings = { ...defaultSettings(), ...(kvMap.settings || {}) };
  state.weights = weights.sort(byDate);
  state.waists = waists.sort(byDate);
  state.food = food.sort(byTs);
  state.workouts = workouts.sort(byDate);
  state.metrics = Object.fromEntries(metrics.map((m) => [m.date, m]));
  state.photos = photos.sort(byDate);
  state.savedMeals = savedMeals;
  state.corrections = corrections;
  state.reviews = reviews.sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1));
  state.ready = true;
  notify('*');
}

/* --------------------------------------------------------------- profile */

export async function saveProfile(patch) {
  const next = { ...(state.profile || {}), ...patch };
  await db.put('kv', { key: 'profile', value: next });
  state.profile = next;
  if (syncHooks.profile) Promise.resolve(syncHooks.profile()).catch((err) => console.warn('sync profile failed', err));
  notify('profile');
  return next;
}

export async function saveSettings(patch) {
  const next = { ...state.settings, ...patch };
  await db.put('kv', { key: 'settings', value: next });
  state.settings = next;
  notify('settings');
  return next;
}

/* ---------------------------------------------------------------- weight */

export async function logWeight({ date = todayISO(), weight, note = '', ts = Date.now() }) {
  const existing = state.weights.find((w) => w.date === date);
  const record = existing
    ? { ...existing, weight, note, ts }
    : { id: newId('w'), date, weight, note, ts };
  await db.put('weights', record);
  state.weights = state.weights.filter((w) => w.date !== date).concat(record).sort(byDate);
  mirror('weights', record);
  notify('weights');
  return record;
}

export async function removeWeight(id) {
  await db.remove('weights', id);
  state.weights = state.weights.filter((w) => w.id !== id);
  mirrorDelete('weights', id);
  notify('weights');
}

/* ----------------------------------------------------------------- waist */

export async function logWaist({ date = todayISO(), waist, site = 'navel' }) {
  const existing = state.waists.find((w) => w.date === date);
  const record = existing ? { ...existing, waist, site } : { id: newId('waist'), date, waist, site };
  await db.put('waists', record);
  state.waists = state.waists.filter((w) => w.date !== date).concat(record).sort(byDate);
  mirror('waists', record);
  notify('waists');
  return record;
}

/* ------------------------------------------------------------------ food */

export async function saveFoodEntry(entry) {
  const record = {
    id: entry.id || newId('meal'),
    date: entry.date || todayISO(),
    ts: entry.ts || Date.now(),
    mealType: entry.mealType || 'meal',
    items: entry.items || [],
    totals: entry.totals,
    confidence: entry.confidence || 'medium',
    source: entry.source || 'photo',
    prep: entry.prep || null,
    photoThumb: entry.photoThumb || null,
    note: entry.note || ''
  };
  await db.put('foodEntries', record);
  state.food = state.food.filter((f) => f.id !== record.id).concat(record).sort(byTs);
  mirror('food', record);
  notify('food');
  return record;
}

export async function removeFoodEntry(id) {
  await db.remove('foodEntries', id);
  state.food = state.food.filter((f) => f.id !== id);
  mirrorDelete('food', id);
  notify('food');
}

/**
 * PRD §40 — remember that the user moved the AI's portion estimate.
 * Stored as raw pairs; `domain/foods.js` turns them into a personal prior.
 */
export async function recordCorrection(foodKey, aiGrams, userGrams) {
  if (!foodKey || !Number.isFinite(aiGrams) || !Number.isFinite(userGrams)) return;
  if (Math.abs(aiGrams - userGrams) < 1) return;
  const record = { id: newId('corr'), foodKey, aiGrams, userGrams, ts: Date.now() };
  await db.put('corrections', record);
  state.corrections = state.corrections.concat(record);
  mirror('corrections', record);
  notify('corrections');
}

export async function saveMeal({ name, items, totals }) {
  const record = { id: newId('sm'), name, items, totals, uses: 0, lastUsed: null };
  await db.put('savedMeals', record);
  state.savedMeals = state.savedMeals.concat(record);
  mirror('savedMeals', record);
  notify('savedMeals');
  return record;
}

export async function touchSavedMeal(id) {
  const meal = state.savedMeals.find((m) => m.id === id);
  if (!meal) return;
  const next = { ...meal, uses: (meal.uses || 0) + 1, lastUsed: Date.now() };
  await db.put('savedMeals', next);
  state.savedMeals = state.savedMeals.map((m) => (m.id === id ? next : m));
  mirror('savedMeals', next);
  notify('savedMeals');
}

export async function removeSavedMeal(id) {
  await db.remove('savedMeals', id);
  state.savedMeals = state.savedMeals.filter((m) => m.id !== id);
  mirrorDelete('savedMeals', id);
  notify('savedMeals');
}

/* -------------------------------------------------------------- training */

export async function saveWorkout(workout) {
  const record = {
    id: workout.id || newId('wo'),
    date: workout.date || todayISO(),
    name: workout.name || 'Workout',
    sets: workout.sets || [],
    note: workout.note || ''
  };
  await db.put('workouts', record);
  state.workouts = state.workouts.filter((w) => w.id !== record.id).concat(record).sort(byDate);
  mirror('workouts', record);
  notify('workouts');
  return record;
}

export async function removeWorkout(id) {
  await db.remove('workouts', id);
  state.workouts = state.workouts.filter((w) => w.id !== id);
  mirrorDelete('workouts', id);
  notify('workouts');
}

/* --------------------------------------------------------- daily metrics */

export async function saveMetrics(date, patch) {
  const current = state.metrics[date] || { date };
  const next = { ...current, ...patch, date };
  await db.put('dailyMetrics', next);
  state.metrics = { ...state.metrics, [date]: next };
  mirror('metrics', next);
  notify('metrics');
  return next;
}

/* ---------------------------------------------------------------- photos */

export async function savePhoto({ date = todayISO(), pose, blob }) {
  const record = { id: newId('ph'), date, pose, blob, createdAt: Date.now() };
  await db.put('photos', record);
  state.photos = state.photos.concat(record).sort(byDate);
  notify('photos');
  return record;
}

export async function removePhoto(id) {
  await db.remove('photos', id);
  state.photos = state.photos.filter((p) => p.id !== id);
  notify('photos');
}

/* --------------------------------------------------------------- reviews */

export async function saveReview(review) {
  const record = { ...review, weekStart: review.weekStart || weekStart(todayISO()) };
  await db.put('reviews', record);
  state.reviews = state.reviews
    .filter((r) => r.weekStart !== record.weekStart)
    .concat(record)
    .sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1));
  mirror('reviews', record);
  notify('reviews');
  return record;
}

/* ---------------------------------------------------------- remote merge */

const STORE_FOR_SLICE = {
  weights: 'weights',
  waists: 'waists',
  food: 'foodEntries',
  workouts: 'workouts',
  metrics: 'dailyMetrics',
  savedMeals: 'savedMeals',
  corrections: 'corrections',
  reviews: 'reviews'
};

/**
 * Reconcile records arriving from Firestore into the local database.
 *
 * Last-write-wins on `updatedAt`. That is the right call here and would not be
 * in a multi-user document: these are single-author records, so two versions of
 * the same weigh-in mean the same person edited it twice on two devices, and
 * the later edit is the one they meant. Records without a timestamp are treated
 * as older than anything stamped, so a local record never loses to a remote one
 * that predates sync.
 *
 * This is only ever called with YOUR OWN records. Partner data goes to
 * `setPartner` and never touches the database.
 */
export async function mergeRemote(slice, incoming, def) {
  const storeName = STORE_FOR_SLICE[slice];
  if (!storeName || !incoming?.length) return;
  const key = def?.key || 'id';
  const isMap = !!def?.isMap;

  const localList = isMap ? Object.values(state[slice] || {}) : (state[slice] || []);
  const localById = new Map(localList.map((r) => [String(r[key]), r]));

  const toWrite = [];
  const toDelete = [];

  for (const remote of incoming) {
    const id = String(remote[key]);
    const local = localById.get(id);
    const remoteAt = remote.updatedAt || 0;
    const localAt = local?.updatedAt || 0;

    if (remote.deleted) {
      if (local && remoteAt >= localAt) toDelete.push(id);
      continue;
    }
    if (!local || remoteAt > localAt) toWrite.push(remote);
  }

  if (!toWrite.length && !toDelete.length) return;

  if (toWrite.length) await db.putMany(storeName, toWrite);
  for (const id of toDelete) await db.remove(storeName, id);

  const survivors = localList
    .filter((r) => !toDelete.includes(String(r[key])))
    .filter((r) => !toWrite.some((w) => String(w[key]) === String(r[key])))
    .concat(toWrite);

  if (isMap) {
    state[slice] = Object.fromEntries(survivors.map((r) => [r[key], r]));
  } else {
    const cmp = slice === 'food'
      ? byTs
      : (a, b) => (String(a[key] ?? '') < String(b[key] ?? '') ? -1 : 1);
    state[slice] = survivors.sort(slice === 'weights' || slice === 'waists' || slice === 'workouts' ? byDate : cmp);
  }
  notify(slice);
}

/* ------------------------------------------------------------ destructive */

/**
 * Replace the entire database with a supplied state. Used by the demo seeder
 * at #/dev and by nothing else — there is no import-from-file path in the UI,
 * because a bad import is indistinguishable from data loss.
 */
export async function replaceAll(next) {
  await db.destroyEverything();
  await db.put('kv', { key: 'profile', value: next.profile });
  await db.put('kv', { key: 'settings', value: { ...defaultSettings(), ...(next.settings || {}) } });
  await db.putMany('weights', next.weights || []);
  await db.putMany('waists', next.waists || []);
  await db.putMany('foodEntries', next.food || []);
  await db.putMany('workouts', next.workouts || []);
  await db.putMany('dailyMetrics', Object.values(next.metrics || {}));
  await db.putMany('savedMeals', next.savedMeals || []);
  await db.putMany('corrections', next.corrections || []);
  await db.putMany('reviews', next.reviews || []);
  await hydrate();
}

export async function eraseAllData() {
  await db.destroyEverything();
  state.profile = null;
  state.settings = defaultSettings();
  state.weights = [];
  state.waists = [];
  state.food = [];
  state.workouts = [];
  state.metrics = {};
  state.photos = [];
  state.savedMeals = [];
  state.corrections = [];
  state.reviews = [];
  notify('*');
}

/* ------------------------------------------------------------- selectors */

export function foodOn(date) {
  return view().food.filter((f) => f.date === date).sort(byTs);
}

export function totalsOn(date) {
  return foodOn(date).reduce(
    (acc, entry) => ({
      kcal: acc.kcal + (entry.totals?.kcal || 0),
      protein: acc.protein + (entry.totals?.protein || 0),
      carbs: acc.carbs + (entry.totals?.carbs || 0),
      fat: acc.fat + (entry.totals?.fat || 0)
    }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0 }
  );
}

export function metricsOn(date) {
  return view().metrics[date] || { date };
}

export function programDay(iso = todayISO()) {
  const profile = view().profile;
  if (!profile?.programStart) return null;
  return Math.floor(
    (Date.parse(`${iso}T00:00:00`) - Date.parse(`${profile.programStart}T00:00:00`)) / 86400000
  ) + 1;
}
