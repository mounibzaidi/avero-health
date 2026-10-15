import { createClient } from "@supabase/supabase-js";

/** Read-only client for the published fiches (public; RLS lets anyone read published versions only). */
export const supabase = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL!, process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
