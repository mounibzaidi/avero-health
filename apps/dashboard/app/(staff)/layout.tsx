"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";

import { Button, LogoMark, Spinner } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { createClient } from "@/lib/supabase/client";

// Protocoles: every fiche, created from its JSON and PDF, checked block by block, published. Collecte: the source
// PDFs of each topic.
const NAV = [
  { href: "/protocoles", label: "Protocols", also: ["/fiche"] },
  { href: "/collecte", label: "Sources", also: [] as string[] },
];

export default function StaffLayout({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const { loading, session, staff } = useAuth();
  const pathname = usePathname();

  if (loading) {
    return (
      <div className="flex h-dvh items-center justify-center text-muted">
        <Spinner />
      </div>
    );
  }
  if (session && !staff) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="max-w-sm text-sm text-soft">
          This account ({session.user.email}) has no access to the workshop. Ask an administrator to add you to the team.
        </p>
        <Button onClick={() => supabase.auth.signOut()}>Sign out</Button>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur">
        <div className="flex h-12 items-center gap-3 px-4 sm:gap-6 sm:px-5">
          <Link href="/protocoles" className="flex shrink-0 items-center gap-2 font-semibold tracking-tight">
            <LogoMark />
            MedGuides
          </Link>
          <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto whitespace-nowrap text-sm">
            {NAV.map((n) => {
              const active = [n.href, ...n.also].some((h) => pathname === h || pathname.startsWith(`${h}/`));
              return (
                <Link key={n.href} href={n.href}
                  className={`shrink-0 rounded-lg px-2.5 py-1.5 ${active ? "bg-tint font-medium text-accentink" : "text-soft hover:bg-panel hover:text-ink"}`}>
                  {n.label}
                </Link>
              );
            })}
          </nav>
          <div className="flex shrink-0 items-center gap-3 text-sm text-soft">
            {session && staff ? (
              <>
                <span className="hidden md:inline">{staff.name || session.user.email}</span>
                <span className="hidden rounded border border-line px-1.5 py-0.5 text-xs text-muted sm:inline">{staff.role === "admin" ? "Administrator" : "Reviewer"}</span>
                <Button variant="ghost" className="h-8" onClick={() => supabase.auth.signOut()}>
                  Sign out
                </Button>
              </>
            ) : (
              <>
                <span className="rounded border border-line px-1.5 py-0.5 text-xs text-muted" title="Everything can be read; changes are not saved">View only</span>
                <Link href="/login" className="text-sm text-accentink hover:underline">Sign in</Link>
              </>
            )}
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
