/**
 * Model calls.
 *
 * Two jobs, deliberately separate (PRD §50):
 *
 *   estimateMeal()  — vision. Turns a photo into named items with gram
 *                     estimates and a confidence. Nothing else.
 *   narrateReview() — coaching. Turns an already-computed snapshot and an
 *                     already-decided recommendation into prose. It is given
 *                     the recommendation; it does not get to choose one, and
 *                     the prompt forbids it from naming a calorie number that
 *                     is not in the input.
 *
 * The API key lives in the Cloudflare Worker, never in this bundle.
 */

import { toBase64 } from './image.js';

const TIMEOUT_MS = 45000;

export class AIError extends Error {
  constructor(message, { retryable = true, cause } = {}) {
    super(message);
    this.name = 'AIError';
    this.retryable = retryable;
    this.cause = cause;
  }
}

function endpointFor(settings, path) {
  const base = (settings.aiEndpoint || '').replace(/\/$/, '');
  if (!base) throw new AIError('No AI endpoint configured. Add your proxy URL in Profile → AI.', { retryable: false });
  return `${base}${path}`;
}

async function postJSON(url, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new AIError(`Estimate failed (${res.status}). ${detail.slice(0, 140)}`, {
        retryable: res.status >= 500 || res.status === 429
      });
    }
    return res.json();
  } catch (err) {
    if (err instanceof AIError) throw err;
    if (err.name === 'AbortError') throw new AIError('The estimate timed out. Try again, or enter it by hand.');
    throw new AIError('Could not reach the estimator. You can still log this meal manually.', { cause: err });
  } finally {
    clearTimeout(timer);
  }
}

