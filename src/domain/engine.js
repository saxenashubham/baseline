/**
 * The decision-support core (PRD §§27, 34–37, 46).
 *
 * Everything in this file is deterministic. The language model is allowed to
 * *narrate* these outputs in the weekly review; it is not allowed to produce
 * them, and it never sets a calorie number (PRD §50, AI #3).
 *
 * The one place this deviates from the PRD is the plateau / poor-adherence
 * split. §35 separates STATE 4 from STATE 5 on whether the user hit their
 * calorie target, but a photo-derived intake number cannot settle that on its
 * own. So the engine reports `intakeTrust` and refuses to call a plateau at all
 * while logging coverage is thin — it returns UNDECIDED instead, which points
 * at coverage rather than at calories.
 */

import {
  isoAddDays, todayISO, mean, median, round, weightUnit, lengthUnit
} from '../core/format.js';
import { trendSummary, direction, groupByWeek } from './trends.js';
import { observedTDEE, biasStability, KCAL_PER_UNIT_FAT } from './targets.js';

export const STATES = {
  ON_TRACK: 'on_track',
  RECOMP: 'recomposition',
  EXCESSIVE_DEFICIT: 'excessive_deficit',
  PLATEAU: 'plateau',
  POOR_ADHERENCE: 'poor_adherence',
  UNDECIDED: 'undecided',
  BASELINE: 'baseline'
};

export const STATE_COPY = {
  [STATES.ON_TRACK]:          { title: 'On track',              tone: 'on'    },
  [STATES.RECOMP]:            { title: 'Losing size, not weight', tone: 'on'  },
  [STATES.EXCESSIVE_DEFICIT]: { title: 'Deficit looks too steep', tone: 'off' },
  [STATES.PLATEAU]:           { title: 'Stalled',               tone: 'watch' },
  [STATES.POOR_ADHERENCE]:    { title: 'Logging is the gap',    tone: 'watch' },
  [STATES.UNDECIDED]:         { title: 'Not enough signal yet', tone: 'watch' },
  [STATES.BASELINE]:          { title: 'Collecting baseline',   tone: 'watch' }
};

/* ------------------------------------------------------------ deadbands */

/**
 * The two axes are independent: the weight bands come from the weight unit, the
 * waist band from the length unit. Someone weighing in kg and measuring in
 * inches gets the kg weight bands and the inch waist band, which is the point.
 *
 * They stay separate tables rather than a conversion — 0.5 lb and 0.23 kg are
 * each "the smallest weekly move worth reading on that scale", not one
 * converted into the other.
 */
export function bands(wUnit, lUnit) {
  const w = wUnit === 'kg'
    ? { weight: 0.23, fast: 0.68, slow: 0.23, good: [0.34, 0.68] }
    : { weight: 0.5,  fast: 1.5,  slow: 0.5,  good: [0.75, 1.5] };
  return { ...w, waist: lUnit === 'cm' ? 0.5 : 0.2 };
}

const bandsFor = (profile) => bands(weightUnit(profile), lengthUnit(profile));

/* ------------------------------------------------------------- strength */

/**
 * Per-exercise volume trend. A single bad session never moves this (PRD §27):
 * the comparison is the median of the last three sessions against the median of
 * the three before them, and it needs five sessions to say anything at all.
 */
