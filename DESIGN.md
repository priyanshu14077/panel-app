# Hiring Panel — design system (Oat · Plum · Tangerine)

Read this before touching anything in `src/app/`. Tokens live in `src/app/tokens.css`, imported at the top of `globals.css` into the base layer, so a Tailwind utility on an element still overrides a recipe. Shared pieces (Card, Verdict, LimitMeter, CopyButton, Notice, PageHeader) are in `src/app/ui.tsx`.

## The idea

Hiring Panel is a workbench that tells you “no” seven times and then helps you fix it. The palette is built so that **rejection is calm and the win is loud**:

- **Oat** (`#F3EDE2` ground, `#FBF8F2` cards): a warm, paper-like workspace. Resumes live on paper; so does the app.
- **Plum** (`#5E2B72`): authority. Active tab, PASS verdict, selected resume, the Interviewing/Offer end of the board, the total-cost figure.
- **Tangerine** (`#F2772B`): action and attention. The single “run everything” CTA, “due today” chips, held-back lines, the REJECT→PASS arrow.
- **Berry** (`#A3313D` on `#F6DADC`): the only red. REJECT verdicts, failed evals, unsupported lines. Muted on purpose.
- **Sage** (`#2F6B4F` on `#D8EBDF`): passed evals, supported lines, “unlocks line…”.

A dark plum-ground theme ships in `tokens.css` and follows the OS setting; `<html data-theme="light|dark">` forces one. Components need no changes for it.

## Rules

1. **No color literals in components.** Only `--color-*`, `--verdict-*`, `--severity-*`, `--eval-*`, `--col-*`, `--due-*`, `--limit-*`, `--chart-*`, or the Tailwind names mapped to them below. Add a semantic token to `tokens.css` if one is missing.
2. **One tangerine CTA per screen.** Everything else is `.btn` (oat) or `.btn--primary` (plum).
3. **No pure white surfaces, no gradients, no drop shadows, no left-border accent on cards.** The quoted-line block is the one left-border element, and it's a quote.
4. **Verdicts use the pill, never colored text alone.** PASS = plum pill, REJECT = berry pill, MAYBE = tangerine tint, pending = oat pill with `.streaming`. A reader's PASS means “no” and shows as a berry `PASS (NO)`.
5. **Numbers that matter are mono.** Costs, token counts, character/word counts, quoted resume lines.
6. **Type**: one family at two widths, plus a mono. Mona Sans expanded (`wdth` 125) and heavy (800–900) for `h1`/`h2`, KPI values and display numbers; Mona Sans at normal width for text; Martian Mono (`wdth` 87.5) for figures, token counts and quoted resume lines. They load via `next/font/google` in `layout.tsx` as `--font-mona` / `--font-martian`, which `--font-display` / `--font-body` / `--font-mono` read; `--display-wdth` and `--mono-wdth` set the widths. Never Inter, Roboto, Geist or Arial in the app UI.
7. **Tangerine type**: a heading may light one phrase, its payoff, with `<span className="hl">` (a glowing tangerine gradient on Ember). The setup stays cream: "Everything after <span class=hl>the verdict</span>". On app pages headline figures (`.kpi-value`) take the gradient and page titles stay cream. Never light more than one phrase per heading.

## Layout

