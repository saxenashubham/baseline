/**
 * Account and sync.
 *
 * Shown before onboarding on a fresh install when sync is configured, because
 * the alternative is a returning user re-entering a profile they already have
 * in the cloud and then fighting a merge.
 *
 * Signing in is optional. Everything works signed out; the app just lives on
 * one device with no backup.
 */

import { h, fill, clear } from '../core/dom.js';
import { appHeader, callout, toast, spinnerRow, sheet } from '../ui/components.js';
import { state, subscribe } from '../core/store.js';
import { navigate } from '../core/router.js';
import { syncStatus } from '../services/sync.js';

const STATUS_COPY = {
  off: 'Not syncing. This device only.',
  connecting: 'Connecting…',
  live: 'Synced.',
  error: 'Sync hit an error. Your data is safe locally — check the Firestore rules.'
};

export function accountView({ config, onSignIn, onSignOut }) {
  const body = h('div.stack');
  const el = h('div', null, [
    appHeader('Account', state.profile ? h('a.day-badge', { href: '#/home' }, 'Done') : null),
    h('div.view.stack', null, [body])
  ]);

  function render() {
    if (!config || !config.projectId) {
      fill(body, [
        callout('Sync is not configured on this build. Copy src/config.example.js to src/config.js and fill in your Firebase project to turn it on.'),
        h('button.btn.primary.block', { type: 'button', onClick: () => navigate(state.profile ? 'home' : 'onboarding') },
          state.profile ? 'Back' : 'Continue without an account')
      ]);
      return;
    }

    if (!state.auth) {
      fill(body, [
        h('h2.section', null, 'Sign in'),
        h('p.muted', null,
          'Two accounts share this app. Each of you keeps a separate plan and separate numbers — signing in decides which set is yours.'),
        h('button.btn.primary.block', {
          type: 'button',
          onClick: async () => {
            fill(body, spinnerRow('Opening Google…'));
            try {
              await onSignIn();
            } catch (err) {
              console.error(err);
              fill(body, [callout(err?.message || 'Sign-in failed.', 'alert')]);
              setTimeout(render, 2500);
            }
          }
        }, 'Sign in with Google'),
        h('button.btn.block', {
          type: 'button',
          onClick: () => navigate(state.profile ? 'home' : 'onboarding')
        }, state.profile ? 'Not now' : 'Use it on this device only'),
        h('p.small.muted', null,
          'Skipping is fine. It means no backup and no second device — if you lose the phone, you lose the programme.')
      ]);
      return;
    }

    const partner = state.partner;
    fill(body, [
      h('section.card', null, [
        h('p.card-title', null, 'Signed in'),
        h('div.metric', null, [h('span.metric-name', null, state.auth.name), h('span.metric-val', null, '')]),
        h('p.small.muted', null, state.auth.email),
        h('p.small.muted', null, STATUS_COPY[syncStatus()] || '')
      ]),
      h('section.card', null, [
        h('p.card-title', null, 'Household'),
        partner
          ? h('div', null, [
              h('p', null, `${partner.name} is in.`),
              h('p.small.muted', null,
                'You can each see the other’s weight, waist, food, training and reviews. Neither of you can edit the other’s data, and progress photos are never shared in either direction.')
            ])
          : h('p.muted', null, 'Nobody else has signed in yet. When they do, a switcher appears at the top of every screen.')
      ]),
      h('section.card', null, [
        h('p.card-title', null, 'What syncs'),
        h('p.small.muted', null,
          'Weight, waist, meals, workouts, daily metrics, saved meals, portion corrections and weekly reviews. Progress photos do not — they stay in this device’s database and are excluded from every upload path in the code.')
      ]),
      h('button.btn.danger.block', {
        type: 'button',
        onClick: () => {
          const handle = sheet({
            title: 'Sign out',
            body: h('div', null, [
              callout('Your data stays on this device. Signing out stops syncing and hides the other person’s numbers until you sign back in.')
            ]),
            actions: [
              h('button.btn.danger.block', {
                type: 'button',
                onClick: async () => {
                  await onSignOut();
                  handle.close(true);
                  toast('Signed out.');
                  render();
                }
              }, 'Sign out')
            ]
          });
        }
      }, 'Sign out'),
      state.profile
        ? h('button.btn.quiet.block', { type: 'button', onClick: () => navigate('home') }, 'Back to today')
        : h('button.btn.primary.block', { type: 'button', onClick: () => navigate('onboarding') }, 'Set up my plan')
    ]);
  }

  render();
  const unsubscribe = subscribe((_, changed) => {
    if (['auth', 'partner', 'profile', '*'].some((k) => changed.includes(k))) render();
  });

  return { el, update: render, destroy() { unsubscribe(); clear(document.getElementById('sheet-root')); } };
}
