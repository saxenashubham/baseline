/**
 * Firebase, loaded lazily from the CDN.
 *
 * Deliberately lazy: the app is local-first and fully functional signed out, so
 * nothing should pay for the SDK on first paint. It is imported the moment sync
 * is switched on and never before.
 *
 * Nothing here knows about the app's data model — `services/sync.js` owns that.
 * This file only produces handles and an auth state.
 */

const SDK = 'https://www.gstatic.com/firebasejs/10.12.0';

let modules = null;
let app = null;
let auth = null;
let firestore = null;

async function loadSDK() {
  if (modules) return modules;
  const [appMod, authMod, storeMod] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-firestore.js`)
  ]);
  modules = { appMod, authMod, storeMod };
  return modules;
}

/**
 * @param {object} config firebaseConfig from src/config.js
 * @returns {Promise<{auth, db, mods}>}
 */
export async function initFirebase(config) {
  if (app) return { auth, db: firestore, mods: modules };
  const mods = await loadSDK();
  app = mods.appMod.initializeApp(config);
  auth = mods.authMod.getAuth(app);

  // Offline persistence: Firestore keeps its own IndexedDB cache, so reads and
  // writes work with no network and flush when it returns. Multi-tab is enabled
  // because a phone PWA and a desktop tab open at once is normal.
  try {
    firestore = mods.storeMod.initializeFirestore(app, {
      localCache: mods.storeMod.persistentLocalCache({
        tabManager: mods.storeMod.persistentMultipleTabManager()
      })
    });
  } catch (err) {
    // Persistence is unavailable in some private-browsing modes. Sync still
    // works online; it just loses the offline queue.
    console.warn('Firestore persistence unavailable, continuing without it', err);
    firestore = mods.storeMod.getFirestore(app);
  }

  return { auth, db: firestore, mods };
}

export async function signIn(config) {
  const { auth: a, mods } = await initFirebase(config);
  const provider = new mods.authMod.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    const result = await mods.authMod.signInWithPopup(a, provider);
    return result.user;
  } catch (err) {
    // iOS standalone PWAs block popups. Redirect is the fallback that works
    // from a home-screen icon.
    if (String(err.code).includes('popup')) {
      await mods.authMod.signInWithRedirect(a, provider);
      return null;
    }
    throw err;
  }
}

export async function signOutUser(config) {
  const { auth: a, mods } = await initFirebase(config);
  await mods.authMod.signOut(a);
}

/** Fires immediately with the current user, then on every change. */
export async function onAuth(config, callback) {
  const { auth: a, mods } = await initFirebase(config);
  await mods.authMod.getRedirectResult(a).catch(() => null);
  return mods.authMod.onAuthStateChanged(a, callback);
}

export function getModules() {
  return modules;
}

export function getDb() {
  return firestore;
}