- **Shell**: a left rail (`--sidebar-width`, `--color-bg-sidebar`) with the brand mark (plum square, tangerine dot), the four `.nav-tab`s (active = plum pill via `aria-current="page"`) and the recent runs. Below 900 px it becomes a top bar and the runs list hides.
- **Content**: `max-width: 1280px`, padding `24px 32px`; section gap `--space-6`; card gap `--space-4`. The board is the exception: full width, and the board scrolls sideways, never the page.
- **Workspace, no run open**: New run card beside the Knowledge base card.
- **Workspace, run open**: run header (company, role, Download PDF, New run) → one stat strip (automated screen REJECT → PASS leads, then readers who would advance it, mistakes, open questions) → segmented tabs → a two-column body from 1440 px, the right column sticky (PDF on Panel and Studio, the job's facts on Q&A and Outreach).
- Controls ≥ `--control-height` (44 px), radius `--radius-md`. Cards `--radius-xl` with 1 px `--color-border`.

## Screen-by-screen

- **New run**: resume picker as radio cards (selected = `--color-primary-tint` + plum border), job link `.input`, saved posting, posting `.textarea`, two option cards, and **one** `.btn--accent`: “Import the link and run everything”.
- **The panel**: seven `.card.reviewer` in `repeat(auto-fill, minmax(260px, 1fr))`, in the order verdicts land, `aria-live="polite"`. Each opens to the full review. Not yet landed = `.verdict--pending`.
- **What is wrong**: `.mistake` rows; the ranked list's top third is `--severity-high`, the bottom third `--severity-low`.
- **Open questions**: a `.card` each; held-back lines with a `.heldback` chip, `.unlocks` count; an answer turns the chip sage, “none” strikes the line in `--color-text-disabled`. Submit is `.btn--primary`.
- **Project studio**: company brief in `.card--sunken`, URLs as plum links; “Research the company” is the tab's tangerine CTA; idea cards with `.badge--accent` (gap) and `.badge--neutral` (repo it extends). Add-project submit is `.btn--primary`.
- **Application Q&A**: questions on `--color-surface-sunken`, answers on `--color-surface`; a `.limit` meter when the question states a limit; `[brackets]` render as `.heldback`. Send is the tab's tangerine CTA.
- **Outreach & email**: target picker is a `.segmented` control; vertical timeline with `.eyebrow` day markers and a `.card` per message, each with a limit meter. “Draft the sequence” is tangerine; email drafting is `.btn--primary`.
- **Board**: six `.column`s with a 3 px `--col-*` stripe; `.kanban-card` with the screen's before → after pills, `.badge--fail` / `.badge--warn`, `.cost`, write-up dots, and a small `.due--today` chip beside the task text (tangerine stays small). The drawer is a `.card` slide-over on `--color-scrim`; Escape closes it.
- **Evals**: a tile per check (`.kpi-value` percentage, `.progress` filled with `--eval-pass/-warn/-fail` by rate); runs below as expanding rows with a `.table` of `.badge--pass/warn/fail`.
- **Usage & cost**: four KPI cards (total spend `.kpi-value--cost`); spend split by tier in one stacked bar (writer `--chart-1`, research `--chart-2`, fast `--chart-3`); a feature table with a share bar in its tier colour; runs as expanding rows of every call, all figures mono.
- **Knowledge base**: on `--color-bg-sidebar`; “Build knowledge base” / “Refresh” is `.btn--primary`; repo checkboxes are plum via `accent-color`; repos with no commits by you are muted; maturity is `.badge--neutral`.

## Accessibility

- Text ≥ 4.5:1 (3:1 at ≥ 24 px). Muted text is `#6A5C72`, never lighter.
- Verdict, eval and due states always pair colour with a word (PASS / REJECT / fail / due today).
- Real `<button>`, `<a href>`, `<input>` + `<label>`; `aria-current="page"` on the active tab; `aria-live="polite"` on the streaming verdict grid and stage line.
- Keep the focus ring (`--color-focus`, 2 px). `.streaming` and the chevrons respect `prefers-reduced-motion`.

## Tailwind

`globals.css` switches off Tailwind's palette (`--color-*: initial`) and maps these names to tokens, so a utility can never introduce a hex:

| Utility name | Token |
|---|---|
| `canvas`, `rail`, `surface`, `surface-hover`, `sunken` | `--color-bg`, `--color-bg-sidebar`, `--color-surface`, `--color-surface-hover`, `--color-surface-sunken` |
| `line`, `line-subtle`, `track` | `--color-border`, `--color-border-subtle`, `--color-track` |
| `ink`, `muted`, `disabled` | `--color-text`, `--color-text-muted`, `--color-text-disabled` |
| `primary`, `primary-tint`, `primary-tint-text` | plum |
| `accent`, `accent-tint`, `accent-text` | tangerine |
| `pass`, `warn`, `fail` and their `-tint` | `--eval-*` |
| `scrim` | `--color-scrim` |

Tailwind's `text-xs` … `text-2xl` and `rounded-sm` … `rounded-xl` read the token scale (12/13/18/28/32 px; 8/10/12/16 px radii). Use `min-[N]:` breakpoints only where no `sm:`/`xl:` variant on the same property competes; Tailwind sorts arbitrary breakpoints before named ones.

## The Ember theme: the landing page and the app
Every page is now Ember: always dark, lit tangerine. Inside `.ember` (on the landing's root and the `(app)` layout), `tokens.css` redefines the semantic tokens (section 6), so utilities and recipes turn ember with no component changes: tangerine is the primary and the accent, plum is a supporting colour, berry is still the only red. Ember replaces rule 3: glow (`--glow-*`), gradients (`--gradient-accent`, `--aurora-*`) and shadows are allowed, but in the app they mark only what is live or won (the active tab, the run button, PASS, a draggable card, a due-today chip). The oat light theme in sections 2 and 3 is kept for reference and no page uses it.

### App pages
- Styles are in `src/app/ember-app.css`, imported into the components layer so a utility on an element still wins.
- `.ember` sets its own background and text colour; never rely on `<body>`, which keeps the light values.
- Motion answers something that just happened: reviewer cards and verdict pills pop in as they stream, board cards rise in with a stagger and columns light up as drop targets, the drawer slides in, KPI figures count up (`CountUp` from `src/components/motion.tsx`), bars measure up from zero, and each run tab fades in. A slow glow drifts behind the content. `prefers-reduced-motion` turns all of it off.
- Use `.hp-enter` with an inline `--i` index for a staggered entrance, and `.hp-grow` on a bar that should measure up.

## Landing page (`/`)

- Styles live in `src/app/landing.css`, unlayered so they beat the hero's own unlayered CSS. Sections are components in `src/components/landing/`.
- Every animation shows something the product does (verdicts landing, the screen flipping to PASS, the pipeline lighting up, a character count, a card crossing the board, eval bars, cost count-ups). Each starts when its section scrolls into view (`useInView`), and `prefers-reduced-motion` turns all of it off.
- Starting states that hide content sit under `@media (scripting: enabled)`, so nothing stays hidden without JavaScript.
- The hero is `src/components/ui/liquid-sculpture-hero.tsx`, a third-party component with its own CSS and hex defaults; never edit its colours, pass tokens in. Its image is `public/hero/*.png`, drawn from tokens in `scripts/hero-art/art.html`; rerun `scripts/hero-art/render.sh` after changing it.
- Light resume sheets drawn on the dark ground use the `--paper-*` tokens.
- The "Inside the app" tour shows `public/screens/*.jpg`. Capture them only from demo data (a placeholder candidate and made-up companies, served with `JOB_HUNT_ROOT=<demo folder> npx next start -p 3100`), never from real runs: the page is public. Leave out any screen that quotes a real resume line.
- No captions or ledes under section headings: a heading and its component carry the section.
