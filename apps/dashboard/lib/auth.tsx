"use client";

import type { Session } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

import { createClient } from "./supabase/client";

type Role = "admin" | "relecteur";
export interface Staff {
  role: Role;
  name: string;
  service: string;
}
interface AuthState {
  loading: boolean;
  session: Session | null;
  /** null when signed in but not listed in staff */
  staff: Staff | null;
  isAdmin: boolean;
  /** Not signed in: everything can be read, nothing saved. */
  viewOnly: boolean;
}

const AuthContext = createContext<AuthState>({ loading: true, session: null, staff: null, isAdmin: false, viewOnly: false });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [staff, setStaff] = useState<{ user: string; staff: Staff | null } | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, [supabase]);

  const userId = session?.user.id;
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    supabase
      .from("staff")
      .select("role,name,service")
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data }) => !cancelled && setStaff({ user: userId, staff: (data as Staff | null) ?? null }));
    return () => {
      cancelled = true;
    };
  }, [supabase, userId]);

  const current = userId && staff?.user === userId ? staff.staff : null;
  const loading = !ready || (!!userId && staff?.user !== userId);
  const viewOnly = ready && !session;
  return <AuthContext.Provider value={{ loading, session, staff: current, isAdmin: current?.role === "admin", viewOnly }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
