/**
 * Food reference data, personal portion priors, and meal memory.
 *
 * The reference table exists for three reasons: offline search (PRD §16B),
 * a sanity check on anything the vision model returns, and — most importantly —
 * the oil correction in §15. Cooking fat is invisible in a photograph, so for
 * home-cooked dishes it is asked about and added arithmetically rather than
 * guessed at from pixels.
 *
 * Values are per 100 g as served. They are a starting point that the user's own
 * corrections override. Where they come from, so it is not a mystery later:
 *
 *  - Generic and Western single foods (egg, rice, chicken, oats, oils, dairy,
 *    fruit) are USDA FoodData Central, SR Legacy / Foundation, rounded.
 *    https://fdc.nal.usda.gov
 *  - Indian single foods (paneer, dals, atta) follow the Indian Food
 *    Composition Tables 2017 (NIN / ICMR).
 *    https://www.nin.res.in/ebooks/IFCT2017.pdf
 *  - Indian composite dishes (a sabzi, a biryani) have no authoritative
 *    per-100 g row anywhere, because the recipe is the variable. They are
 *    computed from IFCT ingredient rows at a common home ratio and are honestly
 *    ±20%. That is why cooking fat is asked about separately (§15) rather than
 *    baked into the density, and why every estimate carries a range.
 *
 * Every row is checked against the Atwater identity (4·protein + 4·carb +
 * 9·fat ≈ kcal) in the test suite, which is what catches a mistyped macro.
 * Alcohol and high-fibre foods are the known exceptions — ethanol carries
 * 7 kcal/g and fibre less than 4 — and are listed there by name.
 */

import { median } from '../core/format.js';

export const OIL_KCAL_PER_TSP = 40;   // ~4.5 g fat
export const OIL_FAT_PER_TSP = 4.5;

/** Fallback portion for a food with no natural unit and no personal prior. */
export const DEFAULT_GRAMS = 150;

/**
 * name, kcal, protein, carbs, fat — all per 100 g. `tags` drive search.
 *
 * `serving` is the weight of one natural unit: one egg, one roti, one katori.
 * It exists because "one boiled egg" is a question a person can answer and
 * "50 grams of egg" is not, and it sets the default portion when a food is
 * added by hand instead of a flat 150 g.
 */
