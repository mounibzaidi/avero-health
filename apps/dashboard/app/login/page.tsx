"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Button, ErrorNote, Field, inputCls, LogoMark } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const supabase = useMemo(() => createClient(), []);
  const { session } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (session) router.replace("/protocoles");
  }, [session, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) setError("Wrong email or password.");
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-card border border-edge/[0.06] bg-surface p-7 shadow-surface">
        <div className="mb-6 flex items-center gap-2.5">
          <LogoMark size={32} />
          <div>
            <h1 className="font-semibold leading-tight">Fiche workshop</h1>
            <p className="text-xs text-muted">For the editorial team only</p>
          </div>
        </div>
        <div className="flex flex-col gap-4">
          <Field label="Email">
            <input className={inputCls} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Password">
            <input className={inputCls} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {error && <ErrorNote>{error}</ErrorNote>}
          <Button variant="primary" type="submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </div>
      </form>
    </div>
  );
}
