/** Test fixtures re-export the app's own scenario generator, so tests and the
 *  in-app demo data can never drift apart. */
export { rng, baseProfile, makeState } from '../src/dev/scenarios.js';