/** Models sometimes wrap JSON in prose or fences despite instructions. */
function extractJSON(raw) {
  if (!raw) throw new AIError('Empty response from the estimator.');
  const cleaned = String(raw).replace(/```json|```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new AIError('Unreadable response from the estimator.');
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch (err) {
    throw new AIError('Unreadable response from the estimator.', { cause: err });
  }
}

/* ------------------------------------------------------------- vision */

const VISION_SYSTEM = `You estimate the nutritional content of a meal from a photograph.

You are good at naming dishes and poor at knowing how much fat was used to cook them. Behave accordingly: be specific about identification, and be openly uncertain about portion and hidden fat.

Rules:
- Break the plate into separate items. A curry, its rice and a side salad are three items, not one.
- Estimate the as-served weight of each item in grams.
- Give calories and macros for the weight you estimated, not per 100 g.
- South Asian food is common here. Use the correct dish name (dal tadka, chole, palak paneer, jeera rice, phulka) rather than a generic label.
- Cooking fat in home-cooked gravies is invisible in a photo. Do not pretend to see it. If a dish looks like it was cooked in oil or ghee, add a follow-up question about it instead of guessing.
- confidence: "high" only for packaged, weighed or single unmixed items; "medium" for identifiable dishes with uncertain portions; "low" for mixed, layered, saucy or restaurant plates.
- followUps: at most two questions, and only ones that would move the calorie estimate by more than about 10%. Return an empty array if the photo is already clear enough. Never ask more than two.

Respond with JSON only. No preamble, no markdown fences.

{
  "items": [
    {"name": string, "grams": number, "kcal": number, "protein": number, "carbs": number, "fat": number, "confidence": "high"|"medium"|"low", "cookingMethod": string|null}
  ],
  "confidence": "high"|"medium"|"low",
  "prepGuess": "home"|"restaurant"|"packaged"|"unknown",
  "followUps": [{"id": string, "question": string, "options": [string]}],
  "notes": string
}`;

/**
 * @param {File|Blob} file
 * @param {object} settings
 * @param {object} [context] { mealType, priors: [{name, grams, samples}], prep }
 */
export async function estimateMeal(file, settings, context = {}) {
  const { base64, mediaType } = await toBase64(file);
  const hints = [];
  if (context.mealType) hints.push(`Meal slot: ${context.mealType}.`);
  if (context.prep) hints.push(`The user says this was ${context.prep}.`);
  if (context.oilTsp != null) hints.push(`The user says roughly ${context.oilTsp} tsp of cooking oil was used across the dish.`);
  if (context.priors?.length) {
    hints.push(
      'This user has corrected these portions before; prefer their numbers when the item matches: '
      + context.priors.map((p) => `${p.name} ≈ ${p.grams} g`).join('; ') + '.'
    );
  }
  if (context.cuisine) hints.push(`Their usual cuisine is ${context.cuisine}.`);

  const data = await postJSON(endpointFor(settings, '/vision'), {
    system: VISION_SYSTEM,
    image: { base64, mediaType },
    hints: hints.join(' ')
  });

  const parsed = extractJSON(data.text);
  return normalizeVision(parsed);
}

/** Answer a follow-up question and re-estimate without re-uploading the photo. */
export async function refineMeal(items, answers, settings) {
  const data = await postJSON(endpointFor(settings, '/refine'), {
    system: `You revise a meal estimate using new information the user just provided. Adjust only what the answers affect — usually cooking fat and portion. Keep item names unchanged unless an answer contradicts one. Respond with JSON only, same shape as the input, plus an updated "confidence".`,
    items,
    answers
  });
  return normalizeVision(extractJSON(data.text));
}

function normalizeVision(parsed) {
  const items = (parsed.items || []).map((raw) => {
    const grams = num(raw.grams, 100);
    return {
      name: String(raw.name || 'Unnamed item').slice(0, 60),
      grams,
      aiGrams: grams,
      kcal: Math.max(0, Math.round(num(raw.kcal, 0))),
      protein: round1(num(raw.protein, 0)),
      carbs: round1(num(raw.carbs, 0)),
      fat: round1(num(raw.fat, 0)),
      confidence: conf(raw.confidence),
      cookingMethod: raw.cookingMethod || null,
      portionSize: 'medium'
    };
  });
  return {
    items,
    confidence: conf(parsed.confidence),
    prepGuess: ['home', 'restaurant', 'packaged'].includes(parsed.prepGuess) ? parsed.prepGuess : 'unknown',
    followUps: (parsed.followUps || []).slice(0, 2).map((q, i) => ({
      id: String(q.id || `q${i}`),
      question: String(q.question || '').slice(0, 160),
      options: (q.options || []).slice(0, 5).map(String)
    })),
    notes: String(parsed.notes || '').slice(0, 300)
  };
}

const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const round1 = (v) => Math.round(v * 10) / 10;
const conf = (v) => (['high', 'medium', 'low'].includes(v) ? v : 'medium');

/* ------------------------------------------------------------ coaching */

const COACH_SYSTEM = `You write a short weekly check-in for someone following a body-composition plan.

You are given: a data snapshot, a state that has already been classified, and a recommendation that has already been decided by a rules engine. Your job is to explain them in plain language. You do not decide anything.

Hard rules:
- Never state a calorie target, deficit or adjustment that is not present in the input. If the recommendation is to hold, say so plainly and do not hedge it into a suggestion to change something.
- Never describe a single day's weight change as fat gained or lost.
- Never diagnose, and never comment on how the person's body looks.
- If logging coverage is low, say that the intake numbers are unreliable rather than drawing conclusions from them.
- Praise only things the data actually shows. If there is nothing to praise, keep that section to one honest sentence.
- Plain sentences. No exclamation marks, no motivational filler, no emoji.

Respond with JSON only:
{
  "whatHappened": string,
  "whatItMeans": string,
  "whatWentWell": string,
  "nextWeek": [string],
  "watchFor": string|null
}
"nextWeek" holds one to three concrete actions, at most three.`;

export async function narrateReview({ snapshot, classification, recommendation, answers }, settings) {
  const data = await postJSON(endpointFor(settings, '/coach'), {
    system: COACH_SYSTEM,
    payload: { snapshot: slimSnapshot(snapshot), classification, recommendation, answers: answers || null }
  });
  const parsed = extractJSON(data.text);
  return {
    whatHappened: String(parsed.whatHappened || ''),
    whatItMeans: String(parsed.whatItMeans || ''),
    whatWentWell: String(parsed.whatWentWell || ''),
    nextWeek: (parsed.nextWeek || []).slice(0, 3).map(String),
    watchFor: parsed.watchFor ? String(parsed.watchFor) : null
  };
}

/** Send numbers, not the raw database. No photos, no notes, no free text. */
function slimSnapshot(snap) {
  return {
    weightUnit: snap.weightUnit,
    lengthUnit: snap.lengthUnit,
    weightTrend: round1(snap.weight.trend),
    weightChangeThisWeek: round1(snap.weight.weekChange),
    weightChangePerWeek: round1(snap.weight.perWeek),
    waistTrend: round1(snap.waist.trend),
    waistChangeThisWeek: round1(snap.waist.weekChange),
    avgCalories: snap.intake.avgKcal == null ? null : Math.round(snap.intake.avgKcal),
    avgProtein: snap.intake.avgProtein == null ? null : Math.round(snap.intake.avgProtein),
    calorieTarget: snap.targets.kcal ?? null,
    proteinTarget: snap.targets.protein ?? null,
    daysLogged: snap.intake.loggedDays,
    daysInWindow: snap.intake.totalDays,
    weighIns: snap.adherence.weighDays,
    workouts: snap.adherence.workouts,
    strength: snap.strength.status,
    avgSteps: snap.activity.avgSteps == null ? null : Math.round(snap.activity.avgSteps),
    avgSleepHours: round1(snap.activity.avgSleep),
    avgEnergy: round1(snap.activity.avgEnergy),
    observedExpenditure: snap.expenditure.avg ?? null
  };
}

/**
 * Offline / no-endpoint fallback for the weekly review. Deterministic prose
 * assembled from the same snapshot — worse writing, identical conclusions.
 */
export function localNarration({ snapshot, classification, recommendation }) {
  const s = snapshot;
  const wc = s.weight.weekChange;
  const parts = [];
  if (wc != null) parts.push(`Trend weight moved ${fmtSigned(wc)} ${s.weightUnit}.`);
  if (s.waist.weekChange != null) {
    parts.push(`Waist moved ${fmtSigned(s.waist.weekChange)} ${s.lengthUnit}.`);
  }
  if (s.intake.avgKcal != null) {
    parts.push(`You logged ${s.intake.loggedDays} of ${s.intake.totalDays} days, averaging ${Math.round(s.intake.avgKcal)} kcal and ${Math.round(s.intake.avgProtein || 0)} g protein.`);
  }
  return {
    whatHappened: parts.join(' ') || 'Not enough entries this week to summarise.',
    whatItMeans: classification.reasons,
    whatWentWell: s.adherence.workouts
      ? `You trained ${s.adherence.workouts} time${s.adherence.workouts === 1 ? '' : 's'} and weighed in on ${s.adherence.weighDays} days.`
      : `You weighed in on ${s.adherence.weighDays} days.`,
    nextWeek: [recommendation.why],
    watchFor: null,
    offline: true
  };
}

function fmtSigned(n) {
  const v = Math.round(n * 10) / 10;
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)}`;
}
