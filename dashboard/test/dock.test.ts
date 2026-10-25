// The dock's growing icons: the sizes for a pointer position. No browser.
import { dockSizes } from '../src/Dock';

let failures = 0;
const check = (name: string, ok: boolean, detail: unknown = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  dock: ${name}${ok ? '' : '  ' + JSON.stringify(detail)}`);
  if (!ok) failures++;
};

const none = dockSizes(null, 6);
check('with no pointer every icon is 40px', none.length === 6 && none.every(s => s === 40), none);

// the third icon's centre: ROOM 24 + 2 * (40 + 6) + 20 = 136
const on = dockSizes(136, 6);
check('the icon under the pointer is the biggest, at most 60px', on[2] === 60 && on.every((s, i) => i === 2 || s < on[2]) && Math.max(...on) <= 60, on);
check('its neighbours grow less, and equally on both sides', on[1] === on[3] && on[1] > 40 && on[1] < 60, on);
check('icons far away stay 40px', on[5] === 40 && on[0] <= on[1], on);
check('moving the pointer down moves the peak down', dockSizes(240, 6).indexOf(Math.max(...dockSizes(240, 6))) === 4, dockSizes(240, 6));
check('the total growth stays within the room kept above and below (48px)', on.reduce((a, s) => a + s - 40, 0) <= 48, on);

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
