/**
 * Two-way sync.
 *
 * Shape of the deal: IndexedDB stays the source of truth locally, and Firestore
 * is a mirror. Every write goes to the local database first and is queued for
 * the cloud second, so the app is never blocked on a network and behaves
 * identically signed out. That also means nothing already built or tested had
 * to change to accommodate sync.
 *
 * Partitioning is the part that matters. Two people on separate plans is not a
 * shared dataset — if both sets of weigh-ins landed in one collection the trend
 * engine would average them together and every conclusion it draws would be
 * wrong. So each person owns `baseline_users/{uid}` and writes only there. The
 * rules enforce it; the client never even constructs a path into someone else's
 * space except to read.
 *
 * Progress photos are absent from this file entirely. There is no code path
 * that uploads them.
 */

import { initFirebase, getModules, getDb } from './firebase.js';
import { mergeRemote, setPartner, state } from '../core/store.js';

/** local state slice -> Firestore subcollection. `key` is the document id. */
export const COLLECTIONS = [
  { slice: 'weights',     path: 'weights',     key: 'id' },
  { slice: 'waists',      path: 'waists',      key: 'id' },
  { slice: 'food',        path: 'food',        key: 'id' },
  { slice: 'workouts',    path: 'workouts',    key: 'id' },
  { slice: 'metrics',     path: 'metrics',     key: 'date', isMap: true },
  { slice: 'savedMeals',  path: 'savedMeals',  key: 'id' },
  { slice: 'corrections', path: 'corrections', key: 'id' },
  { slice: 'reviews',     path: 'reviews',     key: 'weekStart' }
];

const HOUSEHOLD = ['baseline_meta', 'household'];

let uid = null;
let config = null;
let unsubscribes = [];
let status = 'off';
let onStatusChange = () => {};

export function syncStatus() {
  return status;
}

function setStatus(next) {
  status = next;
  onStatusChange(next);
}

/* ------------------------------------------------------------- helpers */

const userDoc = () => {
  const { storeMod } = getModules();
  return storeMod.doc(getDb(), 'baseline_users', uid);
};

const colRef = (ownerUid, path) => {
  const { storeMod } = getModules();
  return storeMod.collection(getDb(), 'baseline_users', ownerUid, path);
};

const stamp = (record) => ({ ...record, updatedAt: record.updatedAt || Date.now() });

/** Blobs cannot go to Firestore, and photos are not synced by design. */
function scrub(record) {
  const clean = { ...record };
  delete clean.blob;
  return clean;
}

/* --------------------------------------------------------------- start */

/**
 * @param {object} cfg firebaseConfig
 * @param {object} user the signed-in Firebase user
 * @param {object} handlers { onStatus }
 */
export async function startSync(cfg, user, handlers = {}) {
  config = cfg;
  uid = user.uid;
  onStatusChange = handlers.onStatus || (() => {});
  setStatus('connecting');

  await initFirebase(config);
  const { storeMod } = getModules();

  await announce(user, storeMod);
  await pushProfile();
  await pushEverythingLocal();
  subscribeSelf(storeMod);
  await subscribePartner(storeMod);

  setStatus('live');
}

export function stopSync() {
  unsubscribes.forEach((fn) => { try { fn(); } catch { /* already gone */ } });
  unsubscribes = [];
  uid = null;
  setPartner(null);
  setStatus('off');
}

/** Put yourself in the household doc so the other person can find you. */
async function announce(user, storeMod) {
  const ref = storeMod.doc(getDb(), ...HOUSEHOLD);
  await storeMod.setDoc(ref, {
    members: {
      [user.uid]: {
        uid: user.uid,
        name: user.displayName || user.email,
        email: user.email,
        seenAt: Date.now()
      }
    }
  }, { merge: true });
}

/* ---------------------------------------------------------------- push */

export async function pushProfile() {
  if (!uid) return;
  const { storeMod } = getModules();
  await storeMod.setDoc(userDoc(), {
    profile: state.profile || null,
    displayName: state.profile?.name || null,
    updatedAt: Date.now()
  }, { merge: true });
}

/** Called by the store after every successful local write. */
export async function pushRecord(slice, record) {
  if (!uid || status === 'off') return;
  const def = COLLECTIONS.find((c) => c.slice === slice);
  if (!def) return;
  const { storeMod } = getModules();
  const value = stamp(scrub(record));
  await storeMod.setDoc(storeMod.doc(colRef(uid, def.path), String(value[def.key])), value);
}

