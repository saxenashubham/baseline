/**
 * Food reference data, personal portion priors, and meal memory.
 *
 * The reference table exists for three reasons: offline search (PRD §16B),
 * a sanity check on anything the vision model returns, and — most importantly —
 * the oil correction in §15. Cooking fat is invisible in a photograph, so for
 * home-cooked dishes it is asked about and added arithmetically rather than
 * guessed at from pixels.
 *
 * Values are per 100 g as served, drawn from standard composition tables and
 * rounded. They are a starting point that the user's own corrections override.
 */

import { median } from '../core/format.js';

export const OIL_KCAL_PER_TSP = 40;   // ~4.5 g fat
export const OIL_FAT_PER_TSP = 4.5;

/** name, kcal, protein, carbs, fat — all per 100 g. `tags` drive search. */
export const FOOD_DB = [
  // Indian — breads and grains
  { name: 'Roti (whole wheat)', kcal: 297, p: 10, c: 56, f: 4, tags: ['chapati', 'phulka', 'indian'] },
  { name: 'Paratha (plain)', kcal: 330, p: 8, c: 45, f: 13, tags: ['indian', 'bread'] },
  { name: 'Naan', kcal: 310, p: 9, c: 50, f: 8, tags: ['indian', 'bread'] },
  { name: 'Puri', kcal: 400, p: 8, c: 45, f: 21, tags: ['indian', 'fried'] },
  { name: 'Basmati rice (cooked)', kcal: 130, p: 2.7, c: 28, f: 0.3, tags: ['rice', 'indian'] },
  { name: 'Jeera rice', kcal: 165, p: 3, c: 29, f: 4, tags: ['rice', 'indian'] },
  { name: 'Pulao', kcal: 175, p: 4, c: 28, f: 5, tags: ['rice', 'indian'] },
  { name: 'Vegetable biryani', kcal: 185, p: 4, c: 29, f: 6, tags: ['rice', 'indian'] },
  { name: 'Chicken biryani', kcal: 200, p: 10, c: 24, f: 7, tags: ['rice', 'indian'] },
  { name: 'Poha', kcal: 135, p: 2.5, c: 25, f: 3, tags: ['indian', 'breakfast'] },
  { name: 'Upma', kcal: 150, p: 4, c: 22, f: 5, tags: ['indian', 'breakfast'] },
  { name: 'Idli', kcal: 135, p: 4, c: 27, f: 0.6, tags: ['indian', 'south', 'breakfast'] },
  { name: 'Plain dosa', kcal: 190, p: 4, c: 30, f: 6, tags: ['indian', 'south'] },
  { name: 'Masala dosa', kcal: 215, p: 4.5, c: 32, f: 8, tags: ['indian', 'south'] },

  // Indian — dals, legumes, curries
  { name: 'Dal (tadka, cooked)', kcal: 115, p: 6, c: 14, f: 4, tags: ['indian', 'lentil', 'toor', 'moong'] },
  { name: 'Dal (no tadka)', kcal: 90, p: 6, c: 14, f: 1, tags: ['indian', 'lentil'] },
  { name: 'Rajma', kcal: 125, p: 6.5, c: 16, f: 4, tags: ['indian', 'kidney bean'] },
  { name: 'Chole / chana masala', kcal: 145, p: 6, c: 18, f: 5.5, tags: ['indian', 'chickpea'] },
  { name: 'Kadhi', kcal: 95, p: 3.5, c: 8, f: 5.5, tags: ['indian', 'yogurt'] },
  { name: 'Sambar', kcal: 85, p: 4, c: 11, f: 3, tags: ['indian', 'south'] },
  { name: 'Paneer butter masala', kcal: 235, p: 9, c: 9, f: 18, tags: ['indian', 'paneer', 'restaurant'] },
  { name: 'Palak paneer', kcal: 180, p: 9, c: 7, f: 13, tags: ['indian', 'paneer'] },
  { name: 'Paneer (raw)', kcal: 296, p: 18, c: 3.5, f: 23, tags: ['indian', 'cheese'] },
  { name: 'Aloo sabzi', kcal: 120, p: 2.5, c: 18, f: 4.5, tags: ['indian', 'potato', 'sabzi'] },
  { name: 'Mixed vegetable sabzi', kcal: 95, p: 3, c: 11, f: 4.5, tags: ['indian', 'sabzi'] },
  { name: 'Bhindi masala', kcal: 110, p: 2.5, c: 10, f: 7, tags: ['indian', 'okra', 'sabzi'] },
  { name: 'Chicken curry (home)', kcal: 150, p: 14, c: 4, f: 8.5, tags: ['indian', 'chicken'] },
  { name: 'Butter chicken', kcal: 215, p: 14, c: 6, f: 15, tags: ['indian', 'chicken', 'restaurant'] },
  { name: 'Chicken tikka (dry)', kcal: 175, p: 25, c: 3, f: 7, tags: ['indian', 'chicken', 'grilled'] },
  { name: 'Mutton curry', kcal: 200, p: 16, c: 4, f: 14, tags: ['indian', 'lamb', 'goat'] },
  { name: 'Keema', kcal: 215, p: 17, c: 4, f: 15, tags: ['indian', 'mince'] },
  { name: 'Egg curry', kcal: 155, p: 9, c: 5, f: 11, tags: ['indian', 'egg'] },
  { name: 'Fish curry', kcal: 135, p: 14, c: 4, f: 7, tags: ['indian', 'fish'] },

  // Indian — sides, snacks
  { name: 'Raita', kcal: 65, p: 3, c: 5, f: 3.5, tags: ['indian', 'yogurt', 'side'] },
  { name: 'Cucumber salad', kcal: 25, p: 1, c: 4, f: 0.3, tags: ['salad', 'side'] },
  { name: 'Mint chutney', kcal: 60, p: 2, c: 6, f: 3, tags: ['indian', 'side'] },
  { name: 'Papad (roasted)', kcal: 350, p: 22, c: 50, f: 5, tags: ['indian', 'side'] },
  { name: 'Samosa', kcal: 300, p: 5, c: 32, f: 17, tags: ['indian', 'fried', 'snack'] },
  { name: 'Pakora', kcal: 315, p: 7, c: 28, f: 19, tags: ['indian', 'fried', 'snack'] },
  { name: 'Seekh kebab', kcal: 210, p: 17, c: 3, f: 14, tags: ['indian', 'grilled'] },
  { name: 'Lassi (sweet)', kcal: 95, p: 3, c: 15, f: 2.5, tags: ['indian', 'drink'] },
  { name: 'Masala chai (with milk & sugar)', kcal: 60, p: 1.6, c: 8, f: 2, tags: ['indian', 'drink', 'tea'] },

  // Everyday staples
  { name: 'Whole egg (boiled)', kcal: 155, p: 13, c: 1.1, f: 11, tags: ['egg', 'breakfast'] },
  { name: 'Egg white', kcal: 52, p: 11, c: 0.7, f: 0.2, tags: ['egg'] },
  { name: 'Bread omelette', kcal: 240, p: 11, c: 20, f: 13, tags: ['egg', 'breakfast'] },
  { name: 'White bread', kcal: 265, p: 9, c: 49, f: 3.2, tags: ['bread'] },
  { name: 'Whole wheat bread', kcal: 250, p: 12, c: 43, f: 3.5, tags: ['bread'] },
  { name: 'Greek yogurt (nonfat)', kcal: 59, p: 10, c: 3.6, f: 0.4, tags: ['dairy', 'protein'] },
  { name: 'Whole milk', kcal: 61, p: 3.2, c: 4.8, f: 3.3, tags: ['dairy', 'drink'] },
  { name: 'Skim milk', kcal: 34, p: 3.4, c: 5, f: 0.1, tags: ['dairy', 'drink'] },
  { name: 'Whey protein (powder)', kcal: 390, p: 78, c: 8, f: 5, tags: ['protein', 'supplement'] },
  { name: 'Chicken breast (cooked)', kcal: 165, p: 31, c: 0, f: 3.6, tags: ['chicken', 'protein'] },
  { name: 'Chicken thigh (cooked)', kcal: 209, p: 26, c: 0, f: 11, tags: ['chicken', 'protein'] },
  { name: 'Salmon (cooked)', kcal: 208, p: 22, c: 0, f: 13, tags: ['fish', 'protein'] },
  { name: 'Tuna (canned in water)', kcal: 116, p: 26, c: 0, f: 0.8, tags: ['fish', 'protein'] },
  { name: 'Tofu (firm)', kcal: 144, p: 17, c: 3, f: 9, tags: ['vegetarian', 'protein'] },
  { name: 'Lentils (cooked, plain)', kcal: 116, p: 9, c: 20, f: 0.4, tags: ['legume'] },
  { name: 'Chickpeas (cooked)', kcal: 164, p: 9, c: 27, f: 2.6, tags: ['legume'] },
  { name: 'Brown rice (cooked)', kcal: 123, p: 2.7, c: 26, f: 1, tags: ['rice', 'grain'] },
  { name: 'Quinoa (cooked)', kcal: 120, p: 4.4, c: 21, f: 1.9, tags: ['grain'] },
  { name: 'Oats (dry)', kcal: 389, p: 17, c: 66, f: 7, tags: ['grain', 'breakfast'] },
  { name: 'Pasta (cooked)', kcal: 158, p: 5.8, c: 31, f: 0.9, tags: ['grain'] },
  { name: 'Potato (boiled)', kcal: 87, p: 2, c: 20, f: 0.1, tags: ['vegetable'] },
  { name: 'Sweet potato (baked)', kcal: 90, p: 2, c: 21, f: 0.2, tags: ['vegetable'] },
  { name: 'Mixed green salad (undressed)', kcal: 20, p: 1.5, c: 3.5, f: 0.2, tags: ['salad', 'vegetable'] },
  { name: 'Avocado', kcal: 160, p: 2, c: 9, f: 15, tags: ['fruit', 'fat'] },
  { name: 'Banana', kcal: 89, p: 1.1, c: 23, f: 0.3, tags: ['fruit'] },
  { name: 'Apple', kcal: 52, p: 0.3, c: 14, f: 0.2, tags: ['fruit'] },
  { name: 'Almonds', kcal: 579, p: 21, c: 22, f: 50, tags: ['nut', 'snack'] },
  { name: 'Peanut butter', kcal: 588, p: 25, c: 20, f: 50, tags: ['nut', 'spread'] },
  { name: 'Olive oil', kcal: 884, p: 0, c: 0, f: 100, tags: ['oil', 'fat'] },
  { name: 'Ghee', kcal: 900, p: 0, c: 0, f: 100, tags: ['oil', 'fat', 'indian'] },
  { name: 'Butter', kcal: 717, p: 0.9, c: 0.1, f: 81, tags: ['fat', 'dairy'] },
  { name: 'Cheese (cheddar)', kcal: 403, p: 25, c: 1.3, f: 33, tags: ['dairy'] },
  { name: 'Pizza (cheese)', kcal: 266, p: 11, c: 33, f: 10, tags: ['restaurant'] },
  { name: 'Burger (fast food)', kcal: 295, p: 17, c: 24, f: 14, tags: ['restaurant'] },
  { name: 'French fries', kcal: 312, p: 3.4, c: 41, f: 15, tags: ['restaurant', 'fried'] },
  { name: 'Beer', kcal: 43, p: 0.5, c: 3.6, f: 0, tags: ['drink', 'alcohol'] },
  { name: 'Red wine', kcal: 85, p: 0.1, c: 2.6, f: 0, tags: ['drink', 'alcohol'] },
  { name: 'Cola', kcal: 42, p: 0, c: 10.6, f: 0, tags: ['drink'] },
  { name: 'Orange juice', kcal: 45, p: 0.7, c: 10, f: 0.2, tags: ['drink'] },
  { name: 'Dark chocolate', kcal: 546, p: 5, c: 61, f: 31, tags: ['snack'] },
  { name: 'Ice cream', kcal: 207, p: 3.5, c: 24, f: 11, tags: ['dessert'] },
  { name: 'Gulab jamun', kcal: 315, p: 4, c: 45, f: 13, tags: ['indian', 'dessert'] }
];

const norm = (s) => (s || '').trim().toLowerCase();

export function searchFoods(query, limit = 12) {
  const q = norm(query);
  if (!q) return [];
  const scored = [];
  for (const food of FOOD_DB) {
    const name = norm(food.name);
    let score = 0;
    if (name.startsWith(q)) score = 3;
    else if (name.includes(q)) score = 2;
    else if (food.tags.some((t) => t.includes(q))) score = 1;
    if (score) scored.push({ food, score });
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
