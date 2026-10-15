import { createBrowserClient } from "@supabase/ssr";

/** Supabase client for Client Components. Every table is protected by RLS: it can only do what the user's role allows. */
export const createClient = () =>
  createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!);