export const FOOD_DB = [
  // Indian — breads and grains
  { name: 'Roti (whole wheat)', kcal: 297, p: 10, c: 56, f: 4, tags: ['chapati', 'phulka', 'indian'], serving: { label: 'roti', grams: 40 } },
  { name: 'Paratha (plain)', kcal: 330, p: 8, c: 45, f: 13, tags: ['indian', 'bread'], serving: { label: 'paratha', grams: 60 } },
  { name: 'Naan', kcal: 310, p: 9, c: 50, f: 8, tags: ['indian', 'bread'], serving: { label: 'naan', grams: 90 } },
  { name: 'Puri', kcal: 400, p: 8, c: 45, f: 21, tags: ['indian', 'fried'], serving: { label: 'puri', grams: 20 } },
  { name: 'Basmati rice (cooked)', kcal: 130, p: 2.7, c: 28, f: 0.3, tags: ['rice', 'indian'], serving: { label: 'katori', grams: 150 } },
  { name: 'Jeera rice', kcal: 165, p: 3, c: 29, f: 4, tags: ['rice', 'indian'], serving: { label: 'katori', grams: 150 } },
  { name: 'Pulao', kcal: 175, p: 4, c: 28, f: 5, tags: ['rice', 'indian'], serving: { label: 'katori', grams: 150 } },
  { name: 'Vegetable biryani', kcal: 185, p: 4, c: 29, f: 6, tags: ['rice', 'indian'], serving: { label: 'plate', grams: 200 } },
  { name: 'Chicken biryani', kcal: 200, p: 10, c: 24, f: 7, tags: ['rice', 'indian'], serving: { label: 'plate', grams: 200 } },
  { name: 'Poha', kcal: 135, p: 2.5, c: 25, f: 3, tags: ['indian', 'breakfast'], serving: { label: 'katori', grams: 150 } },
  { name: 'Upma', kcal: 150, p: 4, c: 22, f: 5, tags: ['indian', 'breakfast'], serving: { label: 'katori', grams: 150 } },
  { name: 'Idli', kcal: 135, p: 4, c: 27, f: 0.6, tags: ['indian', 'south', 'breakfast'], serving: { label: 'idli', grams: 40 } },
  { name: 'Plain dosa', kcal: 190, p: 4, c: 30, f: 6, tags: ['indian', 'south'], serving: { label: 'dosa', grams: 85 } },
  { name: 'Masala dosa', kcal: 215, p: 4.5, c: 32, f: 8, tags: ['indian', 'south'], serving: { label: 'dosa', grams: 150 } },

  // Indian — dals, legumes, curries
  { name: 'Dal (tadka, cooked)', kcal: 115, p: 6, c: 14, f: 4, tags: ['indian', 'lentil', 'toor', 'moong'], serving: { label: 'katori', grams: 150 } },
  { name: 'Dal (no tadka)', kcal: 90, p: 6, c: 14, f: 1, tags: ['indian', 'lentil'], serving: { label: 'katori', grams: 150 } },
  { name: 'Rajma', kcal: 125, p: 6.5, c: 16, f: 4, tags: ['indian', 'kidney bean'], serving: { label: 'katori', grams: 150 } },
  { name: 'Chole / chana masala', kcal: 145, p: 6, c: 18, f: 5.5, tags: ['indian', 'chickpea'], serving: { label: 'katori', grams: 150 } },
  { name: 'Kadhi', kcal: 95, p: 3.5, c: 8, f: 5.5, tags: ['indian', 'yogurt'], serving: { label: 'katori', grams: 150 } },
  { name: 'Sambar', kcal: 85, p: 4, c: 11, f: 3, tags: ['indian', 'south'], serving: { label: 'katori', grams: 150 } },
  { name: 'Paneer butter masala', kcal: 235, p: 9, c: 9, f: 18, tags: ['indian', 'paneer', 'restaurant'], serving: { label: 'katori', grams: 120 } },
  { name: 'Palak paneer', kcal: 180, p: 9, c: 7, f: 13, tags: ['indian', 'paneer'], serving: { label: 'katori', grams: 120 } },
  { name: 'Paneer (raw)', kcal: 296, p: 18, c: 3.5, f: 23, tags: ['indian', 'cheese'], serving: { label: 'cube', grams: 15 } },
  { name: 'Aloo sabzi', kcal: 120, p: 2.5, c: 18, f: 4.5, tags: ['indian', 'potato', 'sabzi'], serving: { label: 'katori', grams: 120 } },
  { name: 'Mixed vegetable sabzi', kcal: 95, p: 3, c: 11, f: 4.5, tags: ['indian', 'sabzi'], serving: { label: 'katori', grams: 120 } },
  { name: 'Bhindi masala', kcal: 110, p: 2.5, c: 10, f: 7, tags: ['indian', 'okra', 'sabzi'], serving: { label: 'katori', grams: 120 } },
  { name: 'Chicken curry (home)', kcal: 150, p: 14, c: 4, f: 8.5, tags: ['indian', 'chicken'], serving: { label: 'katori', grams: 150 } },
  { name: 'Butter chicken', kcal: 215, p: 14, c: 6, f: 15, tags: ['indian', 'chicken', 'restaurant'], serving: { label: 'katori', grams: 150 } },
  { name: 'Chicken tikka (dry)', kcal: 175, p: 25, c: 3, f: 7, tags: ['indian', 'chicken', 'grilled'], serving: { label: 'piece', grams: 40 } },
  { name: 'Mutton curry', kcal: 200, p: 16, c: 4, f: 14, tags: ['indian', 'lamb', 'goat'], serving: { label: 'katori', grams: 150 } },
  { name: 'Keema', kcal: 215, p: 17, c: 4, f: 15, tags: ['indian', 'mince'], serving: { label: 'katori', grams: 120 } },
  { name: 'Egg curry', kcal: 155, p: 9, c: 5, f: 11, tags: ['indian', 'egg'], serving: { label: 'katori', grams: 150 } },
  { name: 'Fish curry', kcal: 135, p: 14, c: 4, f: 7, tags: ['indian', 'fish'], serving: { label: 'katori', grams: 150 } },

  // Indian — sides, snacks
  { name: 'Raita', kcal: 65, p: 3, c: 5, f: 3.5, tags: ['indian', 'yogurt', 'side'], serving: { label: 'katori', grams: 100 } },
  { name: 'Cucumber salad', kcal: 25, p: 1, c: 4, f: 0.3, tags: ['salad', 'side'], serving: { label: 'bowl', grams: 100 } },
  { name: 'Mint chutney', kcal: 60, p: 2, c: 6, f: 3, tags: ['indian', 'side'], serving: { label: 'tbsp', grams: 15 } },
  { name: 'Papad (roasted)', kcal: 350, p: 22, c: 50, f: 5, tags: ['indian', 'side'], serving: { label: 'papad', grams: 13 } },
  { name: 'Samosa', kcal: 300, p: 5, c: 32, f: 17, tags: ['indian', 'fried', 'snack'], serving: { label: 'samosa', grams: 60 } },
  { name: 'Pakora', kcal: 315, p: 7, c: 28, f: 19, tags: ['indian', 'fried', 'snack'], serving: { label: 'pakora', grams: 25 } },
  { name: 'Seekh kebab', kcal: 210, p: 17, c: 3, f: 14, tags: ['indian', 'grilled'], serving: { label: 'kebab', grams: 60 } },
  { name: 'Lassi (sweet)', kcal: 95, p: 3, c: 15, f: 2.5, tags: ['indian', 'drink'], serving: { label: 'glass', grams: 250 } },
  { name: 'Masala chai (with milk & sugar)', kcal: 60, p: 1.6, c: 8, f: 2, tags: ['indian', 'drink', 'tea'], serving: { label: 'cup', grams: 150 } },

  { name: 'Arbi / colocasia sabzi', kcal: 150, p: 2, c: 20, f: 7, tags: ['indian', 'colocasia', 'arbi', 'taro', 'sabzi'], serving: { label: 'katori', grams: 120 } },
  { name: 'Baingan bharta', kcal: 115, p: 2.5, c: 9, f: 8, tags: ['indian', 'aubergine', 'eggplant', 'brinjal', 'sabzi'], serving: { label: 'katori', grams: 120 } },
  { name: 'Aloo gobi', kcal: 110, p: 2.5, c: 13, f: 5.5, tags: ['indian', 'cauliflower', 'potato', 'sabzi'], serving: { label: 'katori', grams: 120 } },
  { name: 'Moong dal (cooked)', kcal: 105, p: 7, c: 15, f: 1.5, tags: ['indian', 'lentil', 'moong', 'dal'], serving: { label: 'katori', grams: 150 } },
  { name: 'Khichdi', kcal: 120, p: 4, c: 19, f: 3, tags: ['indian', 'rice', 'dal'], serving: { label: 'katori', grams: 150 } },
  { name: 'Rasam', kcal: 35, p: 1.5, c: 4, f: 1.5, tags: ['indian', 'south', 'soup'], serving: { label: 'katori', grams: 150 } },
  { name: 'Curd / plain yogurt', kcal: 61, p: 3.5, c: 4.7, f: 3.3, tags: ['indian', 'dahi', 'yogurt', 'dairy'], serving: { label: 'katori', grams: 100 } },
  { name: 'Paneer tikka', kcal: 230, p: 15, c: 6, f: 16, tags: ['indian', 'paneer', 'grilled'], serving: { label: 'piece', grams: 30 } },
  { name: 'Besan chilla', kcal: 180, p: 8, c: 18, f: 8, tags: ['indian', 'chickpea', 'breakfast', 'pancake'], serving: { label: 'chilla', grams: 70 } },
  { name: 'Uttapam', kcal: 175, p: 4, c: 27, f: 5.5, tags: ['indian', 'south', 'breakfast'], serving: { label: 'uttapam', grams: 120 } },
  { name: 'Medu vada', kcal: 300, p: 7, c: 34, f: 15, tags: ['indian', 'south', 'fried', 'snack'], serving: { label: 'vada', grams: 40 } },
  { name: 'Dhokla', kcal: 160, p: 6, c: 24, f: 4, tags: ['indian', 'gujarati', 'snack', 'steamed'], serving: { label: 'piece', grams: 40 } },
  { name: 'Coconut chutney', kcal: 190, p: 3, c: 8, f: 16, tags: ['indian', 'south', 'side'], serving: { label: 'tbsp', grams: 20 } },
  { name: 'Sprouts salad', kcal: 100, p: 7, c: 15, f: 1, tags: ['indian', 'salad', 'moong', 'snack'], serving: { label: 'bowl', grams: 100 } },
  { name: 'Roasted chana', kcal: 380, p: 22, c: 58, f: 5, tags: ['indian', 'chickpea', 'snack'], serving: { label: 'handful', grams: 30 } },
  { name: 'Kheer', kcal: 130, p: 3.5, c: 20, f: 4, tags: ['indian', 'dessert', 'rice'], serving: { label: 'katori', grams: 120 } },
  { name: 'Suji halwa', kcal: 350, p: 5, c: 45, f: 16, tags: ['indian', 'dessert', 'semolina'], serving: { label: 'katori', grams: 80 } },

  // Everyday staples
  { name: 'Whole egg (boiled)', kcal: 155, p: 13, c: 1.1, f: 11, tags: ['egg', 'breakfast'], serving: { label: 'egg', grams: 50 } },
  { name: 'Egg white', kcal: 52, p: 11, c: 0.7, f: 0.2, tags: ['egg'], serving: { label: 'white', grams: 33 } },
  { name: 'Bread omelette', kcal: 240, p: 11, c: 20, f: 13, tags: ['egg', 'breakfast'], serving: { label: 'omelette', grams: 150 } },
  { name: 'White bread', kcal: 265, p: 9, c: 49, f: 3.2, tags: ['bread'], serving: { label: 'slice', grams: 28 } },
  { name: 'Whole wheat bread', kcal: 250, p: 12, c: 43, f: 3.5, tags: ['bread'], serving: { label: 'slice', grams: 32 } },
  { name: 'Greek yogurt (nonfat)', kcal: 59, p: 10, c: 3.6, f: 0.4, tags: ['dairy', 'protein'], serving: { label: 'cup', grams: 170 } },
  { name: 'Whole milk', kcal: 61, p: 3.2, c: 4.8, f: 3.3, tags: ['dairy', 'drink'], serving: { label: 'cup', grams: 244 } },
  { name: 'Skim milk', kcal: 34, p: 3.4, c: 5, f: 0.1, tags: ['dairy', 'drink'], serving: { label: 'cup', grams: 245 } },
  { name: 'Whey protein (powder)', kcal: 390, p: 78, c: 8, f: 5, tags: ['protein', 'supplement'], serving: { label: 'scoop', grams: 30 } },
  { name: 'Chicken breast (cooked)', kcal: 165, p: 31, c: 0, f: 3.6, tags: ['chicken', 'protein'], serving: { label: 'breast', grams: 120 } },
  { name: 'Chicken thigh (cooked)', kcal: 209, p: 26, c: 0, f: 11, tags: ['chicken', 'protein'], serving: { label: 'thigh', grams: 95 } },
  { name: 'Salmon (cooked)', kcal: 208, p: 22, c: 0, f: 13, tags: ['fish', 'protein'], serving: { label: 'fillet', grams: 120 } },
  { name: 'Tuna (canned in water)', kcal: 116, p: 26, c: 0, f: 0.8, tags: ['fish', 'protein'], serving: { label: 'can', grams: 142 } },
  { name: 'Tofu (firm)', kcal: 144, p: 17, c: 3, f: 9, tags: ['vegetarian', 'protein'], serving: { label: 'block', grams: 120 } },
  { name: 'Lentils (cooked, plain)', kcal: 116, p: 9, c: 20, f: 0.4, tags: ['legume'], serving: { label: 'katori', grams: 150 } },
  { name: 'Chickpeas (cooked)', kcal: 164, p: 9, c: 27, f: 2.6, tags: ['legume'], serving: { label: 'katori', grams: 150 } },
  { name: 'Brown rice (cooked)', kcal: 123, p: 2.7, c: 26, f: 1, tags: ['rice', 'grain'], serving: { label: 'katori', grams: 150 } },
  { name: 'Quinoa (cooked)', kcal: 120, p: 4.4, c: 21, f: 1.9, tags: ['grain'], serving: { label: 'katori', grams: 150 } },
  { name: 'Oats (dry)', kcal: 389, p: 17, c: 66, f: 7, tags: ['grain', 'breakfast'], serving: { label: 'serving', grams: 40 } },
  { name: 'Pasta (cooked)', kcal: 158, p: 5.8, c: 31, f: 0.9, tags: ['grain'], serving: { label: 'bowl', grams: 180 } },
  { name: 'Potato (boiled)', kcal: 87, p: 2, c: 20, f: 0.1, tags: ['vegetable'], serving: { label: 'medium', grams: 150 } },
  { name: 'Sweet potato (baked)', kcal: 90, p: 2, c: 21, f: 0.2, tags: ['vegetable'], serving: { label: 'medium', grams: 130 } },
  { name: 'Mixed green salad (undressed)', kcal: 20, p: 1.5, c: 3.5, f: 0.2, tags: ['salad', 'vegetable'], serving: { label: 'bowl', grams: 80 } },
  { name: 'Avocado', kcal: 160, p: 2, c: 9, f: 15, tags: ['fruit', 'fat'], serving: { label: 'avocado', grams: 150 } },
  { name: 'Banana', kcal: 89, p: 1.1, c: 23, f: 0.3, tags: ['fruit'], serving: { label: 'banana', grams: 118 } },
  { name: 'Apple', kcal: 52, p: 0.3, c: 14, f: 0.2, tags: ['fruit'], serving: { label: 'apple', grams: 182 } },
  { name: 'Almonds', kcal: 579, p: 21, c: 22, f: 50, tags: ['nut', 'snack'], serving: { label: 'almond', grams: 1.2 } },
  { name: 'Peanut butter', kcal: 588, p: 25, c: 20, f: 50, tags: ['nut', 'spread'], serving: { label: 'tbsp', grams: 16 } },
  { name: 'Olive oil', kcal: 884, p: 0, c: 0, f: 100, tags: ['oil', 'fat'], serving: { label: 'tsp', grams: 4.5 } },
  { name: 'Ghee', kcal: 900, p: 0, c: 0, f: 100, tags: ['oil', 'fat', 'indian'], serving: { label: 'tsp', grams: 4.5 } },
  { name: 'Butter', kcal: 717, p: 0.9, c: 0.1, f: 81, tags: ['fat', 'dairy'], serving: { label: 'tsp', grams: 5 } },
  { name: 'Cheese (cheddar)', kcal: 403, p: 25, c: 1.3, f: 33, tags: ['dairy'], serving: { label: 'slice', grams: 28 } },
  { name: 'Pizza (cheese)', kcal: 266, p: 11, c: 33, f: 10, tags: ['restaurant'], serving: { label: 'slice', grams: 107 } },
  { name: 'Burger (fast food)', kcal: 295, p: 17, c: 24, f: 14, tags: ['restaurant'], serving: { label: 'burger', grams: 110 } },
  { name: 'French fries', kcal: 312, p: 3.4, c: 41, f: 15, tags: ['restaurant', 'fried'], serving: { label: 'medium serving', grams: 117 } },
  { name: 'Beer', kcal: 43, p: 0.5, c: 3.6, f: 0, tags: ['drink', 'alcohol'], serving: { label: 'can', grams: 355 } },
  { name: 'Red wine', kcal: 85, p: 0.1, c: 2.6, f: 0, tags: ['drink', 'alcohol'], serving: { label: 'glass', grams: 147 } },
  { name: 'Cola', kcal: 42, p: 0, c: 10.6, f: 0, tags: ['drink'], serving: { label: 'can', grams: 355 } },
  { name: 'Orange juice', kcal: 45, p: 0.7, c: 10, f: 0.2, tags: ['drink'], serving: { label: 'cup', grams: 248 } },
  { name: 'Dark chocolate', kcal: 546, p: 5, c: 61, f: 31, tags: ['snack'], serving: { label: 'square', grams: 10 } },
  { name: 'Ice cream', kcal: 207, p: 3.5, c: 24, f: 11, tags: ['dessert'], serving: { label: 'scoop', grams: 66 } },
  { name: 'Gulab jamun', kcal: 315, p: 4, c: 45, f: 13, tags: ['indian', 'dessert'], serving: { label: 'piece', grams: 40 } }
];

