/**
 * Food (PRD §§8–19, 42–44).
 *
 * The flow is photo → estimate → confirm, and every screen after the estimate
 * is built for correction rather than acceptance. Two design consequences worth
 * naming:
 *
 *  - The saved total is a point value, but the entry keeps the range and the
 *    confidence that produced it, so the weekly engine can tell a week of
 *    confident logs from a week of guesses.
 *  - Cooking oil is asked about, never inferred from the image, and added
 *    arithmetically (§15). It is the single largest error source in home food.
 */

import { h, fill, clear, setText } from '../core/dom.js';
import {
  appHeader, bottomNav, gearLink, sheet, field, numberInput, chipGroup,
  stepper, toast, spinnerRow, confidenceTag, callout, personSwitcher, readOnlyNotice
} from '../ui/components.js';
import {
  state, view, isReadOnly, saveFoodEntry, removeFoodEntry, recordCorrection, saveMeal,
  touchSavedMeal, removeSavedMeal, foodOn, totalsOn
} from '../core/store.js';
import { todayISO, fmtNum, fmtTime, isoAddDays } from '../core/format.js';
import {
  searchFoods, macrosFor, sumItems, estimateRange, applyPriors, portionPrior,
  usualMeals, foodKey, MEAL_TYPES, guessMealType, lookupFood,
  OIL_KCAL_PER_TSP, OIL_FAT_PER_TSP
} from '../domain/foods.js';
import { estimateMeal, refineMeal, AIError } from '../services/ai.js';
import { toThumbDataURL } from '../services/image.js';
import { parseHash, navigate } from '../core/router.js';

