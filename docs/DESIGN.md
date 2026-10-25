# Tandem design

The dashboard's look, written down so it stays consistent. Everything here lives in
[`dashboard/src/styles.css`](../dashboard/src/styles.css) (the tokens are the `:root` block at the top).
To see every page without a running team, open the dashboard with `?mock=1`.

**In one line:** a warm paper canvas with a faint dot grid, white soft cards, one coral accent, and a floating dock for navigation.

## What it is not
These are deliberate. Do not add them back.
- No coloured bar on the side of a card or menu item.
- No gradients, no glow, no emoji, no unicode glyphs as icons. Icons are inline SVG line icons.
- No uppercase monospace labels. Labels are sentence case.
- No pastel fills for status. Status is a small dot or a tinted pill, in the status colours below.

## Colour
| Token | Light | Use |
|---|---|---|
| `--canvas` | `#f5f4f0` | page background (with a dot grid in `--dot` `#dedbd2`, 22px) |
| `--surface` | `#ffffff` | cards, dock, drawer, inputs |
| `--surface-2` | `#faf9f6` | code blocks, finished task rows, quiet panels |
| `--fill` | `#f0eee9` | hover, chips, progress tracks |
| `--ink` | `#1d1c1a` | text, primary buttons |
| `--muted` | `#77746c` | secondary text |
| `--line` / `--line-strong` | `#e8e5de` / `#d6d2c8` | borders |
| `--accent` | `#d9623b` | progress, focus ring, the page you are on (coral) |
| `--accent-strong` | `#c4502b` | links and text on the accent tint |
| `--accent-soft` | `#fbece6` | tint behind the active dock icon and avatars |
| `--ok` | `#2f8f5b` | done, free, online |
| `--info` | `#3b6fd4` | working, planned |
| `--warn` | `#a76b00` | waiting for something, given back |
| `--danger` | `#c0392b` | failed, out of quota |

Dark mode follows the operating system and uses the same names with darker values.

## Type
System font stack (`Inter` first if installed, then Segoe UI Variable on Windows, then the system font). Mono for file names, commands and branch names.
- Base 14px, line height 1.55.
- Page title 1.4rem, weight 600, letter spacing -0.025em. Card titles 0.9 to 1rem, weight 500 to 600.
- Small text 0.8rem. Muted for anything that is not the main fact.

## Shape and depth
- Radii: cards 16px, lanes 20px, task cards 12px, inputs and buttons 10px, tags and chips fully round.
- Depth comes from a 1px border plus one soft shadow (`--shadow-sm` on cards, `--shadow` on the dock, lanes, drawer, prompt). No harsh shadows.
- Spacing: 4px steps. Cards pad 18 to 20px. Gaps between cards 12 to 16px.

## Components
- **Dock (navigation).** A white rounded panel floating on the left, vertically centred. Icons only; the name appears as a dark label to the right on hover or keyboard focus. The active page has the accent tint and accent-coloured icon. A badge (accent dot with a count) shows pending requests.
  - **Behaviour.** Icons are 40px. When the mouse comes within about 90px of one it grows smoothly to at most 60px, and its neighbours grow less and push the rest away (like a dock). Clicking opens the page. The growth is computed in `Dock.tsx` (`dockSizes`) from the pointer position.
  - **Phone.** The dock becomes a floating bar at the bottom with fixed 46px targets and no growth. It is skipped for touch.
  - **Reduced motion.** With the operating system's reduced-motion setting on, transitions and the working bar's animation are off.
- **Top bar.** Page title on the left. On the right: a team pill (team name, workers online, manager state), a chip that says whether you control the team, and the Invite button.
- **Prompt.** One rounded card with a borderless input and a black Send button inside it. A soft coral ring shows when it has focus.
- **Board.** Each goal is a white lane. Above the tasks, four round stage tags with a coloured dot: Waiting (grey), To do (amber), In progress (blue), Done (green).
- **Task card.** Title, then a rule, then label and value rows (Files, Worker) like an issue tracker. In progress adds a thin moving bar and the live note. Finished tasks collapse to one quiet line.
- **Buttons.** Primary is solid ink. Secondary is white with a border. Destructive is secondary with red text. 38px tall (44px on a phone).
- **Chips.** Round, small, tinted by meaning: green done or free, blue working, amber waiting, red failed.

## Ideas not built yet
- A keyboard shortcut per page (1 to 6) and a command palette on Ctrl+K.
- A strip at the top of the Board showing each worker and what they are on right now.
- A light and dark switch in Settings (today it follows the operating system).
