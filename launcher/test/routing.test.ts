// routing.json rules: which models plan a goal and do its tasks, by the goal's effort.
import { EFFORTS, conductorRoute, loadRouting, route } from '../routing.js';

let failures = 0;
function check(name: string, ok: boolean, detail: unknown = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  routing: ${name}${ok ? '' : '  ' + JSON.stringify(detail)}`);
  if (!ok) failures++;
}
const r = loadRouting();
const t = (kind: string, difficulty: string, model = '', effort = 'default') => ({ kind, difficulty, model, effort });

// medium effort (the default): the same rules as before
check('medium: easy work goes to the small model', route(t('normal', 'easy'), 10, r).model === 'haiku');
check('medium: normal work goes to the default model', route(t('normal', 'normal'), 10, r).model === 'sonnet');
const hard = route(t('normal', 'hard'), 10, r);
check('medium: hard work gets the strongest model and high effort', hard.model === 'opus' && hard.effort === 'high', hard);
check('medium: a map piece uses the map rule', route(t('map', 'hard'), 10, r).model === 'sonnet');
const merge = route(t('reduce', 'normal'), 10, r);
check('medium: a merge task gets the strongest model and high effort', merge.model === 'opus' && merge.effort === 'high', merge);
check('no goal effort is the same as medium', JSON.stringify(route(t('normal', 'hard'), 10, r)) === JSON.stringify(route(t('normal', 'hard'), 10, r, 'medium')));
check('an unknown goal effort is treated as medium', JSON.stringify(route(t('normal', 'hard'), 10, r, 'turbo')) === JSON.stringify(route(t('normal', 'hard'), 10, r, 'medium')));

// the goal's effort moves every task's model up or down
check('low: even normal work runs on the small model', route(t('normal', 'normal'), 10, r, 'low').model === 'haiku');
check('low: hard work gets sonnet, not opus', route(t('normal', 'hard'), 10, r, 'low').model === 'sonnet');
check('high: easy work gets sonnet', route(t('normal', 'easy'), 10, r, 'high').model === 'sonnet');
const vh = route(t('normal', 'hard'), 10, r, 'high');
check('high: hard work gets opus with extra-high effort', vh.model === 'opus' && vh.effort === 'xhigh', vh);
const rank = (m: string) => ['haiku', 'sonnet', 'opus'].indexOf(m);
check('for every task, a higher goal effort never picks a smaller model',
  ['easy', 'normal', 'hard'].every(d => rank(route(t('normal', d), 10, r, 'low').model) <= rank(route(t('normal', d), 10, r, 'medium').model) &&
    rank(route(t('normal', d), 10, r, 'medium').model) <= rank(route(t('normal', d), 10, r, 'high').model)));

// the conductor's own model, for planning the goal
check('the conductor plans with haiku at low, sonnet at medium and opus at high',
  conductorRoute('low', r).model === 'haiku' && conductorRoute('medium', r).model === 'sonnet' && conductorRoute('high', r).model === 'opus' && conductorRoute('weird', r).model === 'sonnet');
check('every level has a conductor, every difficulty and both kinds', EFFORTS.every(e => {
  const l = r.by_goal_effort[e];
  return !!l?.conductor?.model && ['easy', 'normal', 'hard'].every(d => !!l.difficulty[d]?.model) && ['map', 'reduce'].every(k => !!l.kind[k]?.model);
}));
check('effort values are ones Claude Code accepts', EFFORTS.every(e => {
  const l = r.by_goal_effort[e];
  return [l.conductor, ...Object.values(l.difficulty), ...Object.values(l.kind)].every(p => ['default', 'low', 'medium', 'high', 'xhigh', 'max'].includes(p.effort));
}));

// overrides and usage
check('a model set by the conductor wins', route(t('normal', 'easy', 'opus'), 10, r).model === 'opus');
check('an effort set by the conductor wins', route(t('normal', 'easy', '', 'medium'), 10, r).effort === 'medium');
check('above 80% usage, move one model down', route(t('normal', 'hard'), 85, r).model === 'sonnet');
check('the smallest model cannot go lower', route(t('normal', 'easy'), 95, r).model === 'haiku');
check('unknown usage does not downgrade', route(t('normal', 'hard'), null, r).model === 'opus');
check('a conductor-chosen model is never downgraded', route(t('normal', 'easy', 'opus'), 95, r).model === 'opus');

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
