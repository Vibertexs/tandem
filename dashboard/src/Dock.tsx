// The floating navigation on the left. Icons only; the name shows on hover. As the pointer gets
// close, the nearest icons grow and push their neighbours away (like a dock). Clicking one opens
// that page. On a phone it becomes a bar at the bottom, without the growing.
import { useState, type CSSProperties, type ReactNode } from 'react';

// The dock keeps its width (64px with its padding): icons only grow up to the room inside it (48px).
const BASE = 36;   // an icon's size when the pointer is far away
const MAX = 48;    // and when the pointer is right on it, never more than the dock is wide
const REACH = 80;  // how far away the pointer still has an effect
const GAP = 6;
const ROOM = 20;   // spare room above and below, so growing icons do not move the whole dock

const svg = (children: ReactNode) => (
  <svg className="dock-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
const ICONS: Record<string, ReactNode> = {
  board: svg(<><rect x="3" y="4" width="5" height="16" rx="1.5" /><rect x="10" y="4" width="5" height="10" rx="1.5" /><rect x="17" y="4" width="4" height="6" rx="1.5" /></>),
  team: svg(<><circle cx="9" cy="8" r="3.2" /><path d="M3 19c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" /><circle cx="17" cy="9" r="2.4" /><path d="M17.5 13.6c2.2.3 3.5 2 3.5 4.4" /></>),
  memory: svg(<><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4z" /><path d="M5 17a3 3 0 0 1 3-3h11" /></>),
  activity: svg(<path d="M3 12h4l2.5-6 4 12 2.5-6H21" />),
  settings: svg(<><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></>),
};

// Each icon's size for a pointer position (px from the top of the list), or all at BASE.
export function dockSizes(pointer: number | null, count: number): number[] {
  return Array.from({ length: count }, (_, i) => {
    if (pointer === null) return BASE;
    const center = ROOM + i * (BASE + GAP) + BASE / 2;
    const k = Math.max(0, 1 - Math.abs(pointer - center) / REACH);
    return Math.round(BASE + (MAX - BASE) * k * k * (3 - 2 * k)); // smooth, not linear
  });
}

export function Dock({ items, active, badge }: { items: readonly { key: string; label: string }[]; active: string; badge: Partial<Record<string, number>> }) {
  const [pointer, setPointer] = useState<number | null>(null);
  const sizes = dockSizes(pointer, items.length);
  const stack = items.length * BASE + (items.length - 1) * GAP;
  return (
    <nav className="sidebar dock" aria-label="Sections">
      <a className="dock-brand" href="#/board" aria-label="Tandem" title="Tandem"><span className="brand-mark" aria-hidden="true" /></a>
      <ul
        className="plain nav"
        style={{ '--stack': `${stack + ROOM * 2}px`, '--gap': `${GAP}px` } as CSSProperties}
        onPointerMove={e => { if (e.pointerType === 'mouse' && window.innerWidth > 860) setPointer(e.clientY - e.currentTarget.getBoundingClientRect().top); }}
        onPointerLeave={() => setPointer(null)}
      >
        {items.map((p, i) => (
          <li key={p.key} style={{ '--s': sizes[i] } as CSSProperties}>
            <a href={`#/${p.key}`} aria-current={active === p.key ? 'page' : undefined}>
              {ICONS[p.key]}
              <span className="nav-label">{p.label}</span>
              {badge[p.key] ? <span className="badge-count" aria-label={`${badge[p.key]} new`}>{badge[p.key]}</span> : null}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
