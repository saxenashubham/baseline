/**
 * Tests for the decision layer.
 *
 * These exist because the engine is the part that can be quietly, plausibly
 * wrong. A UI bug is visible the first time you open the screen; a
 * classification bug tells you to cut 150 calories for a month for no reason.
 *
 * Run: node tests/run.mjs
 */

import { suite, test, assert, equal, near, includes, run } from './harness.mjs';
import { makeState, baseProfile } from './fixtures.mjs';
import {
  buildSnapshot, classify, recommendAdjustment, fatLossConfidence, consistencyScore,
  flatWeekStreak, strengthStatus, fluctuationNote, intakeTrust, avgDailyIntake, STATES
} from '../src/domain/engine.js';
import {
  buildTargets, observedTDEE, calorieFloor, bmrMifflinStJeor, macroTargets, biasStability
} from '../src/domain/targets.js';
import { trendSummary, slopePerDay, direction, densify, rollingMean } from '../src/domain/trends.js';
import {
  portionPrior, usualMeals, estimateRange, macrosFor, lookupFood, searchFoods, sumItems, foodKey,
  FOOD_DB, defaultGrams, servingCount, densityOf
} from '../src/domain/foods.js';
import {
  todayISO, isoAddDays, weekStart, daysBetween, median,
  weightUnit, lengthUnit, convertWeight, convertLength, fmtWeight, fmtLength
} from '../src/core/format.js';

const today = todayISO();
const decide = (state, windowDays = 14) => {
  const snap = buildSnapshot(state, today, windowDays);
  const streak = flatWeekStreak(state, today);
  const cls = classify(snap, streak);
  return { snap, streak, cls, rec: recommendAdjustment(snap, cls, streak) };
};

/* ------------------------------------------------------------ dates */

suite('dates', () => {
  test('isoAddDays crosses month boundaries', () => {
    equal(isoAddDays('2026-01-31', 1), '2026-02-01');
    equal(isoAddDays('2026-03-01', -1), '2026-02-28');
  });

  test('isoAddDays handles a leap day', () => {
    equal(isoAddDays('2028-02-28', 1), '2028-02-29');
  });

  test('weekStart anchors to Monday', () => {
    equal(weekStart('2026-09-03'), '2026-08-31'); // a Thursday
    equal(weekStart('2026-08-31'), '2026-08-31'); // the Monday itself
    equal(weekStart('2026-09-06'), '2026-08-31'); // the Sunday after
  });

  test('daysBetween is inclusive of direction', () => {
    equal(daysBetween('2026-01-01', '2026-01-08'), 7);
    equal(daysBetween('2026-01-08', '2026-01-01'), -7);
  });
});

/* ----------------------------------------------------------- targets */

suite('targets', () => {
  test('Mifflin-St Jeor matches the published equation', () => {
    // 80 kg, 180 cm, 30 y, male: 10(80) + 6.25(180) − 5(30) + 5 = 1780
    near(bmrMifflinStJeor({ weightKg: 80, heightCm: 180, age: 30, sex: 'male' }), 1780, 0.5);
    near(bmrMifflinStJeor({ weightKg: 80, heightCm: 180, age: 30, sex: 'female' }), 1614, 0.5);
  });

  test('a 1 lb/week goal produces a 500 kcal deficit', () => {
    const profile = baseProfile();
    const t = buildTargets(profile, { expenditure: 2500, rate: 1 });
    equal(t.kcal, 2000);
  });

  test('the calorie floor holds even at an aggressive rate', () => {
    const profile = baseProfile({ weight: 140, weightKg: 63.5, height: 64, heightCm: 162.6 });
    const t = buildTargets(profile, { expenditure: 1900, rate: 2 });
    assert(t.kcal >= calorieFloor(profile), 'target dropped below the floor');
    assert(t.clampedToFloor, 'clamping was not reported to the caller');
  });

  test('macros fit inside the calorie target', () => {
    const profile = baseProfile();
    const m = macroTargets(profile, 2000);
    const kcal = m.protein * 4 + m.carbs * 4 + m.fat * 9;
    near(kcal, 2000, 30);
  });

  test('protein leads: it scales with bodyweight, not calories', () => {
    const light = macroTargets(baseProfile({ weight: 150, weightKg: 68 }), 2000);
    const heavy = macroTargets(baseProfile({ weight: 220, weightKg: 99.8 }), 2000);
    assert(heavy.protein > light.protein, 'protein did not track bodyweight');
  });
});

