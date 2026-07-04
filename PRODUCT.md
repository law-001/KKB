# PRODUCT.md — KKB (kanya-kanyang bayad)

register: product

## Product purpose

Bill splitting for the messy reality of group spending among one Filipino
friend group. Uneven splits ("I only had a salad"), old debts ("you owe me
from three dinners ago"), running tabs between the same friends over time,
and a table-side **sukli calculator**: on an itemized bill, type each
person's cash under *Bayad* and it computes everyone's change and who's
still *kulang*.

The app is completely open: no accounts, no sign-in. Members are names.
It is a shared ledger a barkada runs for itself.

## Users and scene

Friends at a restaurant table in Manila, after dinner. One person holds
their phone under warm restaurant light and types the receipt line by line
while the others watch and hand over cash. Later, someone checks their tab
from a jeepney or their couch. Phone-first, one-handed, glanceable. Desktop
is the "audit at home" mode.

## Brand and tone

The soul of the product is the paper receipt: itemized, monospaced,
totalled, torn off and passed around. Warm, casual, and Filipino
(bayad, sukli, kulang, KKB), but ruthlessly precise about money. The one
architectural rule is also the brand promise: *balances are derived, never
stored; history is appended, never mutated.* Numbers must always look
trustworthy: tabular, aligned, exact.

Tone of copy: a friend who is good at math. Plain sentences, small jokes
allowed, never corporate. Taglish is part of the voice, not a gimmick.

## Anti-references

- Generic fintech SaaS: emerald-on-white Tailwind defaults, identical
  bordered card grids, hero metrics.
- Splitwise clones: cold gray utility with no sense of place.
- Neo-brutalist "playful fintech" (the second-order reflex).
- Emoji as icons, purple gradients, glassmorphism.

## Strategic principles

1. The receipt is the interface. Anything that shows money should read
   like a well-set receipt: mono numbers, dotted leaders, clear totals.
2. Trust through legibility. Signed amounts are color-coded (owed to you /
   you owe) and every figure traces back to the append-only ledger.
3. Table-side speed beats configuration. Big touch targets, 16px inputs
   (no iOS zoom), the itemized flow is the default path.
4. One warm accent, used sparingly. Semantic green/red belong to money
   signs only.