const norm = (s) => (s || '').trim().toLowerCase();

/**
 * Every word has to appear somewhere in the name or tags, in any order.
 *
 * The single-substring version could not find "Whole egg (boiled)" from
 * "boiled egg" — the words are there but not adjacent, and people type the
 * food the way they say it, not the way the table spells it.
 */
export function searchFoods(query, limit = 12) {
  const q = norm(query);
  if (!q) return [];
  const terms = q.split(/\s+/).filter(Boolean);
  const scored = [];

  for (const food of FOOD_DB) {
    const name = norm(food.name);
    const haystack = `${name} ${food.tags.join(' ')}`;
    if (!terms.every((t) => haystack.includes(t))) continue;
    // An exact phrase in the name beats scattered words, which beat a tag-only
    // match, so "egg" still puts the egg above the egg curry.
    const score = name.startsWith(q) ? 4
      : name.includes(q) ? 3
      : terms.every((t) => name.includes(t)) ? 2
      : 1;
    scored.push({ food, score });
  }

  return scored
    .sort((a, b) => b.score - a.score || a.food.name.length - b.food.name.length)
    .slice(0, limit)
    .map((s) => s.food);
}

export function lookupFood(name) {
  const n = norm(name);
  return FOOD_DB.find((f) => norm(f.name) === n)
    || FOOD_DB.find((f) => norm(f.name).includes(n) || n.includes(norm(f.name)))
    || null;
}