/* ------------------------------------------- the bias-cancellation claim */

suite('observed expenditure', () => {
  test('recovers true expenditure from honest logging', () => {
    // Ate 2000/day, lost 1 lb/week over 14 days → burned ~2500/day.
    const est = observedTDEE({
      avgIntake: 2000, trendChange: -2, days: 14, units: 'imperial', loggedDayFraction: 1
    });
    near(est, 2500, 5);
  });

  test('a consistent logging bias cancels in the resulting target', () => {
    // Someone eating 2600 and burning 3100, who under-logs by 20%.
    // Deliberately above the calorie floor, so the floor is not what is measured.
    const truthIntake = 2600;
    const bias = 0.8;
    const est = observedTDEE({
      avgIntake: truthIntake * bias, trendChange: -2, days: 14, units: 'imperial', loggedDayFraction: 1
    });
    const target = buildTargets(baseProfile(), { expenditure: est, rate: 1 }).kcal;
    // The target is expressed in their under-logged units, so what they will
    // actually eat is target / bias — which should land near true maintenance
    // minus 500, despite the app never knowing the true numbers.
    near(target / bias, 3100 - 500, 40);
  });

  test('the calorie floor overrides bias cancellation when it binds', () => {
    const profile = baseProfile();
    const target = buildTargets(profile, { expenditure: 1900, rate: 1.5 });
    equal(target.kcal, calorieFloor(profile));
    equal(target.clampedToFloor, true);
  });

  test('refuses to answer when logging coverage is thin', () => {
    equal(observedTDEE({
      avgIntake: 2000, trendChange: -2, days: 14, units: 'imperial', loggedDayFraction: 0.4
    }), null);
  });

  test('refuses physiologically absurd results', () => {
    equal(observedTDEE({
      avgIntake: 800, trendChange: 0, days: 14, units: 'imperial', loggedDayFraction: 1
    }), null);
  });

  test('drifting bias is reported as unstable', () => {
    equal(biasStability([2500, 2520]).stable, true);
    equal(biasStability([2100, 2900]).stable, false);
  });
});

/* ------------------------------------------------------------ trends */

suite('trends', () => {
  test('slope is measured per day and signed', () => {
    const pts = [
      { date: isoAddDays(today, -6), value: 200 },
      { date: isoAddDays(today, -3), value: 199 },
      { date: today, value: 198 }
    ];
    near(slopePerDay(pts) * 7, -2.33, 0.15);
  });

  test('a single spike does not move the 7-day trend much', () => {
    const flat = Array.from({ length: 14 }, (_, i) => ({ date: isoAddDays(today, -13 + i), weight: 196 }));
    const spiked = flat.map((r, i) => (i === 13 ? { ...r, weight: 199 } : r));
    const a = trendSummary(flat, 'weight', today).trend;
    const b = trendSummary(spiked, 'weight', today).trend;
    assert(Math.abs(b - a) < 0.5, `a 3 lb spike moved the trend by ${(b - a).toFixed(2)} lb`);
  });

  test('densify inserts nulls for missing days', () => {
    const dense = densify([{ date: isoAddDays(today, -2), weight: 100 }], 'weight', isoAddDays(today, -4), today);
    equal(dense.length, 5);
    equal(dense.filter((d) => d.value == null).length, 4);
  });

  test('rolling mean waits for enough points', () => {
    const dense = densify(
      [{ date: today, weight: 100 }],
      'weight', isoAddDays(today, -6), today
    );
    equal(rollingMean(dense, 7, 3).every((p) => p.trend == null), true);
  });

  test('direction respects the dead band', () => {
    equal(direction(-0.1, 0.3), 'flat');
    equal(direction(-0.4, 0.3), 'down');
    equal(direction(0.4, 0.3), 'up');
    equal(direction(null, 0.3), 'unknown');
  });
});

/* --------------------------------------------------------- strength */

