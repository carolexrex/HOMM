import { createClient } from "npm:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

export function getServiceClient() {
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for Edge Functions.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

function getAuthToken(request: Request): string {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) {
    throw new Error("Missing authorization header.");
  }

  const [bearer, token] = authHeader.split(" ");
  if (bearer !== "Bearer" || !token) {
    throw new Error("Auth header must be in the format 'Bearer <token>'.");
  }

  return token;
}

export async function requireAuthUser(request: Request) {
  const supabase = getServiceClient();
  const token = getAuthToken(request);
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    throw new Error("Missing or invalid Supabase auth session.");
  }

  return data.user;
}

function normalizeDisplayName(name?: string) {
  const trimmed = name?.trim();
  if (!trimmed) {
    return "Guest Banner";
  }
  return trimmed.slice(0, 32);
}

export async function ensurePlayerProfile(request: Request, guestName?: string) {
  const supabase = getServiceClient();
  const user = await requireAuthUser(request);
  const displayName = normalizeDisplayName(
    guestName ??
      (typeof user.user_metadata?.display_name === "string" ? user.user_metadata.display_name : undefined)
  );
  const isGuest = Boolean(
    (user as { is_anonymous?: boolean }).is_anonymous ??
      (typeof user.app_metadata?.provider === "string" && user.app_metadata.provider === "anonymous")
  );

  const { data, error } = await supabase
    .from("users")
    .upsert(
      {
        id: user.id,
        display_name: displayName,
        is_guest: isGuest
      },
      { onConflict: "id" }
    )
    .select("id, display_name, is_guest")
    .single();

  if (error) {
    throw error;
  }

  return {
    userId: data.id as string,
    displayName: data.display_name as string,
    isGuest: Boolean(data.is_guest)
  };
}