/**
 * The portion to start from when a food is added by hand.
 *
 * Order matters: the user's own measured prior beats the natural serving, and
 * the natural serving beats a flat number. The flat number was the bug — every
 * hand-added food arrived as 150 g, so one boiled egg was logged as three.
 */
export function defaultGrams(food, corrections = []) {
  const prior = portionPrior(corrections, food?.name);
  if (prior) return prior.grams;
  if (food?.serving?.grams) return Math.round(food.serving.grams);
  return DEFAULT_GRAMS;
}

/** How many natural units a gram weight comes to, or null if there is no unit. */
export function servingCount(food, grams) {
  const per = food?.serving?.grams;
  if (!per || !Number.isFinite(grams)) return null;
  return grams / per;
}

/** Per-100 g macro density for an item that may not be in the reference table. */
export function densityOf(item) {
  const ref = lookupFood(item.name);
  if (ref) return { kcal: ref.kcal, p: ref.p, c: ref.c, f: ref.f, serving: ref.serving || null };
  const g = item.grams;
  if (!g) return { kcal: item.kcal || 0, p: item.protein || 0, c: item.carbs || 0, f: item.fat || 0, serving: null };
  return {
    kcal: ((item.kcal || 0) / g) * 100,
    p: ((item.protein || 0) / g) * 100,
    c: ((item.carbs || 0) / g) * 100,
    f: ((item.fat || 0) / g) * 100,
    serving: item.serving || null
  };
}