suite('strength', () => {
  test('one bad session does not flag a decline', () => {
    const state = makeState({ strength: 'stable', days: 30 });
    // Wreck the most recent session only.
    const last = state.workouts[state.workouts.length - 1];
    last.sets = last.sets.map((s) => ({ ...s, reps: 4 }));
    equal(strengthStatus(state.workouts).status, 'stable');
  });

  test('a sustained decline is flagged', () => {
    equal(strengthStatus(makeState({ strength: 'declining', days: 30 }).workouts).status, 'declining');
  });

  test('added load is flagged as improving', () => {
    equal(strengthStatus(makeState({ strength: 'improving', days: 30 }).workouts).status, 'improving');
  });

  test('fewer than four sessions of a lift says nothing', () => {
    const workouts = [
      { date: isoAddDays(today, -6), sets: [{ exercise: 'Squat', weight: 20, reps: 10 }] },
      { date: isoAddDays(today, -3), sets: [{ exercise: 'Squat', weight: 20, reps: 4 }] }
    ];
    equal(strengthStatus(workouts).status, 'insufficient');
  });
});

/* ---------------------------------------------------- classification */

suite('classification', () => {
  test('losing at target with strength held is on track', () => {
    const { cls, rec } = decide(makeState({ lossPerWeek: 1, strength: 'stable' }));
    equal(cls.state, STATES.ON_TRACK);
    equal(rec.action, 'hold');
  });

  test('flat weight with a shrinking waist is recomposition, not failure', () => {
    const { cls, rec } = decide(makeState({ lossPerWeek: 0, waistPerWeek: -0.3, strength: 'improving' }));
    equal(cls.state, STATES.RECOMP);
    equal(rec.action, 'hold');
  });

  test('losing weight while losing strength is an excessive deficit', () => {
    const { cls, rec } = decide(makeState({ lossPerWeek: 1.2, strength: 'declining' }));
    equal(cls.state, STATES.EXCESSIVE_DEFICIT);
    equal(rec.action, 'increase');
    assert(rec.deltaKcal > 0, 'calories should go up, not down');
  });

  test('fast loss with poor recovery is caught even if strength is unrated', () => {
    const { cls } = decide(makeState({ lossPerWeek: 2.2, strength: 'none', energy: 2, sleep: 5.6 }));
    equal(cls.state, STATES.EXCESSIVE_DEFICIT);
  });

  test('a genuine plateau with clean logging is called a plateau', () => {
    const { cls, streak } = decide(makeState({ lossPerWeek: 0, waistPerWeek: 0, logFraction: 1, days: 42 }));
    assert(streak >= 2, `expected a flat streak, got ${streak}`);
    equal(cls.state, STATES.PLATEAU);
  });

  test('the same plateau with patchy logging is NOT a plateau', () => {
    const { cls } = decide(makeState({ lossPerWeek: 0, waistPerWeek: 0, logFraction: 0.35, days: 42 }));
    equal(cls.state, STATES.POOR_ADHERENCE);
  });

  test('partial logging returns undecided rather than guessing', () => {
    const { cls } = decide(makeState({ lossPerWeek: 0, waistPerWeek: 0, logFraction: 0.7, days: 42 }));
    equal(cls.state, STATES.UNDECIDED);
  });

  test('too few weigh-ins is baseline, whatever else is true', () => {
    const state = makeState({ days: 14 });
    state.weights = state.weights.slice(-2);
    equal(decide(state).cls.state, STATES.BASELINE);
  });

  test('intakeTrust tracks coverage', () => {
    equal(intakeTrust(buildSnapshot(makeState({ logFraction: 1 }), today)), 'high');
    equal(intakeTrust(buildSnapshot(makeState({ logFraction: 0.3 }), today)), 'low');
  });
});

/* ------------------------------------------------------- adjustments */

