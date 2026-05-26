import crypto from "node:crypto";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { createGoogleTestIdToken } from "../../services/zklogin-auth-service.js";

export async function createHostedPlayerSession({
  api,
  appId,
  walletAddress,
  chainId = "sui:testnet",
  subject = `google-test-user:${walletAddress.toLowerCase()}`,
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
  chainId?: string;
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
      codeChallenge,
      zkLogin: {
        ephemeralPublicKey: Ed25519Keypair.generate().getPublicKey().toBase64(),
        jwtRandomness: "123456789"
      }
    }
  });

  if (loginRequest.statusCode !== 201) {
    throw new Error(`failed to create login request: ${JSON.stringify(loginRequest.body)}`);
  }

  const completed = await api.handle({
    method: "POST",
    url: "/v1/auth/token",
    body: {
      grantType: "google_identity_token",
      loginRequestId: loginRequest.body.loginRequestId,
      googleIdToken: createGoogleTestIdToken({
        subject,
        nonce:
          loginRequest.body.zkLoginNonce ??
          (() => {
            throw new Error("login request response missing zkLoginNonce");
          })(),
        audience: "google-client-dev"
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