export function macrosFor(food, grams) {
  const factor = grams / 100;
  return {
    kcal: Math.round(food.kcal * factor),
    protein: Math.round(food.p * factor * 10) / 10,
    carbs: Math.round(food.c * factor * 10) / 10,
    fat: Math.round(food.f * factor * 10) / 10
  };
}

/** Stable key for matching a food across entries and corrections. */
export function foodKey(name) {
  return norm(name).replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ');
}

/**
 * PRD §40 — a personal prior for portion size.
 *
 * The prior is a median of what the user actually entered, not a ratio applied
 * to the model's guess: if they always say 180 g of rice, 180 g is the prior.
 * It needs three corrections before it is used at all, because two data points
 * from a person eyeballing grams is not a calibration.
 */
export function portionPrior(corrections, name) {
  const key = foodKey(name);
  const mine = corrections.filter((c) => c.foodKey === key);
  if (mine.length < 3) return null;
  const value = median(mine.slice(-8).map((c) => c.userGrams));
  return value == null ? null : { grams: Math.round(value), samples: mine.length };
}

/** Apply every available prior to a fresh AI estimate. */
export function applyPriors(items, corrections) {
  return items.map((item) => {
    const prior = portionPrior(corrections, item.name);
    if (!prior) return item;
    return {
      ...item,
      grams: prior.grams,
      priorApplied: true,
      priorSamples: prior.samples,
      aiGrams: item.aiGrams ?? item.grams
    };
  });
}

