import { corsHeaders } from "../_shared/cors.ts";
import { ensurePlayerProfile } from "../_shared/supabase.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { guestName } = await request.json();

    const session = await ensurePlayerProfile(request, guestName);
    return Response.json(
      {
        id: session.userId,
        displayName: session.displayName,
        isGuest: session.isGuest
      },
      { headers: corsHeaders }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Guest session creation failed.";
    return Response.json({ error: message }, { headers: corsHeaders, status: 500 });
  }
});
