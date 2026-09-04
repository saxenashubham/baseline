/**
 * First run (PRD §5). Three steps, each written before the next is shown so a
 * dropped session doesn't lose what was already entered.
 */

import { h, fill, clear } from '../core/dom.js';
import { field, numberInput, chipGroup, toast, progressBar } from '../ui/components.js';
import { buildTargets, ACTIVITY_LABELS, predictedTDEE } from '../domain/targets.js';
import { saveProfile, logWeight, logWaist, savePhoto } from '../core/store.js';
import { todayISO, isoAddDays, KG_PER_LB, CM_PER_IN, fmtNum } from '../core/format.js';
import { toBlob } from '../services/image.js';
import { navigate } from '../core/router.js';

export function onboardingView() {
  const draft = {
    name: '',
    age: 35,
    sex: 'male',
    units: 'imperial',
    height: 67,
    weight: null,
    waist: null,
    goal: 'lose',
    weeklyRate: 1,
    durationDays: 90,
    activityLevel: 'light',
    exercise: [],
    diet: 'omnivore',
    country: '',
    stepTarget: 8000,
    workoutsPerWeek: 3
  };
  const photos = {};
  let step = 0;

  const body = h('div');
  const el = h('div.view.stack', null, [
    h('header.app-header', null, [h('h1', null, 'Baseline')]),
    h('p.muted', { style: { marginTop: '-6px' } },
      'Ninety days of measurements, and an honest read on whether they are moving.'),
    progressBar(0.1),
    body
  ]);

  const bar = el.querySelector('.progress-track > i');

  function render() {
    bar.style.width = `${((step + 1) / 3) * 100}%`;
    clear(body);
    body.appendChild([stepProfile, stepBaseline, stepGoal][step]());
    window.scrollTo(0, 0);
  }

  /* ------------------------------------------------------------ step 1 */

  function stepProfile() {
    const heightMetric = () => draft.units === 'metric';
    const heightInput = numberInput({
      value: draft.height,
      onInput: (e) => { draft.height = Number(e.target.value); }
    });
    const ageInput = numberInput({ value: draft.age, onInput: (e) => { draft.age = Number(e.target.value); } });
    const heightWrap = field(heightMetric() ? 'Height (cm)' : 'Height (inches)', heightInput);

    const next = h('button.btn.primary.block', {
      type: 'button',
      onClick: async () => {
        if (!draft.age || !draft.height) return toast('Age and height are needed to estimate anything.');
        await saveProfile({ ...draft });
        step = 1;
        render();
      }
    }, 'Continue');

    return h('div.stack', null, [
      h('h2.section', null, 'About you'),
      field('Units', chipGroup({
        options: [{ value: 'imperial', label: 'lb / inches' }, { value: 'metric', label: 'kg / cm' }],
        value: draft.units,
        onChange: (v) => {
          if (v === draft.units) return;
          draft.height = v === 'metric'
            ? Math.round(draft.height * CM_PER_IN)
            : Math.round(draft.height / CM_PER_IN);
          draft.units = v;
          draft.weeklyRate = v === 'metric' ? 0.45 : 1;
          heightInput.value = draft.height;
          fill(heightWrap.querySelector('span'), v === 'metric' ? 'Height (cm)' : 'Height (inches)');
        }
      })),
      field('Age', ageInput),
      field('Sex', chipGroup({
        options: [{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }],
        value: draft.sex,
        onChange: (v) => { draft.sex = v; }
      }), 'Used only for the metabolic rate equation.'),
      heightWrap,
      field('Typical activity outside training', chipGroup({
        options: Object.keys(ACTIVITY_LABELS).map((k) => ({ value: k, label: k.replace('_', ' ') })),
        value: draft.activityLevel,
        onChange: (v) => { draft.activityLevel = v; }
      }), ACTIVITY_LABELS[draft.activityLevel]),
      field('How you train', chipGroup({
        options: ['Strength', 'Cardio', 'Sport', 'Walking only'],
        value: draft.exercise,
        multi: true,
        onChange: (v) => { draft.exercise = v; }
      })),
      field('Eating pattern', chipGroup({
        options: [
          { value: 'omnivore', label: 'Everything' },
          { value: 'vegetarian', label: 'Vegetarian' },
          { value: 'eggetarian', label: 'Eggetarian' },
          { value: 'vegan', label: 'Vegan' }
        ],
        value: draft.diet,
        onChange: (v) => { draft.diet = v; }
      })),
      next
    ]);
  }

  /* ------------------------------------------------------------ step 2 */

  function stepBaseline() {
    const weightInput = numberInput({
      placeholder: draft.units === 'metric' ? 'kg' : 'lb',
      onInput: (e) => { draft.weight = Number(e.target.value); }
    });
    const waistInput = numberInput({
      placeholder: draft.units === 'metric' ? 'cm' : 'inches',
      onInput: (e) => { draft.waist = Number(e.target.value); }
    });

    const slots = ['front', 'side', 'back'].map((pose) => {
      const slot = h('label.photo-slot', { for: `pose-${pose}` }, pose);
      const input = h('input', {
        id: `pose-${pose}`,
        type: 'file',
        accept: 'image/*',
        style: { display: 'none' },
        onChange: async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const blob = await toBlob(file, { maxEdge: 1200 });
          photos[pose] = blob;
          slot.style.backgroundImage = `url(${URL.createObjectURL(blob)})`;
          slot.textContent = '';
        }
      });
      return h('div', null, [slot, input]);
    });

    return h('div.stack', null, [
      h('h2.section', null, 'Baseline'),
      h('p.muted.small', null,
        'Weigh in first thing, after the bathroom, before eating. Every future comparison is against this.'),
      field(`Weight (${draft.units === 'metric' ? 'kg' : 'lb'})`, weightInput),
      field(`Waist at the navel (${draft.units === 'metric' ? 'cm' : 'inches'})`, waistInput),
      h('div', null, [
        h('div.small.muted', { style: { marginBottom: '8px' } },
          'Photos are optional and stay on this device. Same spot, same light, same time of day.'),
        h('div.photo-grid', null, slots)
      ]),
      h('div.btn-row', null, [
        h('button.btn', { type: 'button', onClick: () => { step = 0; render(); } }, 'Back'),
        h('button.btn.primary', {
          type: 'button',
          onClick: async () => {
            if (!draft.weight) return toast('A starting weight is required.');
            await saveProfile({ ...draft, startWeight: draft.weight, startWaist: draft.waist });
            await logWeight({ weight: draft.weight });
            if (draft.waist) await logWaist({ waist: draft.waist });
            for (const [pose, blob] of Object.entries(photos)) await savePhoto({ pose, blob });
            step = 2;
            render();
          }
        }, 'Continue')
      ])
    ]);
  }

  /* ------------------------------------------------------------ step 3 */

  function stepGoal() {
    const profileForCalc = {
      ...draft,
      weightKg: draft.units === 'metric' ? draft.weight : draft.weight * KG_PER_LB,
      heightCm: draft.units === 'metric' ? draft.height : draft.height * CM_PER_IN
    };
    let targets = buildTargets(profileForCalc, { rate: draft.weeklyRate });

    const summary = h('div.card');
    const kcalInput = numberInput({ value: targets.kcal, onInput: (e) => { targets.kcal = Number(e.target.value); } });
    const proteinInput = numberInput({ value: targets.protein, onInput: (e) => { targets.protein = Number(e.target.value); } });

    function refresh() {
      targets = buildTargets(profileForCalc, { rate: draft.weeklyRate });
      kcalInput.value = targets.kcal;
      proteinInput.value = targets.protein;
      fill(summary, [
        h('p.card-title', null, 'Starting estimate'),
        h('div.metric', null, [
          h('span.metric-name', null, 'Estimated daily burn'),
          h('span.metric-val', null, `${fmtNum(predictedTDEE(profileForCalc), 0)} kcal`)
        ]),
        h('div.metric', null, [
          h('span.metric-name', null, 'Calorie target'),
          h('span.metric-val', null, `${fmtNum(targets.kcal, 0)} kcal`)
        ]),
        h('div.metric', null, [
          h('span.metric-name', null, 'Protein'),
          h('span.metric-val', null, `${targets.protein} g`)
        ]),
        h('div.metric', null, [
          h('span.metric-name', null, 'Fat / carbs'),
          h('span.metric-val', null, `${targets.fat} g / ${targets.carbs} g`)
        ]),
        h('p.small.muted', { style: { marginTop: '10px' } },
          targets.clampedToFloor
            ? `That rate would have put the target below ${targets.floor} kcal, so it has been held there. Pick a slower rate if you want a real deficit at a sane intake.`
            : 'This is a starting guess from a population equation. After about two weeks the app replaces it with your own measured burn.')
      ]);
    }

    refresh();

    return h('div.stack', null, [
      h('h2.section', null, 'The plan'),
      field('Goal', chipGroup({
        options: [
          { value: 'lose', label: 'Lose fat' },
          { value: 'maintain', label: 'Maintain' },
          { value: 'gain', label: 'Gain' }
        ],
        value: draft.goal,
        onChange: (v) => { draft.goal = v; refresh(); }
      })),
      field('Rate per week', chipGroup({
        options: draft.units === 'metric'
          ? [{ value: 0.23, label: '0.25 kg' }, { value: 0.45, label: '0.45 kg' }, { value: 0.68, label: '0.7 kg' }]
          : [{ value: 0.5, label: '0.5 lb' }, { value: 1, label: '1 lb' }, { value: 1.5, label: '1.5 lb' }],
        value: draft.weeklyRate,
        onChange: (v) => { draft.weeklyRate = Number(v); refresh(); }
      }), 'Faster is not better. Past about 1% of bodyweight a week, more of the loss is muscle.'),
      field('Programme length', chipGroup({
        options: [{ value: 60, label: '60 days' }, { value: 90, label: '90 days' }, { value: 120, label: '120 days' }],
        value: draft.durationDays,
        onChange: (v) => { draft.durationDays = Number(v); }
      })),
      summary,
      h('details', null, [
        h('summary.small.muted', { style: { padding: '8px 0' } }, 'Override the targets'),
        field('Calories', kcalInput),
        field('Protein (g)', proteinInput)
      ]),
      h('div.btn-row', null, [
        h('button.btn', { type: 'button', onClick: () => { step = 1; render(); } }, 'Back'),
        h('button.btn.primary', {
          type: 'button',
          onClick: async () => {
            const start = todayISO();
            await saveProfile({
              ...draft,
              weightKg: profileForCalc.weightKg,
              heightCm: profileForCalc.heightCm,
              programStart: start,
              programEnd: isoAddDays(start, draft.durationDays - 1),
              targets: { ...targets, protein: Number(proteinInput.value), kcal: Number(kcalInput.value) },
              targetSource: 'predicted',
              createdAt: Date.now()
            });
            toast('Day 1. Go log something.');
            navigate('home');
          }
        }, 'Start day 1')
      ])
    ]);
  }

  render();
  return { el };
}
