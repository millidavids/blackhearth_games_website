# Blackhearth Games Website

Studio website for [Blackhearth Games](https://blackhearthgames.com). A single-screen, terminal-style interface for an indie fantasy game studio — type a command in the prompt to read the bio, browse the catalogue, or get in touch.

Vanilla HTML / CSS / JS. No frameworks, no build step, no analytics.

## What it is

The whole site is a fake terminal window. Visitors type commands at a prompt; output prints inline above the prompt like a real shell. Every section of a conventional studio site (about, games, ethos, contact) is a command.

```
┌─ BLACKHEARTH GAMES ─────────────────────────────  03:14:22 UTC ─┐
│                                                                  │
│  venture forth, friend · solo studio · est. 2026                │
│  ● online · scheme: dark                                         │
│                                                                  │
│  > welcome. type help to list commands…                          │
│                                                                  │
│  guest@blackhearth ~ $ █                                         │
│                                                                  │
└─ tab complete · → accept · ↑/↓ history · ⌘K clear · ⌘; scheme ─┘
```

### Commands

| Canonical | Aliases | What it does |
|---|---|---|
| `about` | `whoami`, `bio`, `studio` | Studio identity (founder, ethos, license) |
| `games` | `ls`, `library` | The studio's catalogue (currently Court Wizard) |
| `ethos` | `creed`, `philosophy`, `manifesto` | The studio's working principles |
| `contact` | `email`, `hello`, `hi` | One-tap mailto |
| `open <game>` | — | Visit a game's website in a new tab (e.g., `open court-wizard`) — this navigates to the standalone game site; it does not run the game itself |
| `roll <dice>` | `r`, `dice` | Dice roller — see [Dice notation](#dice-notation) |
| `whois david` | — | Founder info |
| `su <name>` | — | Switch the prompt's username (persists; `root` rejected) |
| `help` | `?`, `h` | Command reference |
| `scheme` | `mode`, `theme`, `color`, `colour` | Toggle light / dark |
| `clear` | `cls` | Empty the buffer |
| `credits` | — | Build info + font attribution |
| `reboot` | `restart` | Replay the boot animation |
| `exit` | `quit`, `q` | Disable the input (any key restores) |

### Dice notation

`roll` accepts `NdM[th|tlK][±K]`:

- `1d20` — one twenty-sided die (or `d20`, count defaults to 1)
- `3d6+2` — three six-sided dice with a +2 modifier
- `2d8-1` — two eight-sided dice with a −1 modifier
- `8d20th6` — roll 8d20, **take the highest 6** (dropped rolls show dimmed)
- `4d6tl3` — roll 4d6, **take the lowest 3**
- `8d20th6+2` — combine: take highest 6, then add 2

Sanity caps: at most 1000 dice, at most 1,000,000 sides per die.

### Keyboard

All hotkeys are modifier-based so they fire regardless of whether the prompt input has focus:

- `Enter` — run the typed command
- `Tab` — accept ghost suggestion if present, otherwise prefix-complete
- `→` / `End` — accept ghost suggestion
- `↑` / `↓` — scrub session history
- `⌘K` / `Ctrl+K` — clear buffer
- `⌘;` / `Ctrl+;` — toggle scheme (light/dark)
- `Esc` — cancel current input (Ctrl-U-style line clear)

### Mobile

On small touch screens the typed prompt is replaced by a chip nav row (`about`, `games`, `ethos`, `contact`, `help`, `credits`, and a `☾`/`☼` scheme toggle). The chip taps dispatch the corresponding commands through the same handler the prompt uses. Help output filters its rows by a `mobileVisible` flag on each command entry, so typing-required commands (`open`, `roll`, `whois`, `su`, `man`, `clear`, `reboot`, `exit`) don't appear in the mobile help screen.

Inside the help and `man` output, command names are real `<button data-cmd="…">` elements that run the command on click — so users who can't type still have a way to invoke every chip-reachable command.

### Autosuggestion

The prompt does fish-style inline suggestions:

1. **History first** — if you've typed a command earlier, typing its first few characters shows the rest of that entry as a dim suffix.
2. **Command names** — if no history match, suggests the shortest matching canonical command.
3. **Argument completion** — typing a command that takes an argument (e.g. `whois`) auto-suggests the first registered target. Typing `whois da<Tab>` completes to `whois david`.

The block cursor renders the upcoming character inverted (bg color on fg background) so the cursor overlays the suggestion rather than pushing it.

### Themes

Two modes, both built around the same arcane-violet brand color:

- **Dark** (default): `#c89cff` foreground on `#0b0907` near-black
- **Light** (`scheme` or `⌘;`): near-black foreground on `#f1eaf7` milky-lavender

Persisted to `localStorage` as `bh.scheme`. There's no separate "color theme" — arcane is the only palette.

## File structure

```
.
├── index.html          ← the page (semantic SSR markup + REPL chrome)
├── css/styles.css      ← token system, theme, layout
├── js/main.js          ← state, commands, autosuggest, boot, hotkeys
├── 404.html            ← themed 404 page (no JS)
├── LICENSE             ← MIT (the website code; Court Wizard the game is GPL-3.0)
├── fonts/              ← self-hosted typefaces — see fonts/NOTICE.md
│   ├── MonaspaceNeon-Var.woff2    ← terminal (variable)
│   ├── MonaspaceKrypton-Var.woff2 ← UI (variable)
│   ├── PressStart2P-Regular.woff2                      ← wordmark only (latin subset)
│   └── NOTICE.md
├── images/
│   ├── blackhearth_logo.svg   ← favicon (SVG)
│   └── blackhearth_logo.png   ← favicon fallback + apple-touch-icon
├── infra/              ← Cloudflare Pages + DNS (OpenTofu)
└── scripts/
    ├── serve.py        ← local dev server
    └── deploy.sh       ← manual deploy
```

### How the page actually works

- **JS-on path**: an inline script in `<head>` synchronously adds `class="has-js"` to `<html>` before first paint. CSS rules `body.has-js [data-pane] { display: none }` hide the static `<section data-pane="…">` content blocks. `main.js` boots the REPL, and command handlers `cloneNode(true)` the static panes into the output buffer when triggered.
- **JS-off path**: `.has-js` never gets added. CSS reveals all static panes as a vertical monospace document. REPL chrome (anything with class `.repl-only`) is hidden. A `.static-only` welcome paragraph and footer appear in place of the prompt. Anchor links work; chips degrade to `<a href="#about">`-style anchors.
- **Routing**: top-level content commands (`about`, `games`, `ethos`, `contact`) push to `location.hash`. Legacy hashes (`#philosophy` / `#creed` → `ethos`) are aliased. Hitting back un-runs without re-pushing.
- **Static DOM is the source of truth**: pane content lives in real HTML, never in `<template>`. The REPL clones from the DOM at command-time.
- **Sticky prompt + scroll choreography**: the prompt form is sticky `bottom: 0` inside the buffer. It sits in normal flow right after the latest content; if the user scrolls up far enough to push it off the bottom, it sticks to the visible bottom of the buffer. After a command is entered, the buffer scroll-animates so the new echo lands at the visible top — the typewriter then waits for the `scrollend` event (with a timeout fallback) before revealing the result, so the visual is: prompt returns to the top → result types in beneath it.

## Fonts

Three free / open-source typefaces, all self-hosted (no Google Fonts / CDN dependencies):

- **Monaspace Neon** (SemiWide Regular, Nerd Font patched) — terminal body, prompt, output buffer, panes. SIL OFL.
- **Monaspace Krypton** (SemiWide Regular, Nerd Font patched) — chrome, identity strip, legend, footer. SIL OFL.
- **Press Start 2P** — the `BLACKHEARTH GAMES` wordmark only. SIL OFL.

Full attribution in [`fonts/NOTICE.md`](fonts/NOTICE.md).

## Local development

```bash
python3 scripts/serve.py
# Open http://localhost:8001
```

The server is `http.server.SimpleHTTPRequestHandler` on port 8001. It always serves from the project root, regardless of the directory you invoke it from. Because there's no build step, edits are live on reload. Stylesheet and JS link tags use `?v=N` query strings to defeat browser caching — bump those when iterating if you see stale assets.

## Infrastructure

Hosted on Cloudflare Pages. Infrastructure managed with OpenTofu.

```bash
cd infra
export CLOUDFLARE_API_TOKEN="your-token"
tofu init
tofu apply -var="cloudflare_account_id=YOUR_ACCOUNT_ID"
```

This repo owns the `blackhearthgames.com` DNS zone. Apply this infra before any subdomain sites.

## Deploy

Pushes to `main` automatically deploy via GitHub Actions.

Manual deploy:

```bash
export CLOUDFLARE_API_TOKEN="your-token"
export CLOUDFLARE_ACCOUNT_ID="your-account-id"
./scripts/deploy.sh
```

## License

The website code is [MIT](LICENSE). Court Wizard (the studio's current game) is separately licensed under GPL-3.0 — see [courtwizard.blackhearthgames.com](https://courtwizard.blackhearthgames.com). Future games will be licensed individually; nothing here commits to a blanket open-source policy.
