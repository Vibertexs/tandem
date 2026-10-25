// The dock's growing icons: the sizes for a pointer position. No browser.
import { dockSizes } from '../src/Dock';

let failures = 0;
const check = (name: string, ok: boolean, detail: unknown = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  dock: ${name}${ok ? '' : '  ' + JSON.stringify(detail)}`);
  if (!ok) failures++;
};

const none = dockSizes(null, 6);
check('with no pointer every icon is 36px', none.length === 6 && none.every(s => s === 36), none);

// the third icon's centre: ROOM 20 + 2 * (36 + 6) + 18 = 122
const on = dockSizes(122, 6);
check('the icon under the pointer is the biggest, and never more than the dock is wide (48px)', on[2] === 48 && on.every((s, i) => i === 2 || s < on[2]) && Math.max(...on) <= 48, on);
check('its neighbours grow less, and equally on both sides', on[1] === on[3] && on[1] > 36 && on[1] < 48, on);
check('icons far away stay 36px', on[5] === 36 && on[0] <= on[1], on);
check('moving the pointer down moves the peak down', dockSizes(220, 6).indexOf(Math.max(...dockSizes(220, 6))) === 4, dockSizes(220, 6));
check('the total growth stays within the room kept above and below (40px)', on.reduce((a, s) => a + s - 36, 0) <= 40, on);
check('every size is a whole number of pixels between 36 and 48 wherever the pointer is', Array.from({ length: 300 }, (_, p) => dockSizes(p, 6)).flat().every(s => Number.isInteger(s) && s >= 36 && s <= 48));

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
