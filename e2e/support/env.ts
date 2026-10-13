import { execSync } from "node:child_process";

/**
 * Connection details for the local Supabase stack (`npx supabase start`). They are read from
 * `supabase status` at run time, so no key is ever written to the repo. The values are the
 * CLI's local development defaults and only work against 127.0.0.1.
 */
export interface LocalSupabase {
  apiUrl: string;
  anonKey: string;
  serviceRoleKey: string;
}

const CACHE = "BANNERFRONT_E2E_SUPABASE";

export function localSupabase(): LocalSupabase {
  // Cached in the environment so Playwright workers inherit it instead of re-running the CLI.
  const cached = process.env[CACHE];
  if (cached) return JSON.parse(cached) as LocalSupabase;

  let output: string;
  try {
    output = execSync("npx supabase status -o env", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    const detail = error instanceof Error && "stderr" in error ? String((error as { stderr: unknown }).stderr) : String(error);
    throw new Error(`The local Supabase stack is not running. Start it with \`npx supabase start\` (requires Docker).\n${detail}`);
  }
  const values = Object.fromEntries(
    output
      .split("\n")
      .map((line) => /^([A-Z_]+)="?(.*?)"?$/.exec(line.trim()))
      .filter((match): match is RegExpExecArray => Boolean(match))
      .map((match) => [match[1], match[2]])
  );
  const env: LocalSupabase = { apiUrl: values.API_URL, anonKey: values.ANON_KEY, serviceRoleKey: values.SERVICE_ROLE_KEY };
  if (!env.apiUrl || !env.anonKey || !env.serviceRoleKey) {
    throw new Error("`supabase status` did not report API_URL, ANON_KEY, and SERVICE_ROLE_KEY.");
  }
  if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(env.apiUrl)) {
    throw new Error(`Refusing to run browser tests against a non-local Supabase API: ${env.apiUrl}`);
  }
  process.env[CACHE] = JSON.stringify(env);
  return env;
}
