/**
 * Synthetic histories.
 *
 * Shared by the test suite and the in-app demo seeder, so the scenarios the
 * tests assert on are the same ones you can look at in the UI. This lives under
 * src/ rather than tests/ because the app imports it too; it is excluded from
 * the service-worker cache list and costs nothing unless #/dev is opened.
 *
 * Randomness is seeded and deterministic — a test that passes on Tuesday has to
 * pass on Wednesday.
 */

import { isoAddDays, todayISO } from '../core/format.js';
import { buildTargets } from '../domain/targets.js';

/** Mulberry32 — small, fast, and repeatable. */
export function rng(seed = 42) {
  let a = seed >>> 0;
  return () => {
    a += 0x6D2B79F5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function baseProfile(overrides = {}) {
  const profile = {
    name: 'Test',
    weightUnit: 'lb',
    lengthUnit: 'in',
    age: 35,
    sex: 'male',
    height: 67,
    heightCm: 170.18,
    weight: 199,
    weightKg: 90.3,
    startWeight: 199,
    startWaist: 42,
    activityLevel: 'light',
    goal: 'lose',
    weeklyRate: 1,
    durationDays: 90,
    stepTarget: 8000,
    workoutsPerWeek: 3,
    diet: 'omnivore',
    ...overrides
  };
  profile.targets = overrides.targets || buildTargets(profile, { rate: profile.weeklyRate });
  return profile;
}

/**
 * @param {object} opts
 * @param {number} opts.days            length of history
 * @param {number} opts.lossPerWeek     trend loss in lb/week (0 = plateau)
 * @param {number} opts.logFraction     share of days with food logged
 * @param {number} opts.intake          mean daily kcal logged
 * @param {number} opts.noise           daily scale noise, lb peak-to-peak
 * @param {string} opts.strength        'improving' | 'stable' | 'declining' | 'none'
 * @param {number} opts.waistPerWeek    inches per week (negative = shrinking)
 * @param {number} opts.energy          1–5
 * @param {number} opts.sleep           hours
 */
export function makeState(opts = {}) {
  const {
    days = 35,
    lossPerWeek = 1,
    logFraction = 1,
    intake = 1950,
    noise = 1.2,
    strength = 'stable',
    waistPerWeek = -0.15,
    energy = 4,
    sleep = 7.2,
    seed = 7,
    profile: profileOverrides = {}
  } = opts;

  const random = rng(seed);
  const today = todayISO();
  const at = (i) => isoAddDays(today, -i);

  const weights = [];
  const food = [];
  const waists = [];
  const workouts = [];
  const metrics = {};

  const startWeight = 199;

  for (let i = days - 1; i >= 0; i -= 1) {
    const elapsed = days - 1 - i;
    const trend = startWeight - (lossPerWeek / 7) * elapsed;
    weights.push({
      id: `w${i}`,
      date: at(i),
      ts: Date.now() - i * 86400000,
      weight: Math.round((trend + (random() - 0.5) * noise) * 10) / 10
    });

    if (random() < logFraction) {
      const kcal = Math.round(intake + (random() - 0.5) * 300);
      food.push({
        id: `f${i}`,
        date: at(i),
        ts: Date.now() - i * 86400000 + 43200000,
        mealType: 'Lunch',
        items: [{ name: 'Dal (tadka, cooked)', grams: 200, kcal: 230, protein: 12, carbs: 28, fat: 8 }],
        totals: { kcal, protein: 150, carbs: Math.round(kcal * 0.4 / 4), fat: Math.round(kcal * 0.28 / 9) },
        confidence: 'medium',
        source: 'photo'
      });
    }

    metrics[at(i)] = {
      date: at(i),
      steps: Math.round(7200 + (random() - 0.5) * 2000),
      sleepHours: Math.round((sleep + (random() - 0.5) * 0.8) * 10) / 10,
      sleepQuality: 4,
      energy
    };
  }

  for (let i = days - 1; i >= 0; i -= 7) {
    const elapsed = (days - 1 - i) / 7;
    waists.push({
      id: `wa${i}`,
      date: at(i),
      waist: Math.round((42 + waistPerWeek * elapsed) * 10) / 10,
      site: 'navel'
    });
  }

  if (strength !== 'none') {
    const sessions = Math.floor(days / 3);
    for (let s = sessions - 1; s >= 0; s -= 1) {
      const elapsed = sessions - 1 - s;
      const load = strength === 'improving'
        ? 15 + Math.floor(elapsed / 3) * 5
        : strength === 'declining'
          ? Math.max(10, 25 - Math.floor(elapsed / 2) * 5)
          : 20;
      const reps = strength === 'declining' ? Math.max(6, 12 - Math.floor(elapsed / 2)) : 12;
      workouts.push({
        id: `wo${s}`,
        date: at(s * 3),
        name: s % 2 ? 'Workout A' : 'Workout B',
        sets: [
          { exercise: 'Goblet squat', weight: load, reps, sets: 3 },
          { exercise: 'Floor press', weight: load, reps, sets: 3 }
        ]
      });
    }
  }

  const profile = baseProfile({
    programStart: at(days - 1),
    programEnd: isoAddDays(at(days - 1), 89),
    ...profileOverrides
  });

  return {
    ready: true,
    profile,
    settings: { aiEndpoint: '', aiEnabled: false },
    weights,
    waists,
    food,
    workouts,
    metrics,
    photos: [],
    savedMeals: [],
    corrections: [],
    reviews: []
  };
}
