"use client";

import { createClient } from "./supabase/client";

/** The Avero Health service (services/api), called with the staff member's session. */
const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/** The session's bearer header, none when signed out (reading is open). */
async function auth(): Promise<Record<string, string>> {
  const { data } = await createClient().auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`${BASE}${path}`, { ...init, headers: { ...(await auth()), ...(init.headers ?? {}) } });
  } catch {
    throw new Error("API unreachable: start services/api (see its README).");
  }
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error((body as { detail?: string } | null)?.detail ?? `Error ${r.status}`);
  return body as T;
}

export const api = <T,>(path: string, init: RequestInit = {}) =>
  call<T>(path, { ...init, headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } });

/** A multipart upload (the browser sets the boundary). */
export const apiForm = <T,>(path: string, form: FormData) => call<T>(path, { method: "POST", body: form });
