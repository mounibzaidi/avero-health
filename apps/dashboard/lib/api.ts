"use client";

import { createClient } from "./supabase/client";

/** The MedGuides service (services/api), called with the staff member's session. */
const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function token(): Promise<string> {
  const { data } = await createClient().auth.getSession();
  return data.session?.access_token ?? "";
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`${BASE}${path}`, { ...init, headers: { Authorization: `Bearer ${await token()}`, ...(init.headers ?? {}) } });
  } catch {
    throw new Error("Service injoignable : lancez services/api (voir son README).");
  }
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error((body as { detail?: string } | null)?.detail ?? `Erreur ${r.status}`);
  return body as T;
}

export const api = <T,>(path: string, init: RequestInit = {}) =>
  call<T>(path, { ...init, headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } });

/** A multipart upload (the browser sets the boundary). */
export const apiForm = <T,>(path: string, form: FormData) => call<T>(path, { method: "POST", body: form });

/** A binary response (a page image), as an object URL to show; the caller revokes it. */
export async function apiBlob(path: string): Promise<string> {
  const r = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${await token()}` } });
  if (!r.ok) throw new Error(`Erreur ${r.status}`);
  return URL.createObjectURL(await r.blob());
}