/**
 * PRD §17 — surface meals eaten repeatedly so they become one tap.
 * A meal counts as "usual" after three occurrences of a similar item set.
 */
export function usualMeals(foodEntries, limit = 4) {
  const groups = new Map();
  for (const entry of foodEntries) {
    const key = (entry.items || [])
      .map((i) => foodKey(i.name))
      .sort()
      .join('|');
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  return [...groups.values()]
    .filter((entries) => entries.length >= 3)
    .map((entries) => {
      const latest = entries[entries.length - 1];
      const avgKcal = Math.round(
        entries.reduce((a, e) => a + (e.totals?.kcal || 0), 0) / entries.length
      );
      const avgProtein = Math.round(
        entries.reduce((a, e) => a + (e.totals?.protein || 0), 0) / entries.length
      );
      return {
        label: (latest.items || []).map((i) => i.name).join(' + '),
        count: entries.length,
        template: latest,
        avgKcal,
        avgProtein
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export function sumItems(items) {
  return items.reduce(
    (acc, i) => ({
      kcal: acc.kcal + (i.kcal || 0),
      protein: Math.round((acc.protein + (i.protein || 0)) * 10) / 10,
      carbs: Math.round((acc.carbs + (i.carbs || 0)) * 10) / 10,
      fat: Math.round((acc.fat + (i.fat || 0)) * 10) / 10
    }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0 }
  );
}

/**
 * PRD §13 — carry an honest range, not a fake precision.
 * The width is set by the weakest confidence among the items.
 */
export function estimateRange(totals, confidence) {
  const spread = confidence === 'high' ? 0.1 : confidence === 'medium' ? 0.2 : 0.32;
  return {
    low: Math.round((totals.kcal * (1 - spread)) / 10) * 10,
    high: Math.round((totals.kcal * (1 + spread)) / 10) * 10,
    point: Math.round(totals.kcal)
  };
}

export const MEAL_TYPES = ['Breakfast', 'Lunch', 'Snack', 'Dinner'];

export function guessMealType(date = new Date()) {
  const hour = date.getHours();
  if (hour < 10.5) return 'Breakfast';
  if (hour < 15) return 'Lunch';
  if (hour < 18) return 'Snack';
  return 'Dinner';
}
