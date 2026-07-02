# KKB — kanya-kanyang bayad

Bill splitting for the messy reality of group spending: uneven splits
("I only had a salad"), old debts ("you owe me from three dinners ago"),
running tabs between the same friends over time — and a built-in **sukli
calculator**: on an itemized bill, type each person's cash under *Bayad*
and it computes everyone's change, who's still *kulang*, and what the
payer hands back.

Built from `splitweird-plan.md`. Stack: **Next.js 16 (App Router) +
TypeScript + Tailwind + Drizzle ORM + SQLite** (the plan's "simpler
alternative" DB — zero setup, same relational architecture) with Server
Actions instead of tRPC, Zod validation, and hand-rolled scrypt/session auth.

## Run it

```bash
npm install
npm run db:push    # create ./data/splitweird.db from the Drizzle schema
npm run db:seed    # optional: demo group with every split method
npm run dev        # http://localhost:3000
```

After seeding, sign in as `alex@example.com` / `password123`
(also `mia@` / `sam@`, same password) and open the **Friday Dinner Crew**
group, or visit `/join/demo-invite`.

```bash
npm test           # ledger core: 33 table-driven + property-based tests
npm run lint
npm run build
```

## Architecture — the one rule

> **Balances are derived, never stored; history is appended, never mutated.**

- `src/lib/ledger/` — **the pure core**, zero framework imports:
  - `rounding.ts` — largest-remainder allocation, deterministic tie-breaks,
    exact conservation (outputs always sum to the input, even for negatives)
  - `split.ts` — `computeShares()` for all six methods: `even`, `exact`,
    `shares`, `percent` (basis points), `itemized` (per-item consumers with
    weights + proportional/even tax/tip/discount distribution), `adjustment` (IOU)
  - `balances.ts` — net balances + pairwise-exact debts, zero-sum assertion
  - `simplify.ts` — greedy debt simplification (≤ n−1 transfers)
  - `money.ts` — the only place cents become display strings (JPY/KRW are
    zero-decimal and handled)
- `src/lib/db/` — Drizzle schema (append-only ledger: expenses supersede,
  never mutate; deletes are status flips) and queries, including the one
  UNION-ALL aggregate that *is* the balances feature
- `src/server/` — Server Actions: auth, groups (invites + ghost members),
  expenses (create / supersede-edit with conflict detection / delete),
  settlements (pending → recipient confirms; ghosts auto-confirm)
- `src/app/` — routes: group overview with live balances, expense form with
  client-side live preview (running the same `computeShares` as the server),
  itemized receipt builder, settle-up screen with suggested plan and
  one-tap recording, per-pair drill-down with running subtotal, activity feed

## Money-math rules (enforced, not aspirational)

1. Integers only — all amounts are integer minor units end to end.
2. Largest-remainder rounding everywhere, ties broken by sorted user id.
3. Conservation asserted at runtime before commit *and* in property tests
   (`fast-check`): shares sum to the total; group balances sum to zero.
4. Sign discipline documented once in `balances.ts`: paid +, consumed −,
   settlement sent +, received −.

## Not built yet (per the plan's phasing)

Ghost-claim merging, member removal guard, multi-currency, realtime,
email digests, receipt OCR, unread badges, `balances_cache` exercise.
