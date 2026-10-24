// Spotting a usage limit and when it resets.
import { isRateLimit, resetTime } from '../limits.js';

let failures = 0;
function check(name: string, ok: boolean, detail: unknown = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  limits: ${name}${ok ? '' : '  ' + JSON.stringify(detail)}`);
  if (!ok) failures++;
}
const now = new Date(2026, 9, 24, 14, 10); // 2:10pm local
const mins = (d: Date) => Math.round((d.getTime() - now.getTime()) / 60_000);

check('a usage limit message is spotted', isRateLimit("You've hit your limit · resets 3pm") && isRateLimit('Claude AI usage limit reached|1729800000'));
check('ordinary output is not', !isRateLimit('Created calc.py with add and sub.'));
check('"resets 3pm" means 50 minutes from 2:10pm', mins(resetTime("You've hit your limit · resets 3pm", now)) === 50, resetTime("resets 3pm", now));
check('"resets 3:30 pm" means 80 minutes', mins(resetTime('5-hour limit reached ∙ resets 3:30 pm', now)) === 80);
check('"resets 2am" is tomorrow, but never more than 6 hours away', mins(resetTime('resets 2am', now)) === 360);
const epoch = Math.floor(now.getTime() / 1000) + 20 * 60;
check('an epoch after "|" is used as is', mins(resetTime(`Claude AI usage limit reached|${epoch}`, now)) === 20);
check('a reset in the past still waits a minute', mins(resetTime(`usage limit reached|${Math.floor(now.getTime() / 1000) - 600}`, now)) === 1);
check('no time given: 30 minutes', mins(resetTime('rate limit, try again later', now)) === 30);

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
