"use client";

import { useEffect, useRef } from "react";

/**
 * Shared destructive-action confirmation, used for deleting groups and
 * expenses. A native <dialog> so focus trapping, Escape-to-close, and the
 * backdrop all come from the platform for free — styled to match the
 * receipt system in .confirm-dialog (globals.css).
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  pendingLabel,
  pending,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  pendingLabel: string;
  pending: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="confirm-dialog"
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-description"
      onCancel={(e) => {
        e.preventDefault();
        if (!pending) onCancel();
      }}
      onClick={(e) => {
        if (e.target === ref.current && !pending) onCancel();
      }}
    >
      <div className="p-5">
        <p id="confirm-dialog-title" className="microlabel mb-1.5 text-neg">
          {title}
        </p>
        <p
          id="confirm-dialog-description"
          className="text-sm leading-relaxed text-ink-soft"
        >
          {description}
        </p>
        {error && (
          <p role="alert" className="mt-3 text-sm text-neg">
            {error}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={onCancel}
            className="btn btn-ghost min-h-10 px-4 text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={onConfirm}
            className="btn min-h-10 bg-neg px-4 text-sm text-cream hover:bg-neg/85"
          >
            {pending ? pendingLabel : confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
