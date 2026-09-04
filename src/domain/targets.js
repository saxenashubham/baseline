/**
 * Calorie and macro targets (PRD §5, step 3).
 *
 * Two estimates of expenditure live here:
 *
 *   1. `predictedTDEE`  — Mifflin-St Jeor × activity factor. Used on day 1 when
 *                         there is no history to learn from.
 *   2. `observedTDEE`   — derived from logged intake and the change in TREND
 *                         weight over the same window. This is the one that
 *                         matters after ~2 weeks: intake − Δstored energy = out.
 *
 * The second one is deliberately blind to how accurate the food logging is. If
 * intake is systematically under-reported by some fraction, the observed
 * expenditure comes out low by roughly the same fraction, and the target it
 * produces is still right *in the user's own logging units*. That property only
 * holds while the bias is consistent, which is why `biasStability` is reported
 * alongside it and the UI refuses to lean on it when logging is patchy.
 */

import { KG_PER_LB, clamp, mean } from '../core/format.js';

const KCAL_PER_LB_FAT = 3500;
const KCAL_PER_KG_FAT = KCAL_PER_LB_FAT / KG_PER_LB;

export const ACTIVITY_FACTORS = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9
};

export const ACTIVITY_LABELS = {
  sedentary: 'Desk job, little walking',
  light: 'Desk job plus light activity 1–3×/week',
  moderate: 'Moderate activity 3–5×/week',
  active: 'Hard activity 6–7×/week',
  very_active: 'Physical job or twice-daily training'
};

/** Weight in kg, height in cm, age in years. */
export function bmrMifflinStJeor({ weightKg, heightCm, age, sex }) {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return sex === 'female' ? base - 161 : base + 5;
}

export function predictedTDEE(profile) {
  const bmr = bmrMifflinStJeor(profile);
  return bmr * (ACTIVITY_FACTORS[profile.activityLevel] || 1.375);
}

/**
 * Absolute floor on the calorie target. The app is allowed to suggest a deficit;
 * it is not allowed to suggest an aggressive one, and it never goes below the
 * user's own BMR estimate (PRD §51 — stay out of clinical territory).
 */
export function calorieFloor(profile) {
  const bmr = bmrMifflinStJeor(profile);
  const hardFloor = profile.sex === 'female' ? 1200 : 1500;
  return Math.max(hardFloor, Math.round(bmr));
}

/**
 * @param {object} profile
 * @param {number} expenditure  kcal/day — predicted or observed
 * @param {number} rate         desired loss per week, in the user's weight unit
 */
export function calorieTarget(profile, expenditure, rate) {
  const perUnit = profile.units === 'metric' ? KCAL_PER_KG_FAT : KCAL_PER_LB_FAT;
  const dailyDeficit = (Math.abs(rate) * perUnit) / 7;
  const direction = profile.goal === 'gain' ? 1 : profile.goal === 'maintain' ? 0 : -1;
  const raw = expenditure + direction * dailyDeficit;
  const floor = calorieFloor(profile);
  return {
    kcal: Math.round(clamp(raw, floor, expenditure + 1200)),
    clampedToFloor: raw < floor,
    floor
  };
}

/**
 * Protein is anchored to bodyweight, fat to a share of calories, carbs take the
 * remainder. Protein leads because muscle retention is the stated constraint.
 */
export function macroTargets(profile, kcal) {
  const weightKg = profile.units === 'metric' ? profile.weight : profile.weight * KG_PER_LB;
  const proteinPerKg = profile.goal === 'lose' ? 1.8 : 1.6;
  const protein = Math.round(weightKg * proteinPerKg);
  const fat = Math.round((kcal * 0.27) / 9);
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  return { protein, fat, carbs };
}

export function buildTargets(profile, { expenditure = null, rate = null } = {}) {
  const tdee = expenditure ?? predictedTDEE(profile);
  const weeklyRate = rate ?? profile.weeklyRate ?? (profile.units === 'metric' ? 0.45 : 1);
  const cal = calorieTarget(profile, tdee, weeklyRate);
  const macros = macroTargets(profile, cal.kcal);
  return {
    expenditure: Math.round(tdee),
    kcal: cal.kcal,
    clampedToFloor: cal.clampedToFloor,
    floor: cal.floor,
    weeklyRate,
    ...macros
  };
}

/**
 * Observed expenditure from real data.
 *
 * @param {object} args
 * @param {number} args.avgIntake         mean logged kcal/day over the window
 * @param {number} args.trendChange       change in TREND weight over the window
 *                                        (negative = loss), in profile units
 * @param {number} args.days              window length
 * @param {string} args.units
 * @param {number} args.loggedDayFraction share of days in the window with food logged
 */
export function observedTDEE({ avgIntake, trendChange, days, units, loggedDayFraction }) {
  if (!Number.isFinite(avgIntake) || !Number.isFinite(trendChange) || days < 10) return null;
  if (loggedDayFraction < 0.7) return null;
  const perUnit = units === 'metric' ? KCAL_PER_KG_FAT : KCAL_PER_LB_FAT;
  const storedPerDay = (trendChange * perUnit) / days;
  const value = avgIntake - storedPerDay;
  // Anything outside this envelope means the inputs are wrong, not the metabolism.
  if (value < 900 || value > 6000) return null;
  return Math.round(value);
}

/**
 * How trustworthy the observed number is. Two windows that disagree wildly mean
 * the logging bias is drifting, and a bias that drifts does not cancel.
 */
export function biasStability(windowEstimates) {
  const vals = windowEstimates.filter(Number.isFinite);
  if (vals.length < 2) return { stable: false, spread: null };
  const avg = mean(vals);
  const spread = (Math.max(...vals) - Math.min(...vals)) / avg;
  return { stable: spread <= 0.12, spread, avg: Math.round(avg) };
}
