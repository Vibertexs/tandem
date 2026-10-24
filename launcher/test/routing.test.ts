// routing.json rules (root README section 7).
import { loadRouting, route } from '../routing.js';

let failures = 0;
function check(name: string, ok: boolean, detail: unknown = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  routing: ${name}${ok ? '' : '  ' + JSON.stringify(detail)}`);
  if (!ok) failures++;
}
const r = loadRouting();
const t = (kind: string, difficulty: string, model = '', effort = 'default') => ({ kind, difficulty, model, effort });

check('easy work goes to the small model', route(t('normal', 'easy'), 10, r).model === 'haiku');
check('normal work goes to the default model', route(t('normal', 'normal'), 10, r).model === 'sonnet');
const hard = route(t('normal', 'hard'), 10, r);
check('hard work gets the strongest model and high effort', hard.model === 'opus' && hard.effort === 'high', hard);
check('a map piece uses the map rule', route(t('map', 'hard'), 10, r).model === 'sonnet');
const merge = route(t('reduce', 'normal'), 10, r);
check('a merge task gets the strongest model and high effort', merge.model === 'opus' && merge.effort === 'high', merge);
check('a model set by the manager wins', route(t('normal', 'easy', 'opus'), 10, r).model === 'opus');
check('an effort set by the manager wins', route(t('normal', 'easy', '', 'medium'), 10, r).effort === 'medium');
check('above 80% usage, move one model down', route(t('normal', 'hard'), 85, r).model === 'sonnet');
check('the smallest model cannot go lower', route(t('normal', 'easy'), 95, r).model === 'haiku');
check('unknown usage does not downgrade', route(t('normal', 'hard'), null, r).model === 'opus');
check('a manager-chosen model is never downgraded', route(t('normal', 'easy', 'opus'), 95, r).model === 'opus');

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
