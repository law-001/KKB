# DESIGN.md — KKB visual system ("thermal receipt ledger")

Theme: single warm light theme. A receipt is paper; the app is used at
dinner tables and in daylight. No auto dark flip.

## Color (OKLCH, defined in `src/app/globals.css` @theme)

| Token | Value | Use |
|---|---|---|
| `paper` | `oklch(97.3% 0.009 84)` | page background |
| `cream` | `oklch(99.3% 0.005 88)` | raised surfaces, inputs |
| `ink` | `oklch(24% 0.015 60)` | primary text, stamp buttons |
| `ink-soft` | `oklch(44% 0.02 66)` | secondary text |
| `ink-faint` | `oklch(55% 0.018 70)` | microlabels, meta |
| `line` | `oklch(87.5% 0.014 80)` | borders |
| `line-soft` | `oklch(92.5% 0.01 82)` | inner dividers |
| `accent` | `oklch(55% 0.145 45)` | burnt tangerine: primary CTA, links, active states |
| `accent-deep` | `oklch(48% 0.14 43)` | hover |
| `accent-soft` | `oklch(94.5% 0.03 60)` | selected chips |
| `pos` / `pos-soft` | `oklch(50% 0.115 158)` / `oklch(95.5% 0.028 158)` | money owed *to* someone, sukli |
| `neg` / `neg-soft` | `oklch(51% 0.15 27)` / `oklch(95.5% 0.02 27)` | money someone owes, kulang, destructive |
| `warn` | `oklch(53% 0.12 70)` | non-blocking warnings |

Rules: never `#000`/`#fff`. `pos`/`neg` are reserved for money semantics
and destructive actions; the accent never means "positive balance".

## Typography

- Sans: Geist (`--font-geist-sans`) for UI text. Headings
  `font-bold tracking-tight`.
- Mono: Geist Mono for **every number, amount, date, currency code,
  method name, and microlabel**, always with `tabular-nums`.
- Microlabel pattern (`.microlabel`): mono, 11px, uppercase,
  `tracking-[0.14em]`, ink-faint. Used as section eyebrows, like a
  thermal-printer header.
- Inputs are 16px (`text-base`) so iOS never zooms.

## Receipt language

- Dotted leaders (`<Dots />`) between a label and its amount.
- Dashed dividers (`border-dashed border-line`) where a receipt would tear.
- `.tear-b` gives cards a zigzag torn bottom edge (mask trick). Reserve it
  for true receipt moments: the live preview and the expense receipt.
- The brand mark is a rubber stamp: `KKB` in mono inside a 2px ink border,
  rotated -2deg.

## Components (see globals.css @layer components)

- `.btn` + `.btn-primary` (accent), `.btn-ghost` (cream/line),
  `.btn-danger` (neg outline), `.btn-stamp` (ink). All have
  `active:translate-y-px` press feedback and 44px-friendly padding.
- `.field` inputs: cream surface, line border, accent focus ring.
- `.card`: cream, line border, rounded-xl. Cards are rationed: lists use
  `divide-y`, sections use whitespace + microlabels. No nested cards.
- Chips (participant toggles): rounded-full, accent-soft when on.
- `<Select>` (ui.tsx): the only way to render a `<select>`. Wraps the
  native element with a `.select` shell (same border/focus ring as
  `.field`, `appearance-none`) and an `<IconChevronDown>` — never use a
  bare `<select className="field">`. `wrapperClassName` sets the layout
  width (`block w-full` default, `inline-block w-auto` for inline pickers).
- `.checkbox`: a stamped 18px square. Markup is
  `<span class="checkbox"><input type="checkbox" class="peer ..." /><IconCheck class="peer-checked:scale-100 ..." /></span>` —
  `has-checked:`/`has-disabled:` on the shell do the rest. Never a bare
  styled `<input type="checkbox">`.
- `<ConfirmDialog>` (confirm-dialog.tsx): the only pattern for destructive
  confirmation (delete group, delete expense). A native `<dialog>` styled
  as `.confirm-dialog` — backdrop dismiss, Escape, and focus trapping come
  from the platform. Don't reintroduce the old inline arm-then-confirm
  button pattern; it reflows surrounding layout and was replaced for that
  reason.

## Layout

- Mobile-first, single column. Shell is `max-w-5xl`; pages set their own
  narrower `max-w-*`.
- Group page: `lg:grid-cols-[2fr_3fr]` (balances rail | expenses).
- Expense form: `lg:grid-cols-[1fr_21rem]` with the receipt preview
  sticky in the right column.
- Spacing on the 4/8 scale; vertical rhythm tiers 16/24/40.

## Motion

CSS only (no animation libraries). `.rise` fade-up on section entry with
`.rise-1..4` stagger delays (60ms steps), `cubic-bezier(0.16,1,0.3,1)`.
Hover/press transitions 150ms. Everything gated behind
`prefers-reduced-motion`.

## Icons

Inline SVG only (`src/components/ui.tsx`), 1.75px stroke, round caps.
Never emoji.
