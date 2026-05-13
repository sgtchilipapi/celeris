import { createServerClient } from "../celeris/sdk/server-client.js";

type FetchLike = typeof fetch;

export type DeveloperScriptAuth = {
  apiOrigin: string;
  accessToken?: string | null;
  username?: string | null;
  password?: string | null;
};

export function normalizeApiOrigin(apiOrigin: string) {
  const normalized = String(apiOrigin ?? "").trim().replace(/\/+$/, "");
  if (!normalized) {
    throw new Error("api origin is required");
  }
  return normalized;
}

export function validateDeveloperScriptAuth(auth: DeveloperScriptAuth) {
  if (auth.accessToken) {
    return;
  }
  if (auth.username && auth.password) {
    return;
  }
  throw new Error("provide --access-token or both --username and --password");
}

export async function resolveDeveloperAccessToken(
  auth: DeveloperScriptAuth,
  { fetchImpl = globalThis.fetch }: { fetchImpl?: FetchLike } = {}
) {
  validateDeveloperScriptAuth(auth);

  if (auth.accessToken) {
    return auth.accessToken;
  }

  const client = createServerClient({
    apiBaseUrl: normalizeApiOrigin(auth.apiOrigin),
    fetchImpl
  });
  const session = await client.auth.signIn({
    username: auth.username!,
    password: auth.password!
  });
  return session.accessToken as string;
}
