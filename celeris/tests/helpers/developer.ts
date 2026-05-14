import { randomUUID } from "node:crypto";

type ApiLike = {
  handle(input: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: Record<string, unknown>;
  }): Promise<{ statusCode: number; body: any }>;
};

export async function signUpDeveloper({
  api,
  username = `developer-${randomUUID().slice(0, 8)}`,
  password = "test-password",
  developerId
}: {
  api: ApiLike;
  username?: string;
  password?: string;
  developerId?: string;
}) {
  const response = await api.handle({
    method: "POST",
    url: "/v1/developer/sign-up",
    headers: {
      "idempotency-key": `developer-sign-up-${randomUUID()}`
    },
    body: {
      username,
      password,
      developerId
    }
  });

  if (response.statusCode !== 201) {
    throw new Error(`failed to sign up developer: ${JSON.stringify(response.body)}`);
  }

  return {
    username,
    password,
    ...response.body
  };
}

export async function createDeveloperApp({
  api,
  accessToken,
  name = "Developer App",
  priceCents = 499,
  credits = 500,
  allowedChainId = "eip155:1",
  allowedFrontendOrigins,
  allowedRedirectUris
}: {
  api: ApiLike;
  accessToken: string;
  name?: string;
  priceCents?: number;
  credits?: number;
  allowedChainId?: string;
  allowedFrontendOrigins?: string[];
  allowedRedirectUris?: string[];
}) {
  const response = await api.handle({
    method: "POST",
    url: "/v1/developer/apps",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "idempotency-key": `developer-app-${randomUUID()}`
    },
    body: {
      name,
      priceCents,
      credits,
      allowedChainId,
      allowedFrontendOrigins,
      allowedRedirectUris
    }
  });

  if (response.statusCode !== 201) {
    throw new Error(`failed to create app: ${JSON.stringify(response.body)}`);
  }

  return response.body;
}

export async function configureDeveloperAction({
  api,
  accessToken,
  appId,
  actionType,
  cost,
  executionMode
}: {
  api: ApiLike;
  accessToken: string;
  appId: string;
  actionType: string;
  cost: number;
  executionMode: "managed" | "server" | "webhook";
}) {
  const response = await api.handle({
    method: "POST",
    url: `/v1/developer/apps/${appId}/actions`,
    headers: {
      authorization: `Bearer ${accessToken}`,
      "idempotency-key": `developer-action-${randomUUID()}`
    },
    body: {
      actionType,
      cost,
      executionMode
    }
  });

  if (response.statusCode !== 201) {
    throw new Error(`failed to configure action: ${JSON.stringify(response.body)}`);
  }

  return response.body;
}

export async function provisionSponsorWallet({
  api,
  accessToken,
  appId
}: {
  api: ApiLike;
  accessToken: string;
  appId: string;
}) {
  const response = await api.handle({
    method: "POST",
    url: `/v1/developer/apps/${appId}/sponsor-wallet`,
    headers: {
      authorization: `Bearer ${accessToken}`,
      "idempotency-key": `developer-sponsor-wallet-${randomUUID()}`
    }
  });

  if (response.statusCode !== 201 && response.statusCode !== 200) {
    throw new Error(`failed to provision sponsor wallet: ${JSON.stringify(response.body)}`);
  }

  return response.body;
}

export async function registerProgram({
  api,
  accessToken,
  appId,
  ...input
}: (
  | {
      api: ApiLike;
      accessToken: string;
      appId: string;
      packageId: string;
      appStateObjectId: string;
      authorityCapObjectId: string;
    }
  | {
      api: ApiLike;
      accessToken: string;
      appId: string;
      programId: string;
    }
)) {
  const response = await api.handle({
    method: "PUT",
    url: `/v1/developer/apps/${appId}/program`,
    headers: {
      authorization: `Bearer ${accessToken}`,
      "idempotency-key": `developer-program-${randomUUID()}`
    },
    body:
      "programId" in input
        ? {
            programId: input.programId
          }
        : {
            packageId: input.packageId,
            appStateObjectId: input.appStateObjectId,
            authorityCapObjectId: input.authorityCapObjectId
          }
  });

  if (response.statusCode !== 200) {
    throw new Error(`failed to register program: ${JSON.stringify(response.body)}`);
  }

  return response.body;
}
