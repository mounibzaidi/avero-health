"use client";

import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

// The old dashboard kit, on the app's tokens (Q5): wash = tint, bad = flag, warn = caution, ok = accent.

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANT: Record<Variant, string> = {
  primary: "bg-btn text-btnink hover:brightness-95 shadow-control",
  secondary: "bg-surface text-ink border border-edge/15 hover:bg-panel",
  ghost: "text-soft hover:bg-panel hover:text-ink",
  danger: "bg-surface text-flag border border-flag/40 hover:bg-flagbg",
};

export function Button({ variant = "secondary", className = "", ...props }: ComponentProps<"button"> & { variant?: Variant }) {
  return (
    <button
      className={`inline-flex h-9 items-center justify-center gap-2 rounded-button px-3.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT[variant]} ${className}`}
      {...props}
    />
  );
}

export function ButtonLink({ variant = "secondary", className = "", ...props }: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={`inline-flex h-9 items-center justify-center gap-2 rounded-button px-3.5 text-sm font-medium transition-colors ${VARIANT[variant]} ${className}`} {...props} />;
}

export function Tag({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" | "urgent" | "caution" }) {
  const cls = {
    urgent: "bg-flagbg text-flag border-flag/20",
    accent: "bg-tint text-accentink border-accent/20",
    caution: "bg-cautionbg text-caution border-caution/25",
    neutral: "bg-surface text-soft border-line",
  }[tone];
  return <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs ${cls}`}>{children}</span>;
}

export function Card({ className = "", ...props }: ComponentProps<"div">) {
  return <div className={`rounded-xl border border-edge/[0.06] bg-surface shadow-surface ${className}`} {...props} />;
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-soft">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium text-soft">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

export const inputCls =
  "h-9 rounded-lg border border-edge/15 bg-input px-2.5 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20";

export function Spinner({ className = "" }: { className?: string }) {
  return <span className={`inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent ${className}`} />;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-edge/20 px-6 py-10 text-center text-sm text-muted">{children}</div>;
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-flag/30 bg-flagbg px-3 py-2 text-sm text-flag">{children}</div>;
}

/** The Avero Health mark: a teal square holding three steps (same as the app). */
export function LogoMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <rect width="64" height="64" rx="16" fill="#245C49" />
      <rect x="17" y="18" width="30" height="7" rx="3.5" fill="#FFFFFF" />
      <rect x="17" y="28.5" width="22" height="7" rx="3.5" fill="#FFFFFF" />
      <rect x="17" y="39" width="14" height="7" rx="3.5" fill="#FFFFFF" />
    </svg>
  );
}
