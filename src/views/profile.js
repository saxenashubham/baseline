/**
 * Profile (PRD §§6, 25, 29, 45, 51).
 *
 * Also the honesty page: it states what leaves the device and what does not,
 * and the delete control actually drops the database rather than flagging rows.
 */

import { h, fill, clear } from '../core/dom.js';
import {
  appHeader, bottomNav, sheet, field, numberInput, chipGroup, toast, callout
} from '../ui/components.js';
import {
  state, saveProfile, saveSettings, eraseAllData, changeUnits
} from '../core/store.js';
import {
  todayISO, fmtNum, isoAddDays, weightUnit, lengthUnit, fmtWeight, fmtLength,
  convertWeight, convertLength, pluralize
} from '../core/format.js';
import { buildTargets, predictedTDEE, ACTIVITY_LABELS } from '../domain/targets.js';
import { buildSnapshot } from '../domain/engine.js';
import { navigate } from '../core/router.js';

export function profileView() {
  const targetsCard = h('section.card');
  const unitsCard = h('section.card');
  const aiCard = h('section.card');
  const notifyCard = h('section.card');
  const dataCard = h('section.card');
  const safetyCard = h('section.card');

  const el = h('div', null, [
    appHeader('Profile', h('a.day-badge', { href: '#/home' }, 'Done')),
    h('div.view.stack', null, [targetsCard, unitsCard, aiCard, notifyCard, safetyCard, dataCard]),
    bottomNav('home')
  ]);

  /* ----------------------------------------------------------- targets */

  function openTargets() {
    const p = state.profile;
    const t = p.targets || {};
    const kcal = numberInput({ value: t.kcal });
    const protein = numberInput({ value: t.protein });
    const carbs = numberInput({ value: t.carbs });
    const fat = numberInput({ value: t.fat });
    const steps = numberInput({ value: p.stepTarget || 8000 });

    const handle = sheet({
      title: 'Targets',
      body: h('div', null, [
        field('Calories', kcal),
        field('Protein (g)', protein),
        field('Carbs (g)', carbs),
        field('Fat (g)', fat),
        field('Daily steps', steps),
        h('button.btn.quiet.block', {
          type: 'button',
          onClick: () => {
            const recomputed = buildTargets(p, { rate: p.weeklyRate });
            kcal.value = recomputed.kcal;
            protein.value = recomputed.protein;
            carbs.value = recomputed.carbs;
            fat.value = recomputed.fat;
            toast('Recalculated from the equation.');
          }
        }, 'Recalculate from the equation'),
        callout('Macros are guidelines. Calories and protein are the two that decide the outcome; going 15 g over on carbs is not a failed day.')
      ]),
      actions: [
        h('button.btn.primary.block', {
          type: 'button',
          onClick: async () => {
            await saveProfile({
              targets: {
                ...t,
                kcal: Number(kcal.value),
                protein: Number(protein.value),
                carbs: Number(carbs.value),
                fat: Number(fat.value)
              },
              stepTarget: Number(steps.value),
              targetSource: 'manual'
            });
            handle.close(true);
            update();
          }
        }, 'Save')
      ]
    });
  }

  function openBody() {
    const p = state.profile;
    const age = numberInput({ value: p.age });
    const height = numberInput({ value: p.height });
    const rate = { value: p.weeklyRate };

    const handle = sheet({
      title: 'You',
      body: h('div', null, [
        field('Age', age),
        field(`Height (${lengthUnit(p) === 'cm' ? 'cm' : 'inches'})`, height),
        field('Activity level', chipGroup({
          options: Object.keys(ACTIVITY_LABELS).map((k) => ({ value: k, label: k.replace('_', ' ') })),
          value: p.activityLevel,
          onChange: (v) => { p.activityLevel = v; }
        })),
        field('Weekly rate', chipGroup({
          options: weightUnit(p) === 'kg'
            ? [{ value: 0.23, label: '0.25 kg' }, { value: 0.45, label: '0.45 kg' }, { value: 0.68, label: '0.7 kg' }]
            : [{ value: 0.5, label: '0.5 lb' }, { value: 1, label: '1 lb' }, { value: 1.5, label: '1.5 lb' }],
          value: p.weeklyRate,
          onChange: (v) => { rate.value = Number(v); }
        }))
      ]),
      actions: [
        h('button.btn.primary.block', {
          type: 'button',
          onClick: async () => {
            await saveProfile({
              age: Number(age.value),
              height: Number(height.value),
              activityLevel: p.activityLevel,
              weeklyRate: rate.value
            });
            handle.close(true);
            update();
          }
        }, 'Save')
      ]
    });
  }

  /* -------------------------------------------------------------- units */

  /**
   * Weight and length are switched separately, and switching either one
   * rewrites the history rather than reinterpreting it. Every stored weigh-in
   * is in the unit it was typed in, so a flag flip alone would turn 199 lb of
   * baseline into 199 kg — the sheet says exactly what it is about to convert
   * before it does it.
   */
  function openUnits(axis) {
    const p = state.profile;
    const isWeight = axis === 'weight';
    const current = isWeight ? weightUnit(p) : lengthUnit(p);
    const options = isWeight
      ? [{ value: 'lb', label: 'Pounds (lb)' }, { value: 'kg', label: 'Kilograms (kg)' }]
      : [{ value: 'in', label: 'Inches' }, { value: 'cm', label: 'Centimetres' }];
    let next = current;

    const example = h('p.small.muted');
    const paint = () => {
      if (next === current) return void fill(example, 'Currently in use.');
      const count = isWeight ? state.weights.length : state.waists.length;
      const from = isWeight ? p.weight : (p.startWaist ?? p.height);
      const to = isWeight ? convertWeight(from, current, next) : convertLength(from, current, next);
      const fmt = isWeight ? fmtWeight : fmtLength;
      const sample = from == null ? '' : ` ${fmt(from, current)} becomes ${fmt(to, next)}.`;
      const noun = isWeight ? 'weigh-in' : 'measurement';
      fill(example,
        `${pluralize(count, `stored ${noun}`)} will be converted.${sample}`);
    };

    const handle = sheet({
      title: isWeight ? 'Weight unit' : 'Length unit',
      body: h('div', null, [
        h('p.small.muted', null, isWeight
          ? 'What the scale reads. Independent of how you measure your waist.'
          : 'Height and waist. Independent of what the scale reads.'),
        chipGroup({ options, value: current, onChange: (v) => { next = v; paint(); } }),
        example,
        callout('Your history is converted, not relabelled, so the trend line stays continuous across the switch.')
      ]),
      actions: [
        h('button.btn.primary.block', {
          type: 'button',
          onClick: async () => {
            if (next === current) return handle.close();
            await changeUnits(isWeight ? { weightUnit: next } : { lengthUnit: next });
            handle.close(true);
            toast('Converted.');
            update();
          }
        }, 'Save')
      ]
    });
    paint();
  }

  /* ------------------------------------------------------------- export */

  async function exportJSON() {
    const payload = {
      exportedAt: new Date().toISOString(),
      profile: state.profile,
      weights: state.weights,
      waists: state.waists,
      food: state.food.map(({ photoThumb, ...rest }) => rest),
      workouts: state.workouts,
      metrics: state.metrics,
      savedMeals: state.savedMeals,
      corrections: state.corrections,
      reviews: state.reviews
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = h('a', {
      href: URL.createObjectURL(blob),
      download: `baseline-${todayISO()}.json`
    });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  async function confirmErase() {
    const confirmField = h('input.input', { type: 'text', placeholder: 'Type DELETE' });
    const handle = sheet({
      title: 'Delete everything',
      body: h('div', null, [
        callout('This drops the local database: measurements, meals, workouts and every progress photo. It cannot be undone and there is no backup anywhere else.', 'alert'),
        field('Confirm', confirmField)
      ]),
      actions: [
        h('button.btn.danger.block', {
          type: 'button',
          onClick: async () => {
            if (confirmField.value.trim().toUpperCase() !== 'DELETE') return toast('Type DELETE to confirm.');
            await eraseAllData();
            handle.close(true);
            navigate('home');
            window.location.reload();
          }
        }, 'Delete everything')
      ]
    });
  }

  /* -------------------------------------------------------------- render */

  function update() {
    const p = state.profile;
    if (!p) return;
    const snap = buildSnapshot(state, todayISO(), 14);
    const t = p.targets || {};

    fill(targetsCard, [
      h('p.card-title', null, 'Programme'),
      h('div.metric', null, [h('span.metric-name', null, 'Started'), h('span.metric-val', null, p.programStart)]),
      h('div.metric', null, [h('span.metric-name', null, 'Ends'), h('span.metric-val', null, p.programEnd || isoAddDays(p.programStart, (p.durationDays || 90) - 1))]),
      h('div.metric', null, [h('span.metric-name', null, 'Calories'), h('span.metric-val', null, `${fmtNum(t.kcal, 0)}`)]),
      h('div.metric', null, [h('span.metric-name', null, 'Protein'), h('span.metric-val', null, `${fmtNum(t.protein, 0)} g`)]),
      h('div.metric', null, [
        h('span.metric-name', null, 'Estimated burn'),
        h('span.metric-val', null, snap.expenditure.avg
          ? `${snap.expenditure.avg} kcal (measured)`
          : `${fmtNum(predictedTDEE(p), 0)} kcal (equation)`)
      ]),
      h('div.btn-row', { style: { marginTop: '12px' } }, [
        h('button.btn', { type: 'button', onClick: openBody }, 'Edit you'),
        h('button.btn', { type: 'button', onClick: openTargets }, 'Edit targets')
      ])
    ]);

    fill(unitsCard, [
      h('p.card-title', null, 'Units'),
      h('p.small.muted', null,
        'Chosen separately. A scale in kilograms and a tape measure in inches is a normal pair, not a mistake.'),
      h('div.metric', null, [
        h('span.metric-name', null, 'Weight'),
        h('button.btn.quiet', { type: 'button', onClick: () => openUnits('weight') },
          weightUnit(p) === 'kg' ? 'Kilograms' : 'Pounds')
      ]),
      h('div.metric', null, [
        h('span.metric-name', null, 'Height and waist'),
        h('button.btn.quiet', { type: 'button', onClick: () => openUnits('length') },
          lengthUnit(p) === 'cm' ? 'Centimetres' : 'Inches')
      ])
    ]);

    const endpoint = h('input.input', {
      type: 'url',
      placeholder: 'https://your-worker.workers.dev',
      value: state.settings.aiEndpoint || ''
    });

    fill(aiCard, [
      h('p.card-title', null, 'Food estimator'),
      h('p.small.muted', null,
        'Meal photos are sent to your own proxy, which holds the API key and forwards to the model. Progress photos are never sent anywhere.'),
      field('Proxy URL', endpoint),
      h('div.btn-row', null, [
        h('button.btn', {
          type: 'button',
          onClick: async () => {
            await saveSettings({ aiEnabled: !state.settings.aiEnabled });
            update();
          }
        }, state.settings.aiEnabled ? 'Turn estimator off' : 'Turn estimator on'),
        h('button.btn.primary', {
          type: 'button',
          onClick: async () => {
            await saveSettings({ aiEndpoint: endpoint.value.trim() });
            toast('Saved.');
          }
        }, 'Save')
      ]),
      state.corrections.length
        ? h('p.small.muted', { style: { marginTop: '10px' } },
          `${state.corrections.length} portion corrections recorded. After three for the same food, your number replaces the model's.`)
        : null
    ]);

    fill(notifyCard, [
      h('p.card-title', null, 'Reminders'),
      ...[
        ['notifyMorning', 'Morning weigh-in'],
        ['notifyEvening', 'Evening protein nudge'],
        ['notifyWeekly', 'Sunday review is ready']
      ].map(([key, label]) => h('div.metric', null, [
        h('span.metric-name', null, label),
        h('button.btn.quiet', {
          type: 'button',
          onClick: async () => { await saveSettings({ [key]: !state.settings[key] }); update(); }
        }, state.settings[key] ? 'On' : 'Off')
      ])),
      h('p.small.muted', { style: { marginTop: '8px' } },
        'Three reminders is the whole set. An app that notifies more than this gets muted, and a muted app tracks nothing.')
    ]);

    fill(safetyCard, [
      h('p.card-title', null, 'What this app will not do'),
      h('p.small.muted', null,
        'It does not diagnose anything, does not read blood work, and does not estimate body-fat percentage. If you get severe pain, fainting, neurological symptoms or weight loss you cannot account for, that is a doctor’s question and not this app’s.')
    ]);

    fill(dataCard, [
      h('p.card-title', null, 'Your data'),
      h('p.small.muted', null,
        `${state.weights.length} weigh-ins · ${state.food.length} meals · ${state.workouts.length} workouts · ${state.photos.length} photos.`),
      h('p.small.muted', null, state.auth
        ? `Syncing as ${state.auth.email}. Photos are excluded and stay on this device.`
        : 'Local to this device. No account, no backup.'),
      h('a.btn.block', { href: '#/account', style: { marginTop: '8px', textDecoration: 'none' } },
        state.auth ? 'Account and sharing' : 'Sign in to sync'),
      h('div.btn-row', { style: { marginTop: '10px' } }, [
        h('button.btn', { type: 'button', onClick: exportJSON }, 'Export JSON'),
        h('button.btn.danger', { type: 'button', onClick: confirmErase }, 'Delete everything')
      ])
    ]);
  }

  update();
  return { el, update, destroy() { clear(document.getElementById('sheet-root')); } };
}
