/**
 * Progress (PRD §§20–25, 47).
 *
 * Progress photos are held as Blobs in IndexedDB and rendered through object
 * URLs that are revoked on unmount. There is no upload path in this file, and
 * the cloud-consent flag in settings is never read here because nothing in this
 * build can act on it.
 */

import { h, fill, clear } from '../core/dom.js';
import {
  appHeader, bottomNav, gearLink, sheet, field, numberInput, toast, progressBar, callout,
  personSwitcher, readOnlyNotice
} from '../ui/components.js';
import { trendChart, chartLegend } from '../ui/chart.js';
import { state, view, isReadOnly, logWaist, savePhoto, removePhoto, programDay } from '../core/store.js';
import { todayISO, fmtDate, signed, fmtWeight, fmtLength, daysBetween } from '../core/format.js';
import { trendSummary } from '../domain/trends.js';
import { toBlob } from '../services/image.js';

export function progressView() {
  const today = todayISO();
  let units = view().profile?.units || 'imperial';
  const createdURLs = [];

  const url = (blob) => {
    const u = URL.createObjectURL(blob);
    createdURLs.push(u);
    return u;
  };

  const weightCard = h('section.card');
  const waistCard = h('section.card');
  const photoCard = h('section.card');
  const timelineCard = h('section.card');
  const noticeSlot = h('div');

  const el = h('div', null, [
    appHeader('Progress', gearLink()),
    personSwitcher(),
    h('div.view.stack', null, [noticeSlot, timelineCard, weightCard, waistCard, photoCard]),
    bottomNav('progress')
  ]);

  /* ------------------------------------------------------------- waist */

  function openWaist() {
    const input = numberInput({
      value: state.waists.find((w) => w.date === today)?.waist ?? '',
      placeholder: units === 'metric' ? 'cm' : 'inches',
      autofocus: true
    });
    const handle = sheet({
      title: 'Waist',
      body: h('div', null, [
        h('p.small.muted', null,
          'At the navel, relaxed, at the end of a normal breath out. Once a week is enough — daily waist readings are mostly measurement error.'),
        field(`Waist (${units === 'metric' ? 'cm' : 'inches'})`, input)
      ]),
      actions: [
        h('button.btn.primary.block', {
          type: 'button',
          onClick: async () => {
            const v = Number(input.value);
            if (!v) return toast('Enter a measurement.');
            await logWaist({ waist: v });
            handle.close(true);
            update();
          }
        }, 'Save')
      ]
    });
  }

  /* ------------------------------------------------------------ photos */

  function addPhoto(pose) {
    const input = h('input', {
      type: 'file',
      accept: 'image/*',
      style: { display: 'none' },
      onChange: async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const blob = await toBlob(file, { maxEdge: 1200 });
        await savePhoto({ pose, blob });
        toast('Saved to this device only.');
        update();
      }
    });
    document.body.appendChild(input);
    input.click();
    setTimeout(() => input.remove(), 1000);
  }

  /** Slider comparison (§24). Two stacked images, one clipped by a wrapper. */
  function openCompare(pose) {
    const shots = state.photos.filter((p) => p.pose === pose);
    if (shots.length < 2) return toast('Two photos of the same pose are needed to compare.');
    const before = shots[0];
    const after = shots[shots.length - 1];

    const afterWrap = h('div.after-wrap', null, h('img', { src: url(after.blob), alt: `${pose}, later` }));
    const handleBar = h('div.handle', { style: { left: '50%' } });
    const stage = h('div.compare', null, [
      h('img', { src: url(before.blob), alt: `${pose}, baseline` }),
      afterWrap,
      handleBar
    ]);
    const range = h('input.compare-range', {
      type: 'range', min: 0, max: 100, value: 50,
      'aria-label': 'Reveal the later photo',
      onInput: (e) => {
        const pct = Number(e.target.value);
        afterWrap.style.clipPath = `inset(0 0 0 ${pct}%)`;
        handleBar.style.left = `${pct}%`;
      }
    });
    afterWrap.style.clipPath = 'inset(0 0 0 50%)';

    sheet({
      title: `${pose} · ${fmtDate(before.date)} vs ${fmtDate(after.date)}`,
      body: h('div', null, [
        stage,
        range,
        h('p.small.muted', null, `${daysBetween(before.date, after.date)} days apart. Same distance and light matter more than the pose.`)
      ])
    });
  }

  function photoRow(pose) {
    const shots = state.photos.filter((p) => p.pose === pose);
    const latest = shots[shots.length - 1];
    const slot = h('div.photo-slot', {
      style: latest ? { backgroundImage: `url(${url(latest.blob)})`, border: 'none' } : {},
      onClick: () => addPhoto(pose)
    }, latest ? '' : pose);
    return h('div', null, [
      slot,
      h('div.row', { style: { justifyContent: 'center', marginTop: '4px' } }, [
        h('button.btn.quiet.small', { type: 'button', onClick: () => addPhoto(pose) }, 'Add'),
        shots.length > 1
          ? h('button.btn.quiet.small', { type: 'button', onClick: () => openCompare(pose) }, 'Compare')
          : null
      ])
    ]);
  }

  /* ------------------------------------------------------------ render */

  function update() {
    units = view().profile?.units || 'imperial';
    fill(noticeSlot, readOnlyNotice());
    const day = programDay() || 0;
    const total = view().profile?.durationDays || 90;
    const milestones = [
      { day: 1, label: 'Baseline' },
      { day: 30, label: 'First real read' },
      { day: Math.round(total / 2), label: 'Midpoint' },
      { day: total, label: 'Final assessment' }
    ];

    fill(timelineCard, [
      h('div.row.between', null, [
        h('p.card-title', { style: { margin: 0 } }, `Day ${Math.max(1, Math.min(day, total))} of ${total}`),
        h('span.small.muted', null, `${Math.round((Math.min(day, total) / total) * 100)}%`)
      ]),
      progressBar(Math.min(day, total) / total),
      h('div.timeline', { style: { marginTop: '14px' } }, milestones.map((m) => h('div', { style: { position: 'relative', paddingBottom: '10px' } }, [
        h(`div.tl-dot.${day >= m.day ? 'done' : 'todo'}`),
        h('div.small', null, `Day ${m.day} — ${m.label}`)
      ])))
    ]);

    const weight = trendSummary(view().weights, 'weight', today);
    fill(weightCard, [
      h('div.row.between', null, [
        h('p.card-title', { style: { margin: 0 } }, 'Weight'),
        h('span.small.muted', null, weight.perWeek != null
          ? `${signed(weight.perWeek, 2)} ${units === 'metric' ? 'kg' : 'lb'}/week`
          : '')
      ]),
      h('div.row.between', null, [
        h('span.num', { style: { fontSize: '26px', color: 'var(--trend)' } }, fmtWeight(weight.trend, units)),
        h('span.small.muted', null, weight.latest != null ? `latest ${fmtWeight(weight.latest, units)}` : '')
      ]),
      trendChart(weight.series.slice(-42), { label: 'Weight', height: 200 }),
      chartLegend([
        { label: 'Daily reading', color: 'var(--raw)' },
        { label: '7-day trend', color: 'var(--trend)' }
      ]),
      view().profile?.startWeight != null && weight.trend != null
        ? h('p.small.muted', { style: { marginTop: '8px' } },
          `${signed(weight.trend - view().profile.startWeight, 1)} ${units === 'metric' ? 'kg' : 'lb'} since day 1.`)
        : null
    ]);

    const waist = trendSummary(view().waists, 'waist', today, 21);
    fill(waistCard, [
      h('div.row.between', null, [
        h('p.card-title', { style: { margin: 0 } }, 'Waist'),
        isReadOnly() ? null : h('button.btn.quiet', { type: 'button', onClick: openWaist }, 'Measure')
      ]),
      view().waists.length
        ? h('div', null, [
            h('div.row.between', null, [
              h('span.num', { style: { fontSize: '26px', color: 'var(--trend)' } }, fmtLength(waist.trend ?? waist.latest, units)),
              h('span.small.muted', null, view().profile?.startWaist != null && waist.latest != null
                ? `${signed(waist.latest - view().profile.startWaist, 1)} since day 1`
                : '')
            ]),
            view().waists.length > 1 ? trendChart(waist.series.slice(-42), { label: 'Waist', height: 160, decimals: 1 }) : null
          ])
        : h('div.empty', null, 'No waist measurements yet. This is the signal that keeps working when the scale stalls.'),
      view().waists.length === 1
        ? callout('One measurement is a baseline, not a trend. Measure again in a week.')
        : null
    ]);

    if (isReadOnly()) {
      // There is no code path that could show these — partner photos are never
      // uploaded, so there is nothing to render even if we wanted to.
      fill(photoCard, [
        h('p.card-title', null, 'Photos'),
        h('div.empty', null, 'Progress photos stay on the device that took them. They are not shared, in either direction.')
      ]);
      return;
    }

    fill(photoCard, [
      h('p.card-title', null, 'Photos'),
      h('div.photo-grid', null, ['front', 'side', 'back'].map(photoRow)),
      h('p.small.muted', { style: { marginTop: '10px' } },
        'Stored on this device only. Nothing here is uploaded, and no photo is ever sent to a model.'),
      state.photos.length
        ? h('button.btn.quiet', {
            type: 'button',
            onClick: () => {
              const handle = sheet({
                title: 'All photos',
                body: h('div.photo-grid', null, state.photos.map((p) => h('div', null, [
                  h('img.thumb', { src: url(p.blob), alt: `${p.pose} ${p.date}` }),
                  h('div.small.muted.center', null, fmtDate(p.date)),
                  h('button.btn.quiet.small.block', {
                    type: 'button',
                    onClick: async () => { await removePhoto(p.id); handle.close(true); update(); }
                  }, 'Delete')
                ])))
              });
            }
          }, `Manage ${state.photos.length} photos`)
        : null
    ]);
  }

  update();

  return {
    el,
    update,
    destroy() {
      createdURLs.forEach((u) => URL.revokeObjectURL(u));
      clear(document.getElementById('sheet-root'));
    }
  };
}
