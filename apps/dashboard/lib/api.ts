"use client";

import { createClient } from "./supabase/client";

/** The Avero service (services/api), called with the staff member's session. A deployed dashboard without
 * NEXT_PUBLIC_API_URL has no API: the pages that need it (Sources, PDFs) say so instead of failing. */
const BASE = process.env.NEXT_PUBLIC_API_URL ?? (process.env.NODE_ENV === "production" ? "" : "http://localhost:8000");
export const HAS_API = BASE !== "";

/** The session's bearer header, none when signed out (reading is open). */
async function auth(): Promise<Record<string, string>> {
  const { data } = await createClient().auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!HAS_API) throw new Error("Not available in this demo: it needs the Avero API, which is not deployed here.");
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

/** Wakes the API (a free host puts it to sleep when idle) before the page needs it; the answer is not read. */
export const wakeApi = () => { if (HAS_API) void fetch(`${BASE}/docs`, { mode: "no-cors" }).catch(() => {}); };

/** A multipart upload (the browser sets the boundary). */
export const apiForm = <T,>(path: string, form: FormData) => call<T>(path, { method: "POST", body: form });