suite('adjustment rules', () => {
  test('rule 1 — inside the target band, change nothing', () => {
    const { rec } = decide(makeState({ lossPerWeek: 1 }));
    equal(rec.action, 'hold');
    equal(rec.deltaKcal, 0);
  });

  test('rule 2 — a stall never cuts calories before three weeks', () => {
    const state = makeState({ lossPerWeek: 0, waistPerWeek: 0, days: 21 });
    const snap = buildSnapshot(state, today);
    const cls = classify(snap, 2);
    equal(recommendAdjustment(snap, cls, 2).action, 'hold');
  });

  test('rule 2 — after three flat weeks it cuts, and cites measured burn', () => {
    const state = makeState({ lossPerWeek: 0, waistPerWeek: 0, days: 49, logFraction: 1 });
    const snap = buildSnapshot(state, today);
    const cls = classify(snap, 3);
    const rec = recommendAdjustment(snap, cls, 3);
    equal(rec.action, 'decrease');
    assert(rec.deltaKcal < 0 && rec.deltaKcal >= -250, `step of ${rec.deltaKcal} is outside the allowed range`);
  });

  test('rule 3 — overshooting adds calories back', () => {
    const state = makeState({ lossPerWeek: 2.4, strength: 'declining' });
    const snap = buildSnapshot(state, today);
    const cls = classify(snap, 0);
    const rec = recommendAdjustment(snap, cls, 0);
    equal(rec.action, 'increase');
  });

  test('poor adherence is never answered with a calorie cut', () => {
    const { rec } = decide(makeState({ lossPerWeek: 0, waistPerWeek: 0, logFraction: 0.3, days: 42 }));
    equal(rec.action, 'hold');
    includes(rec.why, 'unlogged');
  });
});

/* ------------------------------------------------------------ scores */

suite('scores', () => {
  test('confidence is high when every signal agrees', () => {
    const snap = buildSnapshot(makeState({ lossPerWeek: 1, waistPerWeek: -0.3, strength: 'stable' }), today);
    assert(fatLossConfidence(snap).score >= 70, 'agreeing signals produced a low score');
  });

  test('confidence is capped when half the week is unlogged', () => {
    const snap = buildSnapshot(makeState({ lossPerWeek: 1.4, waistPerWeek: -0.4, logFraction: 0.3 }), today);
    assert(fatLossConfidence(snap).score <= 70, 'thin logging was not penalised');
  });

  test('consistency reflects what was actually done', () => {
    const full = consistencyScore(makeState({ logFraction: 1 }), today).score;
    const sparse = consistencyScore(makeState({ logFraction: 0.2 }), today).score;
    assert(full > sparse + 15, `expected a clear gap, got ${full} vs ${sparse}`);
  });
});

/* ------------------------------------------------------ fluctuation */

suite('fluctuation', () => {
  test('a jump after a restaurant meal is explained, not priced as fat', () => {
    const state = makeState({ days: 20 });
    const yesterday = isoAddDays(today, -1);
    state.weights = state.weights.map((w) => {
      if (w.date === yesterday) return { ...w, weight: 196 };
      if (w.date === today) return { ...w, weight: 198.4 };
      return w;
    });
    state.food.push({
      id: 'r1', date: yesterday, ts: Date.now(), mealType: 'Dinner',
      items: [], totals: { kcal: 1400, protein: 40, carbs: 160, fat: 60 }, prep: 'restaurant'
    });
    const note = fluctuationNote(state, today);
    assert(note, 'no note produced for a 2.4 lb overnight jump');
    includes(note.text, 'water');
    includes(note.text, 'restaurant');
  });

  test('normal daily wobble produces no note', () => {
    const state = makeState({ days: 20, noise: 0.2 });
    const yesterday = isoAddDays(today, -1);
    state.weights = state.weights.map((w) => {
      if (w.date === yesterday) return { ...w, weight: 196 };
      if (w.date === today) return { ...w, weight: 196.2 };
      return w;
    });
    equal(fluctuationNote(state, today), null);
  });
});

/* -------------------------------------------------------------- food */