export function foodView({ params }) {
  const today = todayISO();
  let viewDate = params.date || today;

  const totalsEl = h('div.card');
  const noticeSlot = h('div');
  const addTools = h('div.stack');
  const timeline = h('ul.list');
  const usualSlot = h('div');
  const savedSlot = h('div');

  const fileInput = h('input', {
    type: 'file',
    accept: 'image/*',
    capture: 'environment',
    style: { display: 'none' },
    onChange: (e) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (file) startPhotoFlow(file);
    }
  });

  const el = h('div', null, [
    appHeader('Food', gearLink()),
    personSwitcher(),
    h('div.view.stack', null, [
      noticeSlot,
      h('div.row.between', null, [
        h('button.btn.quiet', { type: 'button', onClick: () => { viewDate = isoAddDays(viewDate, -1); update(); } }, '‹ Earlier'),
        h('span.small.muted', null, dateLabel()),
        h('button.btn.quiet', {
          type: 'button',
          onClick: () => { if (viewDate < today) { viewDate = isoAddDays(viewDate, 1); update(); } }
        }, 'Later ›')
      ]),
      totalsEl,
      addTools,
      fileInput,
      usualSlot,
      savedSlot,
      h('h2.section', null, 'Timeline'),
      timeline
    ]),
    bottomNav('food')
  ]);

  addTools.append(
    h('button.btn.primary.block', { type: 'button', onClick: () => fileInput.click() }, 'Photograph a meal'),
    h('div.btn-row', null, [
      h('button.btn', { type: 'button', onClick: openSearch }, 'Search'),
      h('button.btn', { type: 'button', onClick: openQuickAdd }, 'Quick add'),
      h('button.btn', { type: 'button', onClick: repeatYesterday }, 'Repeat')
    ])
  );

  const dateLabelEl = el.querySelector('.small.muted');

  function dateLabel() {
    if (viewDate === today) return 'Today';
    if (viewDate === isoAddDays(today, -1)) return 'Yesterday';
    return viewDate;
  }

  /* ------------------------------------------------------- photo flow */

  async function startPhotoFlow(file) {
    const mealType = guessMealType();
    const bodyEl = h('div', null, spinnerRow('Reading the plate…'));
    const handle = sheet({ title: 'New meal', body: bodyEl });

    let thumb = null;
    try {
      thumb = await toThumbDataURL(file);
    } catch { /* thumbnail is cosmetic */ }

    if (!state.settings.aiEndpoint || !state.settings.aiEnabled) {
      fill(bodyEl, [
        callout('No estimator is connected, so this photo cannot be read. Add a proxy URL in Profile → AI, or build the meal by hand.', 'alert'),
        h('button.btn.block', { type: 'button', style: { marginTop: '12px' }, onClick: () => { handle.close(true); openSearch(); } }, 'Build it by hand')
      ]);
      return;
    }

    try {
      const priors = state.corrections.length
        ? [...new Set(state.corrections.map((c) => c.foodKey))]
            .map((key) => {
              const prior = portionPrior(state.corrections, key);
              return prior ? { name: key, grams: prior.grams } : null;
            })
            .filter(Boolean)
            .slice(0, 12)
        : [];

      const result = await estimateMeal(file, state.settings, {
        mealType,
        priors,
        cuisine: state.profile?.diet === 'vegetarian' ? 'Indian vegetarian' : 'Indian and Western'
      });
      const withPriors = { ...result, items: applyPriors(result.items, state.corrections) };
      renderEstimate(handle, bodyEl, withPriors, { mealType, thumb, source: 'photo' });
    } catch (err) {
      const message = err instanceof AIError ? err.message : 'Something went wrong reading that photo.';
      fill(bodyEl, [
        callout(message, 'alert'),
        h('div.btn-row', { style: { marginTop: '12px' } }, [
          h('button.btn', { type: 'button', onClick: () => { handle.close(true); openSearch(); } }, 'Enter by hand'),
          h('button.btn.primary', { type: 'button', onClick: () => { handle.close(true); startPhotoFlow(file); } }, 'Try again')
        ])
      ]);
    }
  }

  /**
   * The correction screen. Items are editable in place; the follow-up questions
   * (§42) appear beneath, capped at two, and only when they would actually move
   * the number.
   */
  function renderEstimate(handle, bodyEl, result, meta) {
    let items = result.items.map((i) => ({ ...i }));
    let confidence = result.confidence;
    let prep = meta.prep || (result.prepGuess !== 'unknown' ? result.prepGuess : null);
    let oilTsp = null;
    const answers = {};

    const list = h('div');
    const totalsLine = h('div.row.between', { style: { marginTop: '12px' } });
    const rangeLine = h('p.small.muted');
    const followSlot = h('div');
    const notesSlot = h('div');

    function totals() {
      const base = sumItems(items);
      if (oilTsp) {
        base.kcal += Math.round(oilTsp * OIL_KCAL_PER_TSP);
        base.fat = Math.round((base.fat + oilTsp * OIL_FAT_PER_TSP) * 10) / 10;
      }
      return base;
    }

    function paintTotals() {
      const t = totals();
      const range = estimateRange(t, confidence);
      fill(totalsLine, [
        h('strong', null, 'Total'),
        h('span.num', null, `${fmtNum(t.kcal, 0)} kcal · ${fmtNum(t.protein, 0)} g protein`)
      ]);
      setText(rangeLine, confidence === 'high'
        ? 'Estimate is tight for this kind of food.'
        : `Realistic range ${range.low}–${range.high} kcal. The single number is the midpoint, not a measurement.`);
    }

    function paintItems() {
      fill(list, items.map((item, idx) => h('div.metric', null, [
        h('button.item', {
          type: 'button',
          style: { padding: '2px 0' },
          onClick: () => editItem(idx)
        }, [
          h('span.grow', null, [
            h('div.t', null, item.name),
            h('div.s', null, [
              `${fmtNum(item.grams, 0)} g`,
              item.priorApplied ? ' · your usual portion' : '',
              item.confidence === 'low' ? ' · low confidence' : ''
            ].join(''))
          ]),
          h('span.r', null, [
            h('div.kc', null, `${fmtNum(item.kcal, 0)} kcal`),
            h('div.s', null, 'Edit')
          ])
        ])
      ])));
      paintTotals();
    }

    function editItem(idx) {
      const item = items[idx];
      const ref = lookupFood(item.name);
      const density = ref ? { kcal: ref.kcal, p: ref.p, c: ref.c, f: ref.f } : {
        kcal: (item.kcal / item.grams) * 100,
        p: (item.protein / item.grams) * 100,
        c: (item.carbs / item.grams) * 100,
        f: (item.fat / item.grams) * 100
      };
      const preview = h('p.small.muted');
      const step = stepper({
        value: Math.round(item.grams),
        step: 10,
        max: 2000,
        onChange: (grams) => {
          const macros = macrosFor(density, grams);
          items[idx] = { ...items[idx], grams, ...macros };
          setText(preview, `${macros.kcal} kcal · ${macros.protein} g protein`);
        }
      });

      const inner = sheet({
        title: item.name,
        body: h('div', null, [
          field('Portion', chipGroup({
            options: [
              { value: 'small', label: 'Small' },
              { value: 'medium', label: 'Medium' },
              { value: 'large', label: 'Large' }
            ],
            value: item.portionSize || 'medium',
            onChange: (size) => {
              const base = item.aiGrams || item.grams;
              const factor = size === 'small' ? 0.7 : size === 'large' ? 1.35 : 1;
              step.set(Math.round(base * factor));
              items[idx].portionSize = size;
            }
          })),
          field('Weight as served', step.el),
          preview,
          h('button.btn.danger.block', {
            type: 'button',
            style: { marginTop: '8px' },
            onClick: () => { items.splice(idx, 1); inner.close(true); paintItems(); }
          }, 'Remove this item')
        ]),
        actions: [h('button.btn.primary.block', { type: 'button', onClick: () => { inner.close(true); paintItems(); } }, 'Done')]
      });
      setText(preview, `${item.kcal} kcal · ${item.protein} g protein`);
    }

    function paintFollowUps() {
      const questions = [];

      // §15 — the oil question is asked locally, not by the model, because the
      // answer is arithmetic rather than judgement.
      if (!prep) {
        questions.push(h('div', null, [
          field('Where was this made?', chipGroup({
            options: [{ value: 'home', label: 'Home' }, { value: 'restaurant', label: 'Restaurant' }, { value: 'packaged', label: 'Packaged' }],
            value: prep,
            onChange: (v) => { prep = v; paintFollowUps(); paintTotals(); }
          }))
        ]));
      } else if (prep === 'home' && oilTsp == null) {
        questions.push(field('Roughly how much cooking oil or ghee went in?', chipGroup({
          options: [
            { value: 0, label: 'None' },
            { value: 1, label: '1 tsp' },
            { value: 3, label: '1 tbsp' },
            { value: 6, label: '2 tbsp' },
            { value: -1, label: 'Not sure' }
          ],
          value: oilTsp,
          onChange: (v) => {
            oilTsp = Number(v) < 0 ? 2 : Number(v);
            if (Number(v) < 0) confidence = 'low';
            paintFollowUps();
            paintTotals();
          }
        }), 'Invisible in the photo and worth up to a few hundred calories.'));
      } else if (prep === 'restaurant') {
        questions.push(callout('Restaurant portions carry more fat than they look. This estimate has been widened rather than sharpened.'));
        confidence = confidence === 'high' ? 'medium' : confidence;
      }

      for (const q of result.followUps.slice(0, 2)) {
        if (answers[q.id]) continue;
        questions.push(field(q.question, chipGroup({
          options: q.options.length ? q.options : ['Yes', 'No'],
          value: answers[q.id],
          onChange: async (v) => {
            answers[q.id] = v;
            paintFollowUps();
            try {
              const refined = await refineMeal(items, answers, state.settings);
              items = refined.items;
              confidence = refined.confidence;
              paintItems();
            } catch {
              toast('Kept the current estimate.');
            }
          }
        })));
      }

      fill(followSlot, questions.length
        ? [h('h2.section', { style: { marginTop: '18px' } }, 'Two quick things'), ...questions]
        : null);
    }

    const mealTypeChips = chipGroup({
      options: MEAL_TYPES,
      value: meta.mealType,
      onChange: (v) => { meta.mealType = v; }
    });

    fill(bodyEl, [
      h('div.row.between', null, [confidenceTag(confidence), h('span.small.muted', null, 'Tap any item to correct it')]),
      list,
      totalsLine,
      rangeLine,
      notesSlot,
      followSlot,
      h('h2.section', { style: { marginTop: '18px' } }, 'Meal'),
      mealTypeChips,
      h('button.btn.quiet', {
        type: 'button',
        onClick: () => {
          items.push({ name: 'Extra item', grams: 100, aiGrams: 100, kcal: 100, protein: 5, carbs: 10, fat: 4, confidence: 'low', portionSize: 'medium' });
          paintItems();
          editItem(items.length - 1);
        }
      }, '+ Add something the photo missed'),
      h('div.btn-row', { style: { marginTop: '14px' } }, [
        h('button.btn', { type: 'button', onClick: () => handle.close() }, 'Discard'),
        h('button.btn.primary', {
          type: 'button',
          onClick: async () => {
            const t = totals();
            if (oilTsp) {
              items = items.concat({
                name: 'Cooking oil',
                grams: Math.round(oilTsp * 4.5),
                kcal: Math.round(oilTsp * OIL_KCAL_PER_TSP),
                protein: 0, carbs: 0,
                fat: Math.round(oilTsp * OIL_FAT_PER_TSP * 10) / 10,
                confidence: 'low',
                portionSize: 'medium'
              });
            }
            for (const item of items) {
              if (item.aiGrams && Math.abs(item.aiGrams - item.grams) >= 5) {
                await recordCorrection(foodKey(item.name), item.aiGrams, item.grams);
              }
            }
            await saveFoodEntry({
              date: viewDate,
              mealType: meta.mealType,
              items,
              totals: t,
              range: estimateRange(t, confidence),
              confidence,
              prep,
              source: meta.source,
              photoThumb: meta.thumb
            });
            handle.close(true);
            toast('Logged.');
            update();
          }
        }, 'Looks right')
      ]),
      h('button.btn.quiet.block', {
        type: 'button',
        onClick: async () => {
          const name = prompt('Name this meal for reuse');
          if (!name) return;
          await saveMeal({ name, items, totals: totals() });
          toast('Saved for next time.');
        }
      }, 'Save as a named meal')
    ]);

    if (result.notes) fill(notesSlot, h('p.small.muted', null, result.notes));
    paintItems();
    paintFollowUps();
  }

  /* ------------------------------------------------------ manual entry */

  function openSearch() {
    const chosen = [];
    const results = h('div');
    const chosenList = h('div');
    const input = h('input.input', {
      type: 'search',
      placeholder: 'Search foods',
      autofocus: true,
      onInput: (e) => paintResults(e.target.value)
    });

    function paintChosen() {
      fill(chosenList, chosen.length
        ? [
            h('h2.section', null, 'This meal'),
            ...chosen.map((item, idx) => h('div.metric', null, [
              h('span.metric-name', null, `${item.name} · ${item.grams} g`),
              h('span.metric-val', null, `${item.kcal} kcal`),
              h('button.btn.quiet', { type: 'button', onClick: () => { chosen.splice(idx, 1); paintChosen(); } }, 'Remove')
            ]))
          ]
        : null);
    }

    function paintResults(query) {
      const found = searchFoods(query);
      fill(results, found.length
        ? found.map((food) => h('button.item', {
            type: 'button',
            onClick: () => {
              const prior = portionPrior(state.corrections, food.name);
              const grams = prior?.grams || 150;
              chosen.push({ name: food.name, grams, ...macrosFor(food, grams), confidence: 'medium', portionSize: 'medium' });
              paintChosen();
            }
          }, [
            h('span.grow', null, [h('div.t', null, food.name), h('div.s', null, `${food.kcal} kcal / 100 g`)]),
            h('span.r', null, h('div.s', null, 'Add'))
          ]))
        : query ? h('div.empty', null, 'No match. Use Quick add for anything not listed.') : null);
    }

    let mealType = guessMealType();
    const handle = sheet({
      title: 'Search',
      body: h('div', null, [
        input, results, chosenList,
        h('h2.section', null, 'Meal'),
        chipGroup({ options: MEAL_TYPES, value: mealType, onChange: (v) => { mealType = v; } })
      ]),
      actions: [
        h('button.btn.primary.block', {
          type: 'button',
          onClick: async () => {
            if (!chosen.length) return toast('Add at least one food.');
            const t = sumItems(chosen);
            await saveFoodEntry({
              date: viewDate, mealType, items: chosen, totals: t,
              range: estimateRange(t, 'medium'), confidence: 'medium', source: 'search'
            });
            handle.close(true);
            toast('Logged.');
            update();
          }
        }, 'Log meal')
      ]
    });
  }

  function openQuickAdd() {
    const kcal = numberInput({ placeholder: 'kcal', autofocus: true });
    const protein = numberInput({ placeholder: 'g' });
    let mealType = guessMealType();
    const handle = sheet({
      title: 'Quick add',
      body: h('div', null, [
        h('p.small.muted', null, 'For when you know the number and do not need the breakdown.'),
        field('Calories', kcal),
        field('Protein (g)', protein),
        chipGroup({ options: MEAL_TYPES, value: mealType, onChange: (v) => { mealType = v; } })
      ]),
      actions: [
        h('button.btn.primary.block', {
          type: 'button',
          onClick: async () => {
            const k = Number(kcal.value);
            if (!k) return toast('Calories are required.');
            const p = Number(protein.value) || 0;
            const items = [{ name: 'Quick add', grams: 0, kcal: k, protein: p, carbs: 0, fat: 0, confidence: 'low' }];
            await saveFoodEntry({
              date: viewDate, mealType, items,
              totals: { kcal: k, protein: p, carbs: 0, fat: 0 },
              confidence: 'low', source: 'quick'
            });
            handle.close(true);
            update();
          }
        }, 'Add')
      ]
    });
  }

  async function repeatYesterday() {
    const yesterday = foodOn(isoAddDays(viewDate, -1));
    if (!yesterday.length) return toast('Nothing logged yesterday to repeat.');
    const handle = sheet({
      title: 'Repeat a meal',
      body: h('ul.list', null, yesterday.map((entry) => h('li', null,
        h('button.item', {
          type: 'button',
          onClick: async () => {
            await saveFoodEntry({
              date: viewDate, mealType: entry.mealType, items: entry.items,
              totals: entry.totals, confidence: entry.confidence, prep: entry.prep, source: 'repeat'
            });
            handle.close(true);
            toast('Logged.');
            update();
          }
        }, [
          h('span.grow', null, [
            h('div.t', null, entry.mealType),
            h('div.s', null, (entry.items || []).map((i) => i.name).join(', '))
          ]),
          h('span.r', null, h('div.kc', null, `${fmtNum(entry.totals?.kcal, 0)} kcal`))
        ])
      )))
    });
  }

  async function logTemplate(template, source) {
    await saveFoodEntry({
      date: viewDate,
      mealType: guessMealType(),
      items: template.items,
      totals: template.totals,
      confidence: template.confidence || 'medium',
      source
    });
    toast('Logged.');
    update();
  }

  function openEntry(id) {
    const entry = view().food.find((f) => f.id === id);
    if (!entry) return;
    const handle = sheet({
      title: entry.mealType,
      body: h('div', null, [
        entry.photoThumb ? h('img.thumb', { src: entry.photoThumb, alt: '' }) : null,
        h('div', null, (entry.items || []).map((i) => h('div.metric', null, [
          h('span.metric-name', null, `${i.name} · ${fmtNum(i.grams, 0)} g`),
          h('span.metric-val', null, `${fmtNum(i.kcal, 0)} kcal`)
        ]))),
        h('div.metric', null, [
          h('span.metric-name', null, h('strong', null, 'Total')),
          h('span.metric-val', null, `${fmtNum(entry.totals?.kcal, 0)} kcal`)
        ]),
        entry.range
          ? h('p.small.muted', null, `Logged as ${entry.range.point} kcal from a ${entry.range.low}–${entry.range.high} range.`)
          : null
      ]),
      actions: [
        isReadOnly() ? null : h('button.btn.danger', {
          type: 'button',
          onClick: async () => { await removeFoodEntry(id); handle.close(true); update(); }
        }, 'Delete'),
        h('button.btn', { type: 'button', onClick: () => handle.close() }, 'Close')
      ].filter(Boolean)
    });
  }

  /* ------------------------------------------------------------ render */

  function update() {
    setText(dateLabelEl, dateLabel());
    fill(noticeSlot, readOnlyNotice());
    addTools.style.display = isReadOnly() ? 'none' : '';
    const targets = view().profile?.targets || {};
    const totals = totalsOn(viewDate);
    fill(totalsEl, [
      h('div.row.between', null, [
        h('div', null, [
          h('div.k.small.muted', null, 'Calories'),
          h('div.num', { style: { fontSize: '30px' } }, fmtNum(totals.kcal, 0))
        ]),
        h('div', { style: { textAlign: 'right' } }, [
          h('div.k.small.muted', null, 'Protein'),
          h('div.num', { style: { fontSize: '30px' } }, `${fmtNum(totals.protein, 0)} g`)
        ])
      ]),
      targets.kcal
        ? h('p.small.muted', { style: { marginTop: '8px' } },
          `${fmtNum(Math.max(0, targets.kcal - totals.kcal), 0)} kcal and ${fmtNum(Math.max(0, (targets.protein || 0) - totals.protein), 0)} g protein remaining.`)
        : null
    ]);

    const usual = usualMeals(view().food);
    fill(usualSlot, usual.length && !isReadOnly()
      ? [
          h('h2.section', null, 'Your usuals'),
          h('div.row.wrap', null, usual.map((u) => h('button.chip', {
            type: 'button',
            onClick: () => logTemplate(u.template, 'usual')
          }, `${u.label} · ${u.avgKcal} kcal`)))
        ]
      : null);

    fill(savedSlot, view().savedMeals.length && !isReadOnly()
      ? [
          h('h2.section', null, 'Saved meals'),
          h('ul.list', null, view().savedMeals.map((meal) => h('li', null, h('div.item', null, [
            h('button.grow', {
              type: 'button',
              style: { textAlign: 'left' },
              onClick: async () => { await touchSavedMeal(meal.id); logTemplate(meal, 'saved'); }
            }, [h('div.t', null, meal.name), h('div.s', null, `${fmtNum(meal.totals?.kcal, 0)} kcal`)]),
            h('button.btn.quiet', { type: 'button', onClick: () => removeSavedMeal(meal.id) }, 'Remove')
          ]))))
        ]
      : null);

    const entries = foodOn(viewDate);
    fill(timeline, entries.length
      ? entries.map((entry) => h('li', null, h('button.item', {
          type: 'button',
          onClick: () => openEntry(entry.id)
        }, [
          h('span.time-col', null, fmtTime(entry.ts)),
          entry.photoThumb
            ? h('img', { src: entry.photoThumb, alt: '', width: 40, height: 40, style: { borderRadius: '6px', objectFit: 'cover' } })
            : null,
          h('span.grow', null, [
            h('div.t', null, entry.mealType),
            h('div.s', null, (entry.items || []).map((i) => i.name).join(', '))
          ]),
          h('span.r', null, [
            h('div.kc', null, `${fmtNum(entry.totals?.kcal, 0)}`),
            h('div.s', null, `${fmtNum(entry.totals?.protein, 0)} g P`)
          ])
        ])))
      : h('li', null, h('div.empty', null, 'No meals logged for this day.')));
  }

  update();

  // Deep links from Home: ?action=log opens the camera, ?entry=id opens a meal.
  const { params: hashParams } = parseHash();
  if (hashParams.action === 'log') {
    setTimeout(() => fileInput.click(), 120);
    navigate('food');
  } else if (hashParams.entry) {
    setTimeout(() => openEntry(hashParams.entry), 60);
  }

  return { el, update, destroy() { clear(document.getElementById('sheet-root')); } };
}