/**
 * Deletes are soft. A hard delete is invisible to the other device — it just
 * looks like a record that never arrived, and the next merge resurrects it.
 */
export async function pushDelete(slice, id) {
  if (!uid || status === 'off') return;
  const def = COLLECTIONS.find((c) => c.slice === slice);
  if (!def) return;
  const { storeMod } = getModules();
  await storeMod.setDoc(storeMod.doc(colRef(uid, def.path), String(id)), {
    [def.key]: id, deleted: true, updatedAt: Date.now()
  });
}

async function pushEverythingLocal() {
  const { storeMod } = getModules();
  for (const def of COLLECTIONS) {
    const records = def.isMap ? Object.values(state[def.slice] || {}) : (state[def.slice] || []);
    if (!records.length) continue;
    // Firestore caps a batch at 500 writes.
    for (let i = 0; i < records.length; i += 450) {
      const batch = storeMod.writeBatch(getDb());
      for (const record of records.slice(i, i + 450)) {
        const value = stamp(scrub(record));
        batch.set(storeMod.doc(colRef(uid, def.path), String(value[def.key])), value, { merge: true });
      }
      await batch.commit();
    }
  }
}

/* ---------------------------------------------------------------- pull */

function subscribeSelf(storeMod) {
  for (const def of COLLECTIONS) {
    const unsub = storeMod.onSnapshot(colRef(uid, def.path), (snap) => {
      const incoming = snap.docs.map((d) => d.data());
      if (incoming.length) mergeRemote(def.slice, incoming, def);
    }, (err) => {
      console.warn(`sync: ${def.path} stream failed`, err);
      setStatus('error');
    });
    unsubscribes.push(unsub);
  }
}

/**
 * The partner's data is read-only and lives in memory only — it is never
 * written into the local database, so there is no way for the two people's
 * records to end up in the same store.
 */
async function subscribePartner(storeMod) {
  const householdRef = storeMod.doc(getDb(), ...HOUSEHOLD);
  const unsub = storeMod.onSnapshot(householdRef, async (snap) => {
    const members = snap.data()?.members || {};
    const other = Object.values(members).find((m) => m.uid !== uid);
    if (!other) {
      setPartner(null);
      return;
    }
    attachPartnerStreams(storeMod, other);
  }, (err) => console.warn('sync: household stream failed', err));
  unsubscribes.push(unsub);
}

let partnerUnsubs = [];
let partnerUid = null;

function attachPartnerStreams(storeMod, other) {
  if (partnerUid === other.uid) return;
  partnerUnsubs.forEach((fn) => { try { fn(); } catch { /* gone */ } });
  partnerUnsubs = [];
  partnerUid = other.uid;

  const collected = {
    uid: other.uid,
    name: other.name,
    profile: null,
    weights: [], waists: [], food: [], workouts: [],
    metrics: {}, savedMeals: [], corrections: [], reviews: [],
    photos: []   // always empty: photos are not synced
  };

  partnerUnsubs.push(storeMod.onSnapshot(
    storeMod.doc(getDb(), 'baseline_users', other.uid),
    (snap) => {
      collected.profile = snap.data()?.profile || null;
      setPartner({ ...collected });
    },
    () => setPartner(null)
  ));

  for (const def of COLLECTIONS) {
    partnerUnsubs.push(storeMod.onSnapshot(colRef(other.uid, def.path), (snap) => {
      const rows = snap.docs.map((d) => d.data()).filter((r) => !r.deleted);
      if (def.isMap) {
        collected[def.slice] = Object.fromEntries(rows.map((r) => [r[def.key], r]));
      } else {
        collected[def.slice] = rows.sort(sorterFor(def));
      }
      setPartner({ ...collected });
    }, (err) => console.warn(`sync: partner ${def.path} failed`, err)));
  }

  unsubscribes.push(() => partnerUnsubs.forEach((fn) => fn()));
}

function sorterFor(def) {
  if (def.slice === 'food') return (a, b) => (a.ts || 0) - (b.ts || 0);
  return (a, b) => (String(a.date || a[def.key]) < String(b.date || b[def.key]) ? -1 : 1);
}
