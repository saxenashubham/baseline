/**
 * Training (PRD §§26–27).
 *
 * Strength is here to answer one question: is the deficit costing muscle? So
 * the view leads with the per-exercise verdict, not with a workout log. A
 * single bad session is never allowed to change that verdict — the engine
 * needs four sessions of an exercise before it will say anything.
 */

import { h, fill, clear } from '../core/dom.js';
import {
  appHeader, bottomNav, gearLink, sheet, field, numberInput, toast, statusPill, callout,
  personSwitcher, readOnlyNotice
} from '../ui/components.js';
import { state, view, isReadOnly, saveWorkout, removeWorkout } from '../core/store.js';
import { todayISO, fmtDate, fmtNum } from '../core/format.js';
import { strengthStatus } from '../domain/engine.js';

const STATUS_TONE = { improving: 'on', stable: 'on', declining: 'off', insufficient: 'watch' };
const STATUS_LABEL = {
  improving: 'Improving',
  stable: 'Holding',
  declining: 'Declining',
  insufficient: 'Not enough sessions'
};

export function trainingView() {
  const summaryCard = h('section.card');
  const exerciseCard = h('section.card');
  const historyList = h('ul.list');
  const noticeSlot = h('div');
  const logButton = h('button.btn.primary.block', { type: 'button', onClick: () => openWorkout() }, 'Log a workout');

  const el = h('div', null, [
    appHeader('Training', gearLink()),
    personSwitcher(),
    h('div.view.stack', null, [
      noticeSlot,
      summaryCard,
      logButton,
      exerciseCard,
      h('h2.section', null, 'History'),
      historyList
    ]),
    bottomNav('training')
  ]);

  /* ----------------------------------------------------------- editor */

  function openWorkout(existing = null) {
    const draft = existing
      ? { ...existing, sets: existing.sets.map((s) => ({ ...s })) }
      : { date: todayISO(), name: suggestName(), sets: [] };

    const setList = h('div');
    const nameInput = h('input.input', { type: 'text', value: draft.name, onInput: (e) => { draft.name = e.target.value; } });
    const dateInput = h('input.input', { type: 'date', value: draft.date, max: todayISO(), onInput: (e) => { draft.date = e.target.value; } });

    function paintSets() {
      fill(setList, draft.sets.length
        ? draft.sets.map((set, idx) => {
            const exercise = h('input.input', {
              type: 'text', value: set.exercise, placeholder: 'Exercise',
              list: 'exercise-suggestions',
              onInput: (e) => { draft.sets[idx].exercise = e.target.value; }
            });
            const weight = numberInput({ value: set.weight ?? '', placeholder: 'Load', onInput: (e) => { draft.sets[idx].weight = Number(e.target.value); } });
            const reps = numberInput({ value: set.reps ?? '', placeholder: 'Reps', onInput: (e) => { draft.sets[idx].reps = Number(e.target.value); } });
            const count = numberInput({ value: set.sets ?? 1, placeholder: 'Sets', onInput: (e) => { draft.sets[idx].sets = Number(e.target.value); } });
            return h('div.card', { style: { marginBottom: '10px' } }, [
              exercise,
              h('div.row', { style: { marginTop: '8px' } }, [weight, reps, count]),
              h('button.btn.quiet', {
                type: 'button',
                onClick: () => { draft.sets.splice(idx, 1); paintSets(); }
              }, 'Remove')
            ]);
          })
        : h('div.empty', null, 'Add the exercises you did.'));
    }

    paintSets();

    const handle = sheet({
      title: existing ? 'Edit workout' : 'Workout',
      body: h('div', null, [
        field('Name', nameInput),
        field('Date', dateInput),
        setList,
        h('button.btn.block', {
          type: 'button',
          onClick: () => {
            const last = lastExercises();
            draft.sets.push({ exercise: last[draft.sets.length] || '', weight: null, reps: null, sets: 3 });
            paintSets();
          }
        }, '+ Add exercise'),
        datalist()
      ]),
      actions: [
        existing
          ? h('button.btn.danger', {
              type: 'button',
              onClick: async () => { await removeWorkout(existing.id); handle.close(true); update(); }
            }, 'Delete')
          : null,
        h('button.btn.primary', {
          type: 'button',
          onClick: async () => {
            const sets = draft.sets.filter((s) => s.exercise && s.reps);
            if (!sets.length) return toast('Add at least one exercise with reps.');
            await saveWorkout({ ...draft, sets });
            handle.close(true);
            toast('Logged.');
            update();
          }
        }, 'Save')
      ].filter(Boolean)
    });
  }

  function datalist() {
    const names = [...new Set(state.workouts.flatMap((w) => (w.sets || []).map((s) => s.exercise)))].filter(Boolean);
    const dl = h('datalist', { id: 'exercise-suggestions' });
    for (const n of names.concat(['Goblet squat', 'Floor press', 'Kettlebell row', 'Romanian deadlift', 'Overhead press', 'Swing'])) {
      dl.appendChild(h('option', { value: n }));
    }
    return dl;
  }

  function suggestName() {
    const names = state.workouts.map((w) => w.name);
    const last = names[names.length - 1];
    if (last === 'Workout A') return 'Workout B';
    if (last === 'Workout B') return 'Workout A';
    return 'Workout A';
  }

  function lastExercises() {
    const last = state.workouts[state.workouts.length - 1];
    return (last?.sets || []).map((s) => s.exercise);
  }

  /* ------------------------------------------------------------ render */

  function update() {
    fill(noticeSlot, readOnlyNotice());
    logButton.style.display = isReadOnly() ? 'none' : '';
    const status = strengthStatus(view().workouts);
    const perWeek = countPerWeek();

    fill(summaryCard, [
      h('div.row.between', null, [
        h('p.card-title', { style: { margin: 0 } }, 'Strength over the last 4 weeks'),
        statusPill(STATUS_TONE[status.status], STATUS_LABEL[status.status])
      ]),
      h('p.small.muted', { style: { marginTop: '8px' } },
        status.status === 'insufficient'
          ? 'Each exercise needs four sessions before a direction means anything. Keep logging.'
          : status.status === 'declining'
            ? 'Load or reps have fallen across most lifts. In a deficit that usually means the deficit is too steep, not that you need to train harder.'
            : 'Holding or adding load while losing weight is the outcome this programme is aiming for.'),
      h('p.small.muted', null, `${perWeek} session${perWeek === 1 ? '' : 's'} a week on average.`)
    ]);

    const rated = status.perExercise.filter((e) => e.sessions >= 2);
    fill(exerciseCard, rated.length
      ? [
          h('p.card-title', null, 'By exercise'),
          ...rated.map((e) => h('div.metric', null, [
            h('span.metric-name', null, capitalize(e.exercise)),
            h('span.metric-val', null, e.status === 'insufficient'
              ? `${e.sessions} session${e.sessions === 1 ? '' : 's'}`
              : `${e.change > 0 ? '+' : ''}${fmtNum(e.change * 100, 0)}% volume`)
          ]))
        ]
      : [h('div.empty', null, 'Log two sessions of the same lift to start a trend.')]);

    const recent = [...view().workouts].reverse().slice(0, 20);
    fill(historyList, recent.length
      ? recent.map((w) => h('li', null, h('button.item', {
          type: 'button',
          onClick: () => (isReadOnly() ? null : openWorkout(w))
        }, [
          h('span.time-col', null, fmtDate(w.date)),
          h('span.grow', null, [
            h('div.t', null, w.name),
            h('div.s', null, (w.sets || []).map((s) => `${s.exercise} ${s.weight || ''}×${s.reps}`).join(' · '))
          ])
        ])))
      : h('li', null, h('div.empty', null, 'No workouts logged yet.')));

    if (!isReadOnly() && view().profile?.goal === 'lose' && perWeek === 0 && view().workouts.length === 0) {
      summaryCard.appendChild(callout('Resistance training is the main thing separating fat loss from weight loss. Without it, roughly a quarter of what you lose tends to be lean mass.'));
    }
  }

  function countPerWeek() {
    const workouts = view().workouts;
    if (!workouts.length) return 0;
    const weeks = Math.max(1, (Date.parse(todayISO()) - Date.parse(workouts[0].date)) / (7 * 86400000));
    return Math.round((workouts.length / weeks) * 10) / 10;
  }

  const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  update();
  return { el, update, destroy() { clear(document.getElementById('sheet-root')); } };
}
