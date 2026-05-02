import crypto from "node:crypto";
import { createPrivyTestToken } from "../../services/privy-auth-service.js";

function resolveTestVerifierSecret() {
  return process.env.PRIVY_APP_SECRET ?? process.env.PRIVY_VERIFIER_SECRET ?? "privy-dev-secret";
}

export async function createHostedPlayerSession({
  api,
  appId,
  walletAddress,
  subject = `did:privy:test-user:${walletAddress.toLowerCase()}`,
  origin = "http://localhost:3002",
  redirectUri = "http://localhost:3002/auth/callback"
}: {
  api: {
    handle(input: {
      method: string;
      url: string;
      headers?: Record<string, string>;
      body?: Record<string, unknown>;
    }): Promise<{ statusCode: number; body: any }>;
  };
  appId: string;
  walletAddress: string;
  subject?: string;
  origin?: string;
  redirectUri?: string;
}) {
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
  const loginRequest = await api.handle({
    method: "POST",
    url: "/v1/auth/login-requests",
    headers: {
      origin
    },
    body: {
      projectId: appId,
      redirectUri,
      codeChallenge
    }
  });

  if (loginRequest.statusCode !== 201) {
    throw new Error(`failed to create login request: ${JSON.stringify(loginRequest.body)}`);
  }

  const completed = await api.handle({
    method: "POST",
    url: "/v1/auth/token",
    body: {
      grantType: "privy_access_token",
      loginRequestId: loginRequest.body.loginRequestId,
      privyAccessToken: createPrivyTestToken({
        subject,
        walletAddress,
        chainId: "eip155:1"
      }, {
        secret: resolveTestVerifierSecret()
      })
    }
  });

  if (completed.statusCode !== 200) {
    throw new Error(`failed to complete hosted login: ${JSON.stringify(completed.body)}`);
  }

  const exchanged = await api.handle({
    method: "POST",
    url: "/v1/auth/token",
    body: {
      grantType: "authorization_code",
      code: completed.body.code,
      codeVerifier
    }
  });

  if (exchanged.statusCode !== 200) {
    throw new Error(`failed to exchange authorization code: ${JSON.stringify(exchanged.body)}`);
  }

  return exchanged.body;
}
