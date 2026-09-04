/**
 * A test runner small enough to read in one sitting and with no dependencies,
 * so `node tests/run.mjs` works on a clean checkout.
 */

const tests = [];
let currentSuite = '';

export function suite(name, fn) {
  currentSuite = name;
  fn();
  currentSuite = '';
}

export function test(name, fn) {
  tests.push({ suite: currentSuite, name, fn });
}

export function assert(condition, message) {
  if (!condition) throw new Error(message || 'Expected a truthy value');
}

export function equal(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

export function near(actual, expected, tolerance, message) {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > tolerance) {
    throw new Error(message || `Expected ${expected} ±${tolerance}, got ${actual}`);
  }
}

export function includes(haystack, needle, message) {
  if (!String(haystack).toLowerCase().includes(String(needle).toLowerCase())) {
    throw new Error(message || `Expected text containing "${needle}", got "${haystack}"`);
  }
}

export async function run() {
  let passed = 0;
  const failures = [];

  for (const t of tests) {
    try {
      await t.fn();
      passed += 1;
    } catch (err) {
      failures.push({ ...t, err });
    }
  }

  const label = (t) => (t.suite ? `${t.suite} › ${t.name}` : t.name);
  for (const f of failures) {
    console.error(`✗ ${label(f)}\n    ${f.err.message}`);
  }
  console.log(`\n${passed}/${tests.length} passed${failures.length ? `, ${failures.length} failed` : ''}`);
  process.exitCode = failures.length ? 1 : 0;
}
