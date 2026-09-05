/**
 * Insights (PRD §§32–39, 46, 48).
 *
 * Order matters here. The state and the recommendation come from the rules
 * engine and are rendered first; the model's prose is rendered underneath and
 * is explicitly labelled as narration. If the model is unreachable the page
 * still works — `localNarration` writes duller sentences from the same numbers.
 */

import { h, fill, clear } from '../core/dom.js';
import {
  appHeader, bottomNav, gearLink, sheet, statusPill, callout, toast,
  spinnerRow, ratingRow, field, chipGroup, progressBar, personSwitcher, readOnlyNotice
} from '../ui/components.js';
import { barChart } from '../ui/chart.js';
import { state, view, isReadOnly, saveReview, saveProfile, programDay } from '../core/store.js';
import {
  todayISO, weekStart, isoAddDays, fmtDate, fmtNum, signed, fmtDuration, fmtWeight, fmtLength,
  weightUnit, lengthUnit
} from '../core/format.js';
import {
  buildSnapshot, classify, recommendAdjustment, fatLossConfidence, consistencyScore,
  flatWeekStreak, intakeTrust, STATE_COPY, STATES, avgDailyIntake
} from '../domain/engine.js';
import { narrateReview, localNarration, AIError } from '../services/ai.js';
import { REVIEW_QUESTIONS } from '../domain/questions.js';

