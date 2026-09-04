/**
 * Demo data, reachable at #/dev. Not linked from anywhere in the UI.
 *
 * The point is not decoration. Every screen in this app is a function of six
 * weeks of history, so without seeded data the only way to review the design is
 * to log for six weeks first. These are the same scenarios the test suite
 * asserts on, so what you see here is what the engine was verified against.
 */

import { h, fill } from '../core/dom.js';
import { appHeader, bottomNav, toast, callout, statusPill, spinnerRow } from '../ui/components.js';
import { replaceAll, eraseAllData } from '../core/store.js';
import { makeState } from '../dev/scenarios.js';
import { buildSnapshot, classify, recommendAdjustment, flatWeekStreak, STATE_COPY } from '../domain/engine.js';
import { todayISO } from '../core/format.js';
import { navigate } from '../core/router.js';

const SCENARIOS = [
  {
    id: 'on_track',
    title: 'Losing at target',
    blurb: 'Six weeks, 1 lb a week, everything logged, strength holding. The boring case the app should mostly produce.',
    opts: { days: 45, lossPerWeek: 1, logFraction: 1, strength: 'stable', waistPerWeek: -0.15 }
  },
  {
    id: 'recomp',
    title: 'Scale flat, waist shrinking',
    blurb: 'The case that looks like failure on a weight-only tracker and is not.',
    opts: { days: 45, lossPerWeek: 0.05, logFraction: 1, strength: 'improving', waistPerWeek: -0.3 }
  },
  {
    id: 'too_steep',
    title: 'Deficit too steep',
    blurb: 'Fast loss with strength going backwards. Should recommend eating more, not trying harder.',
    opts: { days: 45, lossPerWeek: 2.3, logFraction: 1, strength: 'declining', energy: 2, sleep: 5.8 }
  },
  {
    id: 'plateau',
    title: 'Genuine plateau',
    blurb: 'Three flat weeks with clean logging. The one case where a calorie cut is warranted.',
    opts: { days: 56, lossPerWeek: 0, logFraction: 1, strength: 'stable', waistPerWeek: 0 }
  },
  {
    id: 'unlogged',
    title: 'Flat, but half the week unlogged',
    blurb: 'Identical scale data to the plateau above. Should reach the opposite conclusion.',
    opts: { days: 56, lossPerWeek: 0, logFraction: 0.35, strength: 'stable', waistPerWeek: 0 }
  },
  {
    id: 'fresh',
    title: 'Day 4',
    blurb: 'Almost no history. Everything should say so rather than inventing a trend.',
    opts: { days: 4, lossPerWeek: 1, logFraction: 1, strength: 'none' }
  }
];

export function devView() {
  const list = h('div.stack');

  const el = h('div', null, [
    appHeader('Demo data', h('a.day-badge', { href: '#/home' }, 'Done')),
    h('div.view.stack', null, [
      callout('Loading a scenario replaces everything currently stored on this device, photos included. There is no undo.', 'alert'),
      list,
      h('button.btn.danger.block', {
        type: 'button',
        onClick: async () => {
          await eraseAllData();
          toast('Cleared.');
          window.location.reload();
        }
      }, 'Clear everything and start over')
    ]),
    bottomNav('home')
  ]);

  /** Show what the engine concludes before committing anything to the database. */
  function preview(scenario) {
    const fake = makeState(scenario.opts);
    const snap = buildSnapshot(fake, todayISO(), 14);
    const streak = flatWeekStreak(fake, todayISO());
    const cls = classify(snap, streak);
    const rec = recommendAdjustment(snap, cls, streak);
    const copy = STATE_COPY[cls.state];
    return { fake, cls, rec, copy };
  }

  async function load(scenario) {
    const busy = h('div', null, spinnerRow('Writing history…'));
    fill(list, busy);
    try {
      await replaceAll(makeState(scenario.opts));
      toast(`Loaded: ${scenario.title}`);
      navigate('home');
      window.location.reload();
    } catch (err) {
      console.error(err);
      fill(list, callout('Could not write the demo data. Private browsing blocks the database.', 'alert'));
    }
  }

  function render() {
    fill(list, SCENARIOS.map((scenario) => {
      const { cls, rec, copy } = preview(scenario);
      return h('section.card', null, [
        h('div.row.between', null, [
          h('strong', null, scenario.title),
          statusPill(copy.tone, copy.title)
        ]),
        h('p.small.muted', { style: { marginTop: '6px' } }, scenario.blurb),
        h('p.small', null, cls.reasons),
        h('p.small.muted', null, `Recommendation: ${rec.action}${rec.deltaKcal ? ` ${rec.deltaKcal > 0 ? '+' : ''}${rec.deltaKcal} kcal` : ''}`),
        h('button.btn.block', {
          type: 'button',
          style: { marginTop: '10px' },
          onClick: () => load(scenario)
        }, 'Load this')
      ]);
    }));
  }

  render();
  return { el, update: render };
}