export function strengthStatus(workouts, endISO = todayISO(), days = 28) {
  const from = isoAddDays(endISO, -(days - 1));
  const recent = workouts.filter((w) => w.date >= from && w.date <= endISO);
  const byExercise = new Map();

  for (const workout of recent) {
    for (const set of workout.sets || []) {
      if (!set.exercise) continue;
      const key = set.exercise.trim().toLowerCase();
      if (!byExercise.has(key)) byExercise.set(key, new Map());
      const sessions = byExercise.get(key);
      const volume = (set.weight || 0) * (set.reps || 0) || (set.reps || 0);
      sessions.set(workout.date, (sessions.get(workout.date) || 0) + volume);
    }
  }

  const perExercise = [];
  for (const [exercise, sessions] of byExercise) {
    const ordered = [...sessions.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map((e) => e[1]);
    // Five sessions minimum, and medians rather than means on both sides. A mean
    // of the last two lets one wrecked session swing the verdict by a third,
    // which is exactly the false alarm §27 says not to raise.
    if (ordered.length < 5) {
      perExercise.push({ exercise, status: 'insufficient', change: null, sessions: ordered.length });
      continue;
    }
    const late = median(ordered.slice(-3));
    const early = median(ordered.slice(-6, -3));
    const change = early ? (late - early) / early : 0;
    const status = change > 0.05 ? 'improving' : change < -0.08 ? 'declining' : 'stable';
    perExercise.push({ exercise, status, change, sessions: ordered.length });
  }

  const rated = perExercise.filter((e) => e.status !== 'insufficient');
  if (!rated.length) {
    return { status: 'insufficient', perExercise, sessions: recent.length };
  }
  const declining = rated.filter((e) => e.status === 'declining').length;
  const improving = rated.filter((e) => e.status === 'improving').length;
  let status = 'stable';
  if (declining >= Math.ceil(rated.length / 2)) status = 'declining';
  else if (improving >= Math.ceil(rated.length / 2)) status = 'improving';
  return { status, perExercise, sessions: recent.length };
}

/** Mean kcal across the days that actually have food logged in a range. */
export function avgDailyIntake(foodEntries, fromISO, toISO) {
  const perDay = new Map();
  for (const entry of foodEntries) {
    if (entry.date < fromISO || entry.date > toISO) continue;
    perDay.set(entry.date, (perDay.get(entry.date) || 0) + (entry.totals?.kcal || 0));
  }
  return mean([...perDay.values()]);
}

/* ------------------------------------------------------------- snapshot */

/**
 * Assemble every signal the engine needs for one window ending at `endISO`.
 * Views and the AI coach both read this; neither recomputes anything.
 */
export function buildSnapshot(state, endISO = todayISO(), days = 14) {
  const profile = state.profile || {};
  const wUnit = weightUnit(profile);
  const lUnit = lengthUnit(profile);
  const from = isoAddDays(endISO, -(days - 1));
  const dayList = [];
  for (let d = from; d <= endISO; d = isoAddDays(d, 1)) dayList.push(d);

  const weight = trendSummary(state.weights, 'weight', endISO);
  const waist = trendSummary(state.waists, 'waist', endISO, 21);

  const intakeByDay = dayList.map((date) => {
    const entries = state.food.filter((f) => f.date === date);
    if (!entries.length) return { date, kcal: null, protein: null };
    return {
      date,
      kcal: entries.reduce((a, e) => a + (e.totals?.kcal || 0), 0),
      protein: entries.reduce((a, e) => a + (e.totals?.protein || 0), 0)
    };
  });
  const loggedDays = intakeByDay.filter((d) => d.kcal != null);
  const loggedFraction = loggedDays.length / dayList.length;
  const avgIntake = mean(loggedDays.map((d) => d.kcal));
  const avgProtein = mean(loggedDays.map((d) => d.protein));

  const metrics = dayList.map((date) => state.metrics[date] || { date });
  const avgSteps = mean(metrics.map((m) => m.steps).filter(Number.isFinite));
  const avgSleep = mean(metrics.map((m) => m.sleepHours).filter(Number.isFinite));
  const avgEnergy = mean(metrics.map((m) => m.energy).filter(Number.isFinite));
  const avgHunger = mean(metrics.map((m) => m.hunger).filter(Number.isFinite));

  const weighDays = state.weights.filter((w) => w.date >= from && w.date <= endISO).length;
  const strength = strengthStatus(state.workouts, endISO);

  const targets = profile.targets || {};
  const calorieGap = avgIntake != null && targets.kcal ? avgIntake - targets.kcal : null;
  const proteinHitRate = targets.protein
    ? loggedDays.filter((d) => d.protein >= targets.protein * 0.9).length / Math.max(1, loggedDays.length)
    : null;

  // Observed expenditure over two overlapping windows, so drift is visible.
  const est14 = observedTDEE({
    avgIntake,
    trendChange: weight.weekChange != null ? weight.weekChange * 2 : null,
    days: 14,
    weightUnit: wUnit,
    loggedDayFraction: loggedFraction
  });
  const est28 = observedTDEE({
    avgIntake: avgDailyIntake(state.food, isoAddDays(endISO, -27), endISO),
    trendChange: weight.perWeek != null ? (weight.perWeek / 7) * 28 : null,
    days: 28,
    weightUnit: wUnit,
    loggedDayFraction: loggedFraction
  });
  const stability = biasStability([est14, est28]);

  return {
    endISO,
    days,
    weightUnit: wUnit,
    lengthUnit: lUnit,
    bands: bands(wUnit, lUnit),
    weight,
    waist,
    strength,
    intake: {
      avgKcal: avgIntake,
      avgProtein,
      loggedDays: loggedDays.length,
      totalDays: dayList.length,
      loggedFraction,
      calorieGap,
      proteinHitRate,
      byDay: intakeByDay
    },
    activity: { avgSteps, avgSleep, avgEnergy, avgHunger },
    adherence: {
      weighDays,
      weighFraction: weighDays / dayList.length,
      workouts: strength.sessions
    },
    expenditure: { est14, est28, ...stability },
    targets
  };
}

/* ------------------------------------------------------- classification */

/**
 * `intakeTrust` gates every conclusion that depends on knowing what was eaten.
 * high  — most days logged and the derived expenditure is steady across windows
 * low   — patchy logging, or the derived expenditure is jumping around
 */
export function intakeTrust(snap) {
  const { loggedFraction } = snap.intake;
  if (loggedFraction >= 0.85 && snap.expenditure.stable) return 'high';
  if (loggedFraction >= 0.6) return 'medium';
  return 'low';
}

export function classify(snap, historyWeeks = 0) {
  const b = snap.bands;
  const wDir = direction(snap.weight.weekChange, b.weight * 0.6);
  const waistDir = direction(snap.waist.weekChange, b.waist * 0.6);
  const strength = snap.strength.status;
  const trust = intakeTrust(snap);
  const energyLow = snap.activity.avgEnergy != null && snap.activity.avgEnergy <= 2.4;
  const sleepLow = snap.activity.avgSleep != null && snap.activity.avgSleep < 6.2;
  const fastLoss = snap.weight.perWeek != null && snap.weight.perWeek <= -b.fast;

  const reasons = [];
  const decide = (state, why) => ({ state, reasons: reasons.concat(why), trust, wDir, waistDir });

  if (snap.weight.trend == null || snap.adherence.weighDays < 4) {
    return decide(STATES.BASELINE, 'Fewer than four weigh-ins in this window.');
  }

  // STATE 3 first: overshooting is the only case where waiting is the wrong call.
  // Losing weight while losing strength is the failure this programme exists to
  // avoid, so it is caught whether or not the scale is moving unusually fast.
  if (strength === 'declining' && (fastLoss || wDir === 'down')) {
    return decide(
      STATES.EXCESSIVE_DEFICIT,
      fastLoss
        ? 'Weight is falling faster than target and strength is going with it.'
        : 'Weight is coming down but load and reps are falling across most lifts — that is muscle leaving, not just fat.'
    );
  }
  if (fastLoss && (energyLow || sleepLow)) {
    return decide(
      STATES.EXCESSIVE_DEFICIT,
      'Weight is falling faster than target while energy or sleep is down.'
    );
  }

  if (wDir === 'down' && (strength === 'stable' || strength === 'improving' || strength === 'insufficient')) {
    return decide(STATES.ON_TRACK, 'Trend weight is down and strength is holding.');
  }

  if (wDir === 'flat' && waistDir === 'down') {
    return decide(STATES.RECOMP, 'Weight is flat but waist is down — size is changing without the scale moving.');
  }

  if (wDir !== 'down' && waistDir !== 'down') {
    if (trust === 'low') {
      return decide(
        STATES.POOR_ADHERENCE,
        `Nothing is moving, and only ${snap.intake.loggedDays} of ${snap.intake.totalDays} days were logged — the intake number isn't reliable enough to blame calories.`
      );
    }
    if (trust === 'medium') {
      return decide(
        STATES.UNDECIDED,
        'Nothing is moving, but logging coverage is partial. Close the coverage gap before changing anything.'
      );
    }
    if (historyWeeks >= 2) {
      return decide(STATES.PLATEAU, 'Weight and waist flat for two or more weeks with reliable logging.');
    }
    return decide(STATES.UNDECIDED, 'Flat for one week. One week is not a plateau.');
  }

  return decide(STATES.UNDECIDED, 'Signals are mixed this week.');
}

/* ---------------------------------------------------- adjustment engine */

/**
 * PRD §36, with one addition: when observed expenditure is trustworthy the
 * adjustment is computed from it rather than taken from the fixed −100/−150
 * table, because the table is a guess at a number the data already contains.
 */
export function recommendAdjustment(snap, classification, historyWeeks = 0) {
  const b = snap.bands;
  const perWeek = snap.weight.perWeek;
  const targets = snap.targets || {};
  const trust = classification.trust;

  const hold = (why) => ({ action: 'hold', deltaKcal: 0, why, newTarget: targets.kcal ?? null });

  switch (classification.state) {
    case STATES.BASELINE:
      return hold('Still collecting a baseline. Nothing to adjust yet.');

    case STATES.ON_TRACK:
    case STATES.RECOMP:
      // Rule 1 — inside the target band, do nothing.
      if (perWeek == null || (Math.abs(perWeek) >= b.good[0] && Math.abs(perWeek) <= b.good[1])) {
        return hold('Rate of loss is inside the target band. Changing anything now would only add noise.');
      }
      return hold('Direction is right. Give it another week before touching the target.');

    case STATES.EXCESSIVE_DEFICIT: {
      // Rule 3 — back off.
      const delta = 150;
      return {
        action: 'increase',
        deltaKcal: delta,
        why: 'Loss is faster than planned and recovery markers are down. Adding calories protects strength.',
        newTarget: targets.kcal ? targets.kcal + delta : null
      };
    }

    case STATES.PLATEAU: {
      if (historyWeeks < 3) {
        return hold('Two flat weeks with good logging. Rule is to gather a third before adjusting.');
      }
      // Prefer the observed number over the fixed table when it is trustworthy.
      if (trust === 'high' && snap.expenditure.avg && targets.kcal) {
        const suggested = Math.round(
          snap.expenditure.avg - (b.good[0] * KCAL_PER_UNIT_FAT[snap.weightUnit]) / 7
        );
        const delta = Math.max(-250, Math.min(-75, suggested - targets.kcal));
        return {
          action: 'decrease',
          deltaKcal: delta,
          why: `Three flat weeks with reliable logging. Measured expenditure over this window is about ${snap.expenditure.avg} kcal/day, so the target moves to sit under it.`,
          newTarget: targets.kcal + delta
        };
      }
      return {
        action: 'decrease',
        deltaKcal: -125,
        why: 'Three flat weeks. Standard step down, or add the equivalent in daily steps instead.',
        newTarget: targets.kcal ? targets.kcal - 125 : null
      };
    }

    case STATES.POOR_ADHERENCE:
      return hold(
        `Do not change the calorie target while ${snap.intake.totalDays - snap.intake.loggedDays} of ${snap.intake.totalDays} days are unlogged. A lower target you also do not log changes nothing.`
      );

    default:
      return hold('Not enough clean signal to justify a change.');
  }
}

/* ---------------------------------------------- fat-loss confidence score */

/**
 * PRD §34 — an interpretation of agreement between independent signals, not a
 * body-fat measurement. Weighted so waist and weight can outvote a single
 * questionable input, and capped when logging is thin.
 */
export function fatLossConfidence(snap) {
  const b = snap.bands;
  const parts = [];

  if (snap.weight.weekChange != null) {
    const s = clamp01(-snap.weight.weekChange / b.fast);
    parts.push({ label: 'Weight trend', weight: 0.4, score: s });
  }
  if (snap.waist.weekChange != null) {
    const s = clamp01(-snap.waist.weekChange / (b.waist * 2));
    parts.push({ label: 'Waist trend', weight: 0.3, score: s });
  }
  if (snap.strength.status !== 'insufficient') {
    const s = snap.strength.status === 'declining' ? 0.25 : snap.strength.status === 'improving' ? 1 : 0.8;
    parts.push({ label: 'Strength held', weight: 0.15, score: s });
  }
  parts.push({ label: 'Logging coverage', weight: 0.15, score: clamp01(snap.intake.loggedFraction) });

  const totalWeight = parts.reduce((a, p) => a + p.weight, 0);
  const raw = parts.reduce((a, p) => a + p.weight * p.score, 0) / (totalWeight || 1);
  const ceiling = snap.intake.loggedFraction < 0.5 ? 0.7 : 1;
  return { score: Math.round(Math.min(raw, ceiling) * 100), parts };
}

function clamp01(n) {
  return Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
}

/* -------------------------------------------------- consistency (PRD §46) */

export function consistencyScore(state, endISO = todayISO(), days = 7) {
  const from = isoAddDays(endISO, -(days - 1));
  const dayList = [];
  for (let d = from; d <= endISO; d = isoAddDays(d, 1)) dayList.push(d);
  const targets = state.profile?.targets || {};

  const loggedFood = dayList.filter((d) => state.food.some((f) => f.date === d)).length;
  const weighed = dayList.filter((d) => state.weights.some((w) => w.date === d)).length;
  const proteinHit = targets.protein
    ? dayList.filter((d) => {
        const total = state.food.filter((f) => f.date === d).reduce((a, f) => a + (f.totals?.protein || 0), 0);
        return total >= targets.protein * 0.9;
      }).length
    : 0;
  const stepGoal = state.profile?.stepTarget || 8000;
  const stepsHit = dayList.filter((d) => (state.metrics[d]?.steps || 0) >= stepGoal).length;
  const workoutTarget = state.profile?.workoutsPerWeek || 3;
  const workouts = Math.min(
    workoutTarget,
    state.workouts.filter((w) => w.date >= from && w.date <= endISO).length
  );

  const components = [
    { label: 'Food logged', value: loggedFood / days, weight: 0.3 },
    { label: 'Protein target', value: targets.protein ? proteinHit / days : 0, weight: 0.2 },
    { label: 'Weigh-ins', value: weighed / days, weight: 0.2 },
    { label: 'Workouts', value: workouts / workoutTarget, weight: 0.2 },
    { label: 'Steps', value: stepsHit / days, weight: 0.1 }
  ];
  const score = Math.round(components.reduce((a, c) => a + c.weight * clamp01(c.value), 0) * 100);
  return { score, components };
}

/* ------------------------------------------- daily fluctuation narration */

/**
 * PRD §37 — explain a scale jump instead of pricing it as fat.
 * Looks for a plausible cause in yesterday's own data before speculating.
 */
export function fluctuationNote(state, endISO = todayISO()) {
  const b = bandsFor(state.profile);
  const today = state.weights.find((w) => w.date === endISO);
  const yesterdayISO = isoAddDays(endISO, -1);
  const yesterday = state.weights.find((w) => w.date === yesterdayISO);
  if (!today || !yesterday) return null;

  const jump = today.weight - yesterday.weight;
  if (jump < b.weight) return null;

  const causes = [];
  const prevFood = state.food.filter((f) => f.date === yesterdayISO);
  if (prevFood.some((f) => f.prep === 'restaurant')) causes.push('a restaurant meal yesterday');
  const prevKcal = prevFood.reduce((a, f) => a + (f.totals?.kcal || 0), 0);
  const prevCarbs = prevFood.reduce((a, f) => a + (f.totals?.carbs || 0), 0);
  const targets = state.profile?.targets || {};
  if (targets.carbs && prevCarbs > targets.carbs * 1.3) causes.push('a higher-carbohydrate day');
  if (targets.kcal && prevKcal > targets.kcal * 1.2) causes.push('a bigger day of eating');
  const prevMetrics = state.metrics[yesterdayISO] || {};
  if (prevMetrics.sleepHours != null && prevMetrics.sleepHours < 6) causes.push('short sleep');
  if (state.workouts.some((w) => w.date === yesterdayISO)) causes.push('yesterday’s training');

  const causeText = causes.length ? ` Likely contributors: ${causes.join(', ')}.` : '';
  return {
    jump: round(jump, 1),
    text: `Today’s reading is up on yesterday. Day-to-day moves of this size are water and gut contents, not stored fat.${causeText} The trend line is the number to read.`
  };
}

/* ------------------------------------------------------- history helper */

/** How many consecutive recent weeks were flat — feeds the plateau rules. */
export function flatWeekStreak(state, endISO = todayISO()) {
  const b = bandsFor(state.profile);
  const weeks = groupByWeek(state.weights.filter((w) => w.date <= endISO)).slice(-6);
  let streak = 0;
  for (let i = weeks.length - 1; i > 0; i -= 1) {
    const cur = mean(weeks[i].items.map((w) => w.weight));
    const prev = mean(weeks[i - 1].items.map((w) => w.weight));
    if (cur == null || prev == null) break;
    if (Math.abs(cur - prev) < b.weight * 0.6) streak += 1;
    else break;
  }
  return streak;
}