export function insightsView() {
  const today = todayISO();
  let wUnit = weightUnit(view().profile);
  let lUnit = lengthUnit(view().profile);

  const noticeSlot = h('div');
  const stateCard = h('section.card');
  const recCard = h('section.card');
  const confidenceCard = h('section.card');
  const consistencyCard = h('section.card');
  const weekCard = h('section.card');
  const reviewSlot = h('div');
  const finalSlot = h('div');

  const el = h('div', null, [
    appHeader('Insights', gearLink()),
    personSwitcher(),
    h('div.view.stack', null, [
      noticeSlot, stateCard, recCard, weekCard, confidenceCard, consistencyCard,
      h('h2.section', null, 'Weekly reviews'),
      reviewSlot,
      finalSlot
    ]),
    bottomNav('insights')
  ]);

  /* --------------------------------------------------- weekly review run */

  async function runWeeklyReview() {
    const start = weekStart(today);
    const snap = buildSnapshot(state, today, 14);
    const cls = classify(snap, flatWeekStreak(state, today));
    const rec = recommendAdjustment(snap, cls, flatWeekStreak(state, today));
    // Reviews are always generated for YOURSELF, never for the other person —
    // hence `state` here rather than `view()`.

    const answers = {};
    const questionBody = h('div', null, REVIEW_QUESTIONS.map((q) => {
      if (q.type === 'rating') {
        return field(q.text, ratingRow({ value: null, onChange: (v) => { answers[q.id] = v; } }));
      }
      if (q.type === 'choice') {
        return field(q.text, chipGroup({ options: q.options, value: null, onChange: (v) => { answers[q.id] = v; } }));
      }
      return field(q.text, h('textarea.input', { rows: 2, onInput: (e) => { answers[q.id] = e.target.value; } }));
    }));

    const handle = sheet({
      title: 'Weekly check-in',
      body: h('div', null, [
        h('p.small.muted', null, 'Fourteen of these questions exist in the spec. These are the ones the app cannot answer from your data.'),
        questionBody
      ]),
      actions: [
        h('button.btn.primary.block', {
          type: 'button',
          onClick: async () => {
            handle.close(true);
            await generate(start, snap, cls, rec, answers);
          }
        }, 'Generate review')
      ]
    });
  }

  async function generate(start, snap, cls, rec, answers) {
    const busy = sheet({ title: 'Weekly review', body: h('div', null, spinnerRow('Writing it up…')) });
    let coaching;
    try {
      if (state.settings.aiEndpoint && state.settings.aiEnabled) {
        coaching = await narrateReview({ snapshot: snap, classification: cls, recommendation: rec, answers }, state.settings);
      } else {
        coaching = localNarration({ snapshot: snap, classification: cls, recommendation: rec });
      }
    } catch (err) {
      coaching = localNarration({ snapshot: snap, classification: cls, recommendation: rec });
      if (err instanceof AIError) toast('Wrote it locally — the model was unreachable.');
    }

    await saveReview({
      weekStart: start,
      snapshot: slim(snap),
      classification: cls,
      recommendation: rec,
      coaching,
      answers,
      createdAt: Date.now()
    });
    busy.close(true);
    update();
    toast('Review saved.');
  }

  /** Reviews are kept forever, so store numbers rather than whole record sets. */
  function slim(snap) {
    return {
      weightTrend: snap.weight.trend,
      weightChange: snap.weight.weekChange,
      perWeek: snap.weight.perWeek,
      waistTrend: snap.waist.trend,
      waistChange: snap.waist.weekChange,
      avgKcal: snap.intake.avgKcal,
      avgProtein: snap.intake.avgProtein,
      loggedDays: snap.intake.loggedDays,
      totalDays: snap.intake.totalDays,
      avgSteps: snap.activity.avgSteps,
      avgSleep: snap.activity.avgSleep,
      avgEnergy: snap.activity.avgEnergy,
      strength: snap.strength.status,
      expenditure: snap.expenditure.avg ?? null,
      workouts: snap.adherence.workouts,
      weighDays: snap.adherence.weighDays
    };
  }

  async function applyRecommendation(rec) {
    if (!rec.newTarget || rec.action === 'hold') return;
    const targets = { ...(state.profile.targets || {}), kcal: rec.newTarget };
    await saveProfile({ targets, targetSource: 'adjusted', targetChangedAt: todayISO() });
    toast(`Target is now ${rec.newTarget} kcal.`);
    update();
  }

  /* ------------------------------------------------------------- render */

  function update() {
    wUnit = weightUnit(view().profile);
    lUnit = lengthUnit(view().profile);
    fill(noticeSlot, readOnlyNotice());
    const snap = buildSnapshot(view(), today, 14);
    const streak = flatWeekStreak(view(), today);
    const cls = classify(snap, streak);
    const rec = recommendAdjustment(snap, cls, streak);
    const copy = STATE_COPY[cls.state];
    const trust = intakeTrust(snap);

    fill(stateCard, [
      h('div.row.between', null, [
        h('p.card-title', { style: { margin: 0 } }, 'Where you are'),
        statusPill(copy.tone, copy.title)
      ]),
      h('p', { style: { marginTop: '8px' } }, cls.reasons),
      h('div.row.wrap', { style: { marginTop: '10px', gap: '6px' } }, [
        h('span.conf', null, [h('b', null, snap.intake.loggedDays + '/' + snap.intake.totalDays), ' days logged']),
        h('span.conf', null, [h('b', null, snap.adherence.weighDays + '/' + snap.intake.totalDays), ' weigh-ins']),
        h('span.conf', null, [h('b', null, trust), ' trust in the intake number'])
      ]),
      trust === 'low'
        ? callout('With this much of the week unlogged, the calorie average is not evidence of anything. Coverage is the fix, not a smaller target.', 'alert')
        : null,
      snap.expenditure.avg
        ? callout(`Your measured daily burn over this window is about ${snap.expenditure.avg} kcal — derived from what you logged and how your trend weight moved, not from an equation.`, 'trend')
        : null
    ]);

    fill(recCard, [
      h('p.card-title', null, 'What to do'),
      h('p', null, rec.why),
      rec.action !== 'hold' && rec.newTarget && !isReadOnly()
        ? h('div', null, [
            h('div.metric', null, [
              h('span.metric-name', null, 'Suggested target'),
              h('span.metric-val', null, `${rec.newTarget} kcal`)
            ]),
            h('button.btn.primary.block', {
              type: 'button', style: { marginTop: '10px' },
              onClick: () => applyRecommendation(rec)
            }, 'Apply this target')
          ])
        : h('p.small.muted', null, 'No change. A plan that changes every week never gets tested.')
    ]);

    // This week's numbers
    const activeFood = view().food;
    const kcalTarget = view().profile?.targets?.kcal || null;
    const weekBars = lastNDays(7).map((d) => ({
      label: fmtDate(d, { weekday: 'narrow' }),
      value: avgDailyIntake(activeFood, d, d),
      over: kcalTarget ? (avgDailyIntake(activeFood, d, d) || 0) > kcalTarget : false
    }));

    fill(weekCard, [
      h('p.card-title', null, 'The last 7 days'),
      barChart(weekBars, { target: kcalTarget }),
      h('div.grid-2', { style: { marginTop: '12px' } }, [
        stat('Weight trend', fmtWeight(snap.weight.trend, wUnit), signed(snap.weight.weekChange, 1)),
        stat('Waist', fmtLength(snap.waist.trend ?? snap.waist.latest, lUnit), signed(snap.waist.weekChange, 1)),
        stat('Calories', snap.intake.avgKcal ? `${fmtNum(snap.intake.avgKcal, 0)}` : '—', 'daily average'),
        stat('Protein', snap.intake.avgProtein ? `${fmtNum(snap.intake.avgProtein, 0)} g` : '—', 'daily average'),
        stat('Steps', snap.activity.avgSteps ? fmtNum(snap.activity.avgSteps, 0) : '—', 'daily average'),
        stat('Sleep', snap.activity.avgSleep ? fmtDuration(snap.activity.avgSleep) : '—', 'nightly average')
      ])
    ]);

    const conf = fatLossConfidence(snap);
    fill(confidenceCard, [
      h('div.row.between', null, [
        h('p.card-title', { style: { margin: 0 } }, 'Evidence of fat loss'),
        h('span.num', { style: { fontSize: '22px', color: 'var(--trend)' } }, `${conf.score}%`)
      ]),
      progressBar(conf.score / 100),
      h('div', { style: { marginTop: '10px' } }, conf.parts.map((p) => h('div.metric', null, [
        h('span.metric-name', null, p.label),
        h('span.metric-val', null, `${Math.round(p.score * 100)}%`)
      ]))),
      h('p.small.muted', { style: { marginTop: '8px' } },
        'This is agreement between independent signals, not a body-fat measurement. It cannot tell you a percentage and does not try to.')
    ]);

    const cons = consistencyScore(view(), today);
    fill(consistencyCard, [
      h('div.row.between', null, [
        h('p.card-title', { style: { margin: 0 } }, 'Consistency this week'),
        h('span.num', { style: { fontSize: '22px' } }, `${cons.score}%`)
      ]),
      h('div', null, cons.components.map((c) => h('div.metric', null, [
        h('span.metric-name', null, c.label),
        h('span.metric-val', null, `${Math.round(Math.min(1, c.value) * 100)}%`)
      ]))),
      h('p.small.muted', { style: { marginTop: '8px' } },
        'A useful number to watch and a bad one to optimise. Good weeks happen at 80%.')
    ]);

    // Reviews
    const thisWeek = weekStart(today);
    const reviews = view().reviews || [];
    const done = reviews.find((r) => r.weekStart === thisWeek);
    fill(reviewSlot, [
      isReadOnly()
        ? null
        : h('button.btn.primary.block', { type: 'button', onClick: runWeeklyReview },
          done ? 'Run this week again' : 'Run the weekly review'),
      ...[...reviews].reverse().map(renderReview)
    ]);

    // Day 90
    const day = programDay() || 0;
    const total = view().profile?.durationDays || 90;
    fill(finalSlot, day >= total
      ? h('section.card', { style: { marginTop: '16px' } }, [
          h('p.card-title', null, 'Programme complete'),
          h('button.btn.primary.block', { type: 'button', onClick: openFinalReport }, `Open the day ${total} report`)
        ])
      : null);
  }

  function stat(label, value, sub) {
    return h('div.tile', null, [h('div.k', null, label), h('div.v', null, value), h('div.k', null, sub)]);
  }

  function renderReview(review) {
    const c = review.coaching || {};
    const copy = STATE_COPY[review.classification?.state] || STATE_COPY[STATES.UNDECIDED];
    return h('section.card.review', { style: { marginTop: '12px' } }, [
      h('div.row.between', null, [
        h('p.card-title', { style: { margin: 0 } }, `Week of ${fmtDate(review.weekStart)}`),
        statusPill(copy.tone, copy.title)
      ]),
      h('h4', null, 'What happened'),
      h('p', null, c.whatHappened || '—'),
      h('h4', null, 'What it means'),
      h('p', null, c.whatItMeans || '—'),
      h('h4', null, 'What went well'),
      h('p', null, c.whatWentWell || '—'),
      h('h4', null, 'Next week'),
      h('ul', null, (c.nextWeek || []).map((line) => h('li', null, line))),
      c.watchFor ? callout(c.watchFor) : null,
      c.offline ? h('p.small.muted', null, 'Written locally without the model.') : null
    ]);
  }

  /* --------------------------------------------------------- day 90 (§48) */

  function openFinalReport() {
    const s = view();
    const start = s.profile.programStart;
    const last = s.weights[s.weights.length - 1];
    const firstWaist = s.waists[0];
    const lastWaist = s.waists[s.waists.length - 1];
    const days = s.profile.durationDays || 90;
    const avgKcal = avgDailyIntake(s.food, start, today);
    const steps = Object.values(s.metrics).map((m) => m.steps).filter(Number.isFinite);
    const sleeps = Object.values(s.metrics).map((m) => m.sleepHours).filter(Number.isFinite);

    const line = (label, value) => h('div.metric', null, [
      h('span.metric-name', null, label), h('span.metric-val', null, value)
    ]);

    sheet({
      title: `Day ${days}`,
      body: h('div', null, [
        h('h4', null, 'Body'),
        line('Starting weight', fmtWeight(s.profile.startWeight, wUnit)),
        line('Ending weight', fmtWeight(last?.weight, wUnit)),
        line('Change', signed((last?.weight ?? 0) - (s.profile.startWeight ?? 0), 1)),
        firstWaist && lastWaist ? line('Waist', `${fmtLength(firstWaist.waist, lUnit)} → ${fmtLength(lastWaist.waist, lUnit)}`) : null,
        h('h4', null, 'Nutrition'),
        line('Average calories', avgKcal ? fmtNum(avgKcal, 0) : '—'),
        line('Days logged', `${new Set(s.food.map((f) => f.date)).size} of ${days}`),
        h('h4', null, 'Training'),
        line('Sessions', String(s.workouts.length)),
        line('Strength', s.workouts.length ? 'See Training for the per-lift breakdown' : '—'),
        h('h4', null, 'Recovery'),
        line('Average steps', steps.length ? fmtNum(steps.reduce((a, b) => a + b, 0) / steps.length, 0) : '—'),
        line('Average sleep', sleeps.length ? fmtDuration(sleeps.reduce((a, b) => a + b, 0) / sleeps.length) : '—'),
        h('p.small.muted', { style: { marginTop: '14px' } },
          'Photos stay in Progress. Compare day 1 against today there — the slider is the honest version of a before-and-after.')
      ])
    });
  }

  const lastNDays = (n) => Array.from({ length: n }, (_, i) => isoAddDays(today, -(n - 1 - i)));

  update();
  return { el, update, destroy() { clear(document.getElementById('sheet-root')); } };
}
