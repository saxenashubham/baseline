/**
 * The Sunday questionnaire (PRD §38).
 *
 * The spec lists fourteen questions. Six of them — average sleep, average
 * energy, whether workouts were completed, protein hit rate, waist change,
 * calorie adherence — are already in the database, and asking a person to
 * re-answer what the app measured is how a 30-second check-in becomes a chore
 * nobody finishes. Those are answered from data and removed from this list.
 *
 * What remains is the part the sensors cannot see: intent, friction, and the
 * meals that never got logged.
 */

export const REVIEW_QUESTIONS = [
  {
    id: 'unlogged',
    type: 'choice',
    text: 'How many meals went unlogged this week?',
    options: ['None', '1–2', '3–5', 'More than 5'],
    feeds: 'adherence'
  },
  {
    id: 'unplanned_source',
    type: 'choice',
    text: 'Biggest source of unplanned calories?',
    options: ['Restaurant meals', 'Snacking', 'Drinks', 'Weekend', 'Nothing notable'],
    feeds: 'adherence'
  },
  {
    id: 'fatigue',
    type: 'choice',
    text: 'Any unusual fatigue this week?',
    options: ['No', 'Some', 'A lot'],
    feeds: 'recovery'
  },
  {
    id: 'clothes',
    type: 'choice',
    text: 'How do your clothes fit compared with a month ago?',
    options: ['Looser', 'Same', 'Tighter'],
    feeds: 'body'
  },
  {
    id: 'hardest',
    type: 'text',
    text: 'What was the hardest part this week?',
    feeds: 'behaviour'
  },
  {
    id: 'next',
    type: 'text',
    text: 'One thing you will change next week.',
    feeds: 'behaviour'
  }
];
