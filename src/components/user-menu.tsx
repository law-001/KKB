"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { signOut } from "@/server/auth-actions";
import { IconChevronDown } from "@/components/ui";

export function UserMenu({ name }: { name: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="btn btn-ghost min-h-9 px-3 text-sm"
      >
        <span className="max-w-28 truncate">{name}</span>
        <IconChevronDown
          className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-40 overflow-hidden rounded-xl border border-line bg-cream shadow-lg"
        >
          <Link
            href="/groups"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block px-4 py-2.5 text-sm transition-colors hover:bg-paper"
          >
            Groups
          </Link>
          <form action={signOut}>
            <button
              role="menuitem"
              className="block w-full px-4 py-2.5 text-left text-sm transition-colors hover:bg-paper"
            >
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