suite('food', () => {
  test('portion priors need three corrections before they apply', () => {
    const two = [
      { foodKey: 'rice', aiGrams: 250, userGrams: 180 },
      { foodKey: 'rice', aiGrams: 240, userGrams: 175 }
    ];
    equal(portionPrior(two, 'Rice'), null);
    const three = two.concat({ foodKey: 'rice', aiGrams: 260, userGrams: 185 });
    equal(portionPrior(three, 'Rice').grams, 180);
  });

  test('the prior is the median, so one fat-finger entry cannot move it', () => {
    const corrections = [180, 175, 185, 2000, 180].map((g) => ({ foodKey: 'rice', aiGrams: 250, userGrams: g }));
    near(portionPrior(corrections, 'Rice').grams, 180, 6);
  });

  test('food keys normalise punctuation and case', () => {
    equal(foodKey('Dal (tadka, cooked)'), foodKey('dal tadka cooked'));
  });

  test('macros scale linearly with grams', () => {
    const rice = lookupFood('Basmati rice (cooked)');
    const a = macrosFor(rice, 100);
    const b = macrosFor(rice, 200);
    near(b.kcal, a.kcal * 2, 2);
  });

  test('search finds Indian dishes by common alias', () => {
    assert(searchFoods('chapati').length > 0, 'chapati did not match roti');
    assert(searchFoods('chickpea').length > 0, 'chickpea did not match chole');
  });

  test('a meal becomes a usual only after three occurrences', () => {
    const entry = (i) => ({
      id: `e${i}`, date: isoAddDays(today, -i), ts: i,
      items: [{ name: 'Bread omelette' }], totals: { kcal: 430, protein: 36 }
    });
    equal(usualMeals([entry(1), entry(2)]).length, 0);
    equal(usualMeals([entry(1), entry(2), entry(3)]).length, 1);
  });

  test('low confidence widens the range', () => {
    const tight = estimateRange({ kcal: 1000 }, 'high');
    const loose = estimateRange({ kcal: 1000 }, 'low');
    assert((loose.high - loose.low) > (tight.high - tight.low) * 2, 'confidence did not widen the range');
  });

  test('item totals add up', () => {
    const t = sumItems([
      { kcal: 420, protein: 30, carbs: 10, fat: 24 },
      { kcal: 235, protein: 5, carbs: 50, fat: 1 }
    ]);
    equal(t.kcal, 655);
    equal(t.protein, 35);
  });
});

/* ----------------------------------------------------------- helpers */

suite('aggregation', () => {
  test('average intake ignores unlogged days rather than counting them as zero', () => {
    const food = [
      { date: isoAddDays(today, -2), totals: { kcal: 2000 } },
      { date: today, totals: { kcal: 2200 } }
    ];
    near(avgDailyIntake(food, isoAddDays(today, -6), today), 2100, 1);
  });

  test('multiple meals on one day are summed, not averaged', () => {
    const food = [
      { date: today, totals: { kcal: 700 } },
      { date: today, totals: { kcal: 800 } }
    ];
    equal(avgDailyIntake(food, today, today), 1500);
  });

  test('median handles even-length input', () => {
    equal(median([1, 2, 3, 4]), 2.5);
  });
});

/* -------------------------------------------------------------- units */

suite('units', () => {
  test('weight and length are read independently', () => {
    const p = { weightUnit: 'kg', lengthUnit: 'in' };
    equal(weightUnit(p), 'kg');
    equal(lengthUnit(p), 'in');
    equal(fmtWeight(80, weightUnit(p)), '80.0 kg');
    equal(fmtLength(34, lengthUnit(p)), '34.0"');
  });

  test('a pre-split profile still resolves both units', () => {
    equal(weightUnit({ units: 'metric' }), 'kg');
    equal(lengthUnit({ units: 'metric' }), 'cm');
    equal(weightUnit({ units: 'imperial' }), 'lb');
    equal(lengthUnit({ units: 'imperial' }), 'in');
    equal(weightUnit({}), 'lb');
  });

  test('the explicit fields win over the legacy one', () => {
    equal(weightUnit({ units: 'imperial', weightUnit: 'kg' }), 'kg');
    equal(lengthUnit({ units: 'metric', lengthUnit: 'in' }), 'in');
  });

  test('conversion round-trips without drift', () => {
    near(convertWeight(convertWeight(180, 'lb', 'kg'), 'kg', 'lb'), 180, 0.001);
    near(convertLength(convertLength(34, 'in', 'cm'), 'cm', 'in'), 34, 0.001);
    near(convertWeight(180, 'lb', 'kg'), 81.65, 0.01);
    near(convertLength(34, 'in', 'cm'), 86.36, 0.01);
  });

  test('deadbands take weight from one unit and waist from the other', () => {
    const mixed = buildSnapshot(
      makeState({ days: 30, profile: baseProfile({ weightUnit: 'kg', lengthUnit: 'in' }) }),
      today, 14
    );
    equal(mixed.weightUnit, 'kg');
    equal(mixed.lengthUnit, 'in');
    equal(mixed.bands.weight, 0.23);   // kg table
    equal(mixed.bands.waist, 0.2);     // inch table
  });

  test('expenditure maths follows the weight unit alone', () => {
    // 1 kg/week of loss is ~7716 kcal/week, whatever the tape measure says.
    const est = observedTDEE({
      avgIntake: 2000, trendChange: -2, days: 14, weightUnit: 'kg', loggedDayFraction: 1
    });
    near(est, 2000 + (2 * 7716) / 14, 5);
  });
});

