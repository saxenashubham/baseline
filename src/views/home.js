/**
 * Home (PRD §7).
 *
 * The hero is the smoothed trend, not this morning's number. The raw reading is
 * present but subordinate — that ordering is the whole point of the product, so
 * it is the first thing on the first screen.
 */

import { h, fill, setText } from '../core/dom.js';
import {
  appHeader, bottomNav, gearLink, metricRow, statusPill, sheet, field,
  numberInput, ratingRow, toast, callout, personSwitcher
} from '../ui/components.js';
import { trendChart } from '../ui/chart.js';
import {
  state, view, isReadOnly, totalsOn, metricsOn, foodOn, logWeight, saveMetrics, programDay
} from '../core/store.js';
import { todayISO, fmtNum, fmtTime, signed, fmtDuration, fmtWeight } from '../core/format.js';
import { buildSnapshot, classify, STATE_COPY, fluctuationNote, flatWeekStreak } from '../domain/engine.js';
import { navigate } from '../core/router.js';

export function homeView() {
  const today = todayISO();
  // Read through view() so the same screen renders either person's data. The
  // switcher in the header is the only thing that changes which one.
  let units = view().profile?.units || 'imperial';
  let targets = view().profile?.targets || {};

  const heroTrend = h('div.hero-trend');
  const heroLabel = h('div.hero-label');
  const heroDelta = h('div.hero-delta');
  const heroRaw = h('div.hero-raw');
  const chartSlot = h('div', { style: { marginTop: '4px' } });

  const hero = h('section.hero', null, [
    h('div.row.between', null, [
      h('div', null, [heroTrend, heroLabel]),
      h('div', { style: { textAlign: 'right' } }, [heroDelta, heroRaw])
    ]),
    chartSlot
  ]);

  const statusSlot = h('div');
  const noteSlot = h('div');

  const kcalRow = metricRow({ name: 'Calories', value: 0, target: targets.kcal });
  const proteinRow = metricRow({ name: 'Protein', value: 0, target: targets.protein, unit: ' g' });
  const carbRow = metricRow({ name: 'Carbs', value: 0, target: targets.carbs, unit: ' g' });
  const fatRow = metricRow({ name: 'Fat', value: 0, target: targets.fat, unit: ' g' });
  const remainingEl = h('p.small.muted');

  const nutritionCard = h('section.card', null, [
    h('p.card-title', null, 'Today'),
    kcalRow.el, proteinRow.el, carbRow.el, fatRow.el,
    remainingEl
  ]);

  const mealList = h('ul.list');
  const mealCard = h('section.card', null, [
    h('div.row.between', null, [
      h('p.card-title', { style: { margin: 0 } }, 'Meals'),
      isReadOnly() ? null : h('button.btn.quiet', { type: 'button', onClick: () => navigate('food', { action: 'log' }) }, 'Log food')
    ]),
    mealList
  ]);

  const stepsRow = metricRow({ name: 'Steps', value: 0, target: state.profile?.stepTarget || 8000 });
  const sleepEl = h('span.metric-val');
  const energyEl = h('span.metric-val');
  const checkinCard = h('section.card', null, [
    h('div.row.between', null, [
      h('p.card-title', { style: { margin: 0 } }, 'Day'),
      isReadOnly() ? null : h('button.btn.quiet', { type: 'button', onClick: openCheckin }, 'Check in')
    ]),
    stepsRow.el,
    h('div.metric', null, [h('span.metric-name', null, 'Sleep'), sleepEl]),
    h('div.metric', null, [h('span.metric-name', null, 'Energy'), energyEl])
  ]);

  // Hidden entirely when viewing the other person — a disabled button invites
  // a tap and then explains why it did nothing.
  const actionRow = h('div.btn-row', null, [
    h('button.btn.primary', { type: 'button', onClick: openWeighIn }, 'Weigh in'),
    h('button.btn', { type: 'button', onClick: () => navigate('food', { action: 'log' }) }, 'Log food')
  ]);

  const dayBadge = h('span.day-badge');
  const el = h('div', null, [
    appHeader('Today', h('div.row', null, [dayBadge, gearLink()])),
    personSwitcher(),
    h('div.view.stack', null, [
      hero,
      statusSlot,
      noteSlot,
      actionRow,
      nutritionCard,
      mealCard,
      checkinCard
    ]),
    bottomNav('home')
  ]);

  /* ------------------------------------------------------------ actions */

  function openWeighIn() {
    const input = numberInput({
      value: state.weights.find((w) => w.date === today)?.weight ?? '',
      placeholder: units === 'metric' ? 'kg' : 'lb',
      autofocus: true
    });
    const note = h('input.input', { type: 'text', placeholder: 'Note (optional)' });
    const handle = sheet({
      title: 'Weigh in',
      body: h('div', null, [
        h('p.small.muted', null, 'Same conditions every day: first thing, after the bathroom, before food or drink.'),
        field(`Weight (${units === 'metric' ? 'kg' : 'lb'})`, input),
        field('Note', note)
      ]),
      actions: [
        h('button.btn.primary.block', {
          type: 'button',
          onClick: async () => {
            const value = Number(input.value);
            if (!value) return toast('Enter a weight.');
            await logWeight({ weight: value, note: note.value });
            handle.close(true);
            toast('Logged. Watch the line, not the number.');
          }
        }, 'Save')
      ]
    });
  }

  function openCheckin() {
    const m = metricsOn(today);
    const draft = { ...m };
    const steps = numberInput({ value: m.steps ?? '', placeholder: 'Steps', onInput: (e) => { draft.steps = Number(e.target.value); } });
    const sleep = numberInput({ value: m.sleepHours ?? '', placeholder: 'Hours', onInput: (e) => { draft.sleepHours = Number(e.target.value); } });

    const handle = sheet({
      title: 'Evening check-in',
      body: h('div', null, [
        field('Steps', steps),
        field('Sleep last night (hours)', sleep),
        field('Sleep quality', ratingRow({ value: m.sleepQuality, onChange: (v) => { draft.sleepQuality = v; } })),
        field('Energy today', ratingRow({ value: m.energy, onChange: (v) => { draft.energy = v; } })),
        h('details', null, [
          h('summary.small.muted', { style: { padding: '8px 0' } }, 'Optional'),
          field('Hunger', ratingRow({ value: m.hunger, onChange: (v) => { draft.hunger = v; } })),
          field('Stress', ratingRow({ value: m.stress, onChange: (v) => { draft.stress = v; } }))
        ])
      ]),
      actions: [
        h('button.btn.primary.block', {
          type: 'button',
          onClick: async () => {
            await saveMetrics(today, draft);
            handle.close(true);
            toast('Checked in.');
          }
        }, 'Save')
      ]
    });
  }

  /* ------------------------------------------------------------- render */

  function update() {
    units = view().profile?.units || 'imperial';
    targets = view().profile?.targets || {};
    const day = programDay();
    const total = view().profile?.durationDays || 90;
    setText(dayBadge, day && day >= 1 ? `Day ${Math.min(day, total)} / ${total}` : '');
    actionRow.style.display = isReadOnly() ? 'none' : '';

    const snap = buildSnapshot(view(), today);
    const cls = classify(snap, flatWeekStreak(view(), today));

    // Hero
    fill(heroTrend, snap.weight.trend != null
      ? [fmtNum(snap.weight.trend, 1), h('span.unit', null, units === 'metric' ? 'kg' : 'lb')]
      : ['—']);
    setText(heroLabel, snap.weight.trend != null ? '7-day trend' : 'Weigh in to start the trend');
    const wc = snap.weight.weekChange;
    setText(heroDelta, wc != null ? `${signed(wc, 1)} ${units === 'metric' ? 'kg' : 'lb'} this week` : '');
    heroDelta.className = `hero-delta ${wc != null && wc < 0 ? 'down' : wc != null && wc > 0 ? 'up' : ''}`;
    setText(heroRaw, snap.weight.latest != null
      ? `today ${fmtWeight(snap.weight.latest, units)}`
      : 'no reading today');
    fill(chartSlot, snap.weight.series.filter((p) => p.trend != null).length > 1
      ? trendChart(snap.weight.series.slice(-28), { label: 'Weight trend', height: 150 })
      : null);

    // Status
    const copy = STATE_COPY[cls.state];
    fill(statusSlot, h('div.row.between', null, [
      statusPill(copy.tone, copy.title),
      h('a.small.muted', { href: '#/insights' }, 'Why')
    ]));

    // Fluctuation explanation
    const note = fluctuationNote(view(), today);
    fill(noteSlot, note ? callout(note.text) : null);

    // Nutrition
    const totals = totalsOn(today);
    kcalRow.update(totals.kcal, targets.kcal);
    proteinRow.update(totals.protein, targets.protein);
    carbRow.update(totals.carbs, targets.carbs);
    fatRow.update(totals.fat, targets.fat);
    const kcalLeft = (targets.kcal || 0) - totals.kcal;
    const pLeft = (targets.protein || 0) - totals.protein;
    setText(remainingEl, targets.kcal
      ? `${fmtNum(Math.max(0, kcalLeft), 0)} kcal and ${fmtNum(Math.max(0, pLeft), 0)} g protein left today.`
      : '');

    // Meals
    const meals = foodOn(today);
    fill(mealList, meals.length
      ? meals.map((entry) => h('li', null,
        h('button.item', {
          type: 'button',
          onClick: () => navigate('food', { entry: entry.id })
        }, [
          h('span.time-col', null, fmtTime(entry.ts)),
          h('span.grow', null, [
            h('div.t', null, entry.mealType),
            h('div.s', null, (entry.items || []).map((i) => i.name).join(', ') || '—')
          ]),
          h('span.r', null, [
            h('div.kc', null, `${fmtNum(entry.totals?.kcal, 0)} kcal`),
            h('div.s', null, `${fmtNum(entry.totals?.protein, 0)} g P`)
          ])
        ])))
      : h('li', null, h('div.empty', null, 'Nothing logged yet today.')));

    // Day metrics
    const m = metricsOn(today);
    stepsRow.update(m.steps || 0, view().profile?.stepTarget || 8000);
    setText(sleepEl, m.sleepHours ? fmtDuration(m.sleepHours) : '—');
    setText(energyEl, m.energy ? `${m.energy} / 5` : '—');
  }

  update();
  return { el, update };
}
