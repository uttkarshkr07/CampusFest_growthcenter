// Server side: is this request from a signed-in organiser? One call to the database, which
// checks the token itself and returns only the caller's own profile row. A sign-up that was
// never given a profile gets an empty list.
export async function isOrganiser(authorization: string | null, fetcher: typeof fetch = fetch): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey || !authorization?.startsWith("Bearer ")) return false;
  try {
    const res = await fetcher(`${url}/rest/v1/profiles?select=user_id&limit=1`, { headers: { apikey: anonKey, authorization }, signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return false;
    const rows: unknown = await res.json();
    return Array.isArray(rows) && rows.length === 1;
  } catch {
    return false;
  }
}
