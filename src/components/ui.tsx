import Link from "next/link";
import { formatCents } from "@/lib/ledger/money";

/*
 * Server-safe primitives shared across pages and client components.
 * No hooks here — importable from both sides of the boundary.
 */

// ── Icons (inline SVG, 1.75 stroke, round caps — never emoji) ───────────

function svgProps(className: string) {
  return {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
    className,
  } as const;
}

export function IconPlus({ className = "size-4" }: { className?: string }) {
  return (
    <svg {...svgProps(className)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function IconX({ className = "size-4" }: { className?: string }) {
  return (
    <svg {...svgProps(className)}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

export function IconMinus({ className = "size-4" }: { className?: string }) {
  return (
    <svg {...svgProps(className)}>
      <path d="M5 12h14" />
    </svg>
  );
}

export function IconCheck({ className = "size-4" }: { className?: string }) {
  return (
    <svg {...svgProps(className)}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function IconArrowLeft({ className = "size-4" }: { className?: string }) {
  return (
    <svg {...svgProps(className)}>
      <path d="M19 12H5m7-7-7 7 7 7" />
    </svg>
  );
}

export function IconChevronRight({
  className = "size-4",
}: {
  className?: string;
}) {
  return (
    <svg {...svgProps(className)}>
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

export function IconArrowRight({ className = "size-4" }: { className?: string }) {
  return (
    <svg {...svgProps(className)}>
      <path d="M5 12h14m-7-7 7 7-7 7" />
    </svg>
  );
}

export function IconChevronDown({ className = "size-4" }: { className?: string }) {
  return (
    <svg {...svgProps(className)}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/**
 * Native select dressed like every other field on the receipt: same
 * border/focus ring as `.field`, plus a chevron so it reads as a dropdown
 * instead of a plain box. `wrapperClassName` controls how the control is
 * sized in its layout (block w-full vs. inline-block w-auto); the select
 * itself always fills that wrapper.
 */
export function Select({
  className = "",
  wrapperClassName = "block w-full",
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  wrapperClassName?: string;
}) {
  return (
    <span className={`relative ${wrapperClassName}`}>
      <select {...props} className={`select w-full ${className}`.trim()} />
      <IconChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-faint" />
    </span>
  );
}

// ── Receipt furniture ────────────────────────────────────────────────────

/** Dotted leader between a label and its amount, like a well-set receipt. */
export function Dots() {
  return (
    <span
      aria-hidden
      className="mx-2 mb-[0.45em] min-w-4 flex-1 self-end border-b-2 border-dotted border-line"
    />
  );
}

/**
 * A money figure. Always mono + tabular. `signed` renders +/− with the
 * pos/neg semantic colors (reserved for money, per DESIGN.md).
 */
export function Amount({
  cents,
  currency,
  signed = false,
  className = "",
}: {
  cents: number;
  currency: string;
  signed?: boolean;
  className?: string;
}) {
  const color = !signed
    ? ""
    : cents > 0
      ? "text-pos"
      : cents < 0
        ? "text-neg"
        : "text-ink-faint";
  return (
    <span className={`font-mono tabular-nums ${color} ${className}`.trim()}>
      {signed && cents > 0 ? "+" : ""}
      {formatCents(cents, currency)}
    </span>
  );
}

export function BackLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-9 items-center gap-1.5 text-sm font-medium text-accent-deep transition-colors hover:text-accent"
    >
      <IconArrowLeft className="size-3.5" />
      {children}
    </Link>
  );
}

/** Eyebrow + heading used at the top of every page, like a printed header. */
export function PageHeader({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <p className="microlabel mb-1">{eyebrow}</p>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          {title}
        </h1>
      </div>
      {children}
    </div>
  );
}

export function EmptyState({
  title,
  hint,
}: {
  title: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-line px-6 py-10 text-center">
      <p className="text-sm font-medium text-ink-soft">{title}</p>
      {hint && <p className="mt-1 text-sm text-ink-faint">{hint}</p>}
    </div>
  );
}
