/**
 * Firebase project configuration.
 *
 * These values are not secrets — they identify the project and are visible in
 * any client. What protects the data is Firestore rules (see firestore.rules),
 * which restrict every document to the two signed-in accounts.
 *
 * Copy this file to config.js and fill it in. config.js is gitignored so your
 * project id does not end up in a public repo by accident.
 *
 * If you reuse the Firebase project that Receipt360 lives in, that is fine —
 * every collection here is prefixed `baseline_`, so nothing collides.
 */

export const firebaseConfig = {
  apiKey: '',
  authDomain: '',
  projectId: '',
  storageBucket: '',
  messagingSenderId: '',
  appId: ''
};

/**
 * The two Google accounts allowed to sign in. Anyone else is rejected in the
 * client AND in the Firestore rules — the client check is only there to give a
 * clear message instead of a silent permission error.
 */
export const ALLOWED_EMAILS = [
  'you@example.com',
  'her@example.com'
];

/** Set false to run entirely offline with no account. */
export const SYNC_ENABLED = true;
