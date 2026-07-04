"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-fetches the current page's server data when the tab regains focus —
 * e.g. an invite gets accepted in another tab/device while this group page
 * is sitting open, and switching back to it should show the new member
 * without a manual reload.
 */
export function RefreshOnFocus() {
  const router = useRouter();
  // One tab switch fires BOTH `focus` and `visibilitychange`; without a
  // cooldown that's two full server re-renders back to back.
  const lastRefresh = useRef(0);

  useEffect(() => {
    function onFocus() {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastRefresh.current < 5000) return;
      lastRefresh.current = now;
      router.refresh();
    }
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
    };
  }, [router]);

  return null;
}