/* --------------------------------------------------------- food portions */

suite('food portions', () => {
  test('a food with a natural unit defaults to one of it, not to 150 g', () => {
    const egg = lookupFood('Whole egg (boiled)');
    equal(egg.serving.grams, 50);
    equal(defaultGrams(egg, []), 50);
    // The bug this replaces: one boiled egg logged as 150 g.
    equal(macrosFor(egg, defaultGrams(egg, [])).kcal, 78);
  });

  test('a personal prior still outranks the natural serving', () => {
    const rice = lookupFood('Basmati rice (cooked)');
    const corrections = [180, 180, 180].map((userGrams) => ({
      foodKey: foodKey(rice.name), aiGrams: 150, userGrams
    }));
    equal(defaultGrams(rice, corrections), 180);
  });

  test('serving counts read back from grams', () => {
    const egg = lookupFood('Whole egg (boiled)');
    equal(servingCount(egg, 100), 2);
    equal(servingCount({ serving: null }, 100), null);
  });

  test('density is recovered for an item that is not in the table', () => {
    const d = densityOf({ name: 'Something homemade', grams: 200, kcal: 300, protein: 20, carbs: 10, fat: 12 });
    near(d.kcal, 150, 0.01);
    near(d.p, 10, 0.01);
  });

  test('every food carries a serving weight', () => {
    const missing = FOOD_DB.filter((f) => !f.serving || !(f.serving.grams > 0));
    equal(missing.length, 0, `no serving weight for: ${missing.map((f) => f.name).join(', ')}`);
  });

  test('search matches words in any order, not just adjacent ones', () => {
    // "boiled egg" used to find nothing: the words are in the name but the
    // table spells it "Whole egg (boiled)".
    equal(searchFoods('boiled egg')[0].name, 'Whole egg (boiled)');
    equal(searchFoods('egg boiled')[0].name, 'Whole egg (boiled)');
    equal(searchFoods('whole wheat roti')[0].name, 'Roti (whole wheat)');
  });

  test('an exact phrase still outranks a scattered-word match', () => {
    equal(searchFoods('puri')[0].name, 'Puri');
    equal(searchFoods('paneer')[0].name.startsWith('Paneer'), true);
  });

  test('search finds a food by its other name', () => {
    equal(searchFoods('colocasia')[0].name, 'Arbi / colocasia sabzi');
    equal(searchFoods('arbi')[0].name, 'Arbi / colocasia sabzi');
    equal(searchFoods('dahi')[0].name, 'Curd / plain yogurt');
  });

  test('a nonsense query returns nothing rather than everything', () => {
    equal(searchFoods('zzzz').length, 0);
    equal(searchFoods('').length, 0);
  });

  test('macros agree with the stated calories (Atwater)', () => {
    // Ethanol carries 7 kcal/g and fibre less than 4, so these are expected to
    // miss and are named rather than silently tolerated.
    const exempt = new Set([
      'Beer', 'Red wine', 'Apple', 'Banana', 'Avocado', 'Tofu (firm)',
      'Cucumber salad', 'Mixed green salad (undressed)'
    ]);
    const off = FOOD_DB
      .filter((f) => !exempt.has(f.name))
      .map((f) => ({ name: f.name, drift: (f.p * 4 + f.c * 4 + f.f * 9 - f.kcal) / f.kcal }))
      .filter((r) => Math.abs(r.drift) > 0.08);
    equal(off.length, 0, `calories do not match macros for: ${off.map((r) => r.name).join(', ')}`);
  });
});

run();
