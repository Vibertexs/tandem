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
  - **Pages (seven, in this order).** Board (work still going), Team (the workers, then one "Get started: add a teammate" card, since getting started is adding a teammate), Shared memory (developer info: the notes in every prompt, the agents, files locked now, every other shared value, the raw tables folded away), Usage (tokens or estimated dollars, and quota), Activity (finished goals with their merge button, then the log), Help (every command with a copy button, the start options, which model each effort uses, the words) and Settings (a gear). On a phone all seven fit in the bottom bar. One page per job: nothing is shown on two pages in full. Explaining why it is built this way belongs in the README, not on the page.
  - **Behaviour.** The dock keeps a fixed width (64px). Icons are 36px. When the mouse comes within about 80px of one it grows smoothly to at most 48px, which is as wide as the dock allows, and its neighbours grow less and push the rest away (like a dock). Clicking opens the page. The growth is computed in `Dock.tsx` (`dockSizes`) from the pointer position.
  - **Phone.** The dock becomes a floating bar at the bottom with fixed 46px targets and no growth. It is skipped for touch.
  - **Reduced motion.** With the operating system's reduced-motion setting on, transitions and the working bar's animation are off.
- **Words.** Two roles only. The **conductor** is you and your computer (it ran `tandem --start`); **teammates** are other computers. The page never says "host", "manager" or "controller". The planning Claude shows as the Conductor card.
- **Top bar.** Page title on the left. On the right, everything has one shape, the team pill's: a white pill (full round, 1px border, soft shadow, 38px tall). The team pill (team name, workers online, conductor online or offline), the role pill with a coloured dot ("You are the conductor" blue, "Teammate · watching" grey, waiting amber), and Invite (or "This computer only"). Request control is the same pill, filled ink.
- **Prompt.** One rounded card with a borderless input and a black Send button inside it. A soft coral ring shows when it has focus. Below it, a small segmented choice, **Effort: Low · Medium · High** (Medium first), with one muted line saying what the choice means. It keeps the last choice for the next goal.
- **Segmented choice** (effort, Dollars/Tokens). Round chips in a row; the chosen one is solid ink, the others white with a border.
- **Usage numbers.** Dollars always start with "~" (estimated at API prices; a tooltip says so). Tokens read "12.4k tokens". One switch, remembered per browser, changes every page.
- **Board.** Only the work still going. Each active goal is a white lane. Inside it, above each column of tasks, a round stage tag with a coloured dot and a count: Waiting (grey), To do (amber), In progress (blue), Done (green). Finished goals leave the board: a one-line "Finished" strip below the lanes (goal, branch, **Merge into my project**) and the full result, with cost, who built it and its files, in Activity.
- **People.** Each worker's avatar gets its own soft colour, picked from their name (hue in `Avatar`, tints in `.avatar`), so who did what is easy to see across the board.
- **Task card.** Title, then a rule, then label and value rows (Files, Worker) like an issue tracker. In progress adds a thin moving bar and the live note. Finished tasks collapse to one quiet line.
- **Buttons.** Primary is solid ink. Secondary is white with a border. Destructive is secondary with red text. 38px tall (44px on a phone).
- **Chips.** Round, small, tinted by meaning: green done or free, blue working, amber waiting, red failed.

- **Theme.** Settings → This browser → Theme: System (default), Light or Dark. Saved in this browser; `index.html` applies it before the page draws, so there is no flash. Dark redefines the same tokens.

## Ideas not built yet
- A keyboard shortcut per page (1 to 6) and a command palette on Ctrl+K.
- A strip at the top of the Board showing each worker and what they are on right now.
