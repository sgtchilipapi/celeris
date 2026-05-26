import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuildBuild } from "esbuild";
import { AppError } from "../services/errors.js";
import type { AppMetrics, MemoryStore, PlatformZkLoginConfig, PlayerTransactionFeedItem, TransactionRecord } from "../types.js";
import type { AppService } from "../services/app-service.js";
import type { PaymentService } from "../services/payment-service.js";
import type { MintItemService } from "../services/mint-item-service.js";
import type { MetricsService } from "../services/metrics-service.js";
import type { ClaimRewardsService } from "../services/claim-rewards-service.js";
import type { ManagedActionService } from "../services/managed-action-service.js";
import type { AuthGatewayService } from "../services/auth-gateway-service.js";
import type { PlayerSessionService } from "../services/player-session-service.js";
import type { DeveloperSessionService } from "../services/developer-session-service.js";
import type { SayHelloService } from "../services/say-hello-service.js";
import type { ZkLoginAuthService } from "../services/zklogin-auth-service.js";
import { createGoogleTestIdToken } from "../services/zklogin-auth-service.js";

function json(statusCode: number, body: any) {
  return { statusCode, headers: { "content-type": "application/json" }, body };
}

function parsePath(pattern: string, path: string): Record<string, string> | null {
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = path.split("/").filter(Boolean);
  if (patternParts.length !== pathParts.length) {
    return null;
  }
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i += 1) {
    const part = patternParts[i];
    const current = pathParts[i];
    if (part.startsWith(":")) {
      params[part.slice(1)] = current;
      continue;
    }
    if (part !== current) {
      return null;
    }
  }
  return params;
}

type Services = {
  store: MemoryStore;
  platformZkLoginConfig: PlatformZkLoginConfig;
  hostedAuthConfig: { hostedAuthOrigin: string };
  zkLoginAuthService: ZkLoginAuthService;
  authGatewayService: AuthGatewayService;
  playerSessionService: PlayerSessionService;
  developerSessionService: DeveloperSessionService;
  appService: AppService;
  paymentService: PaymentService;
  claimRewardsService: ClaimRewardsService;
  mintItemService: MintItemService;
  metricsService: MetricsService;
  managedActionService: ManagedActionService;
  sayHelloService: SayHelloService;
};

type RouteContext = {
  params: Record<string, string>;
  query: Record<string, string>;
  headers: http.IncomingHttpHeaders;
  body: Record<string, unknown>;
};

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../web");
const hostedAuthClientEntry = path.join(webRoot, "hosted-auth-client.ts");
let hostedAuthClientBundlePromise: Promise<Buffer> | null = null;

export function createApi(services: Services) {
  const routes: Array<{ method: string; pattern: string; handler: (ctx: RouteContext) => Promise<unknown> | unknown }> = [];

  function addRoute(method: string, pattern: string, handler: (ctx: RouteContext) => Promise<unknown> | unknown) {
    routes.push({ method, pattern, handler });
  }

  async function handle({
    method,
    url,
    headers = {},
    body = {}
  }: {
    method: string;
    url: string;
    headers?: http.IncomingHttpHeaders;
    body?: Record<string, unknown>;
  }): Promise<{ statusCode: number; headers: { "content-type": string }; body: any }> {
    const { pathname, searchParams } = new URL(url, "http://localhost");
    if (method === "GET" && pathname === "/auth/login") {
      return serveHostedLoginPage(services, typeof searchParams.get("loginRequestId") === "string" ? searchParams.get("loginRequestId")! : "");
    }
    if (method === "GET" && pathname === "/auth/google/callback") {
      return serveHostedGoogleCallbackPage();
    }
    if (method === "GET" && pathname === "/auth/client.js") {
      return serveHostedAuthClientBundle();
    }
    if (method === "GET") {
      const staticResponse = await tryServeWebAsset(pathname);
      if (staticResponse) {
        return staticResponse;
      }
    }
    const route = routes.find((candidate) => candidate.method === method && parsePath(candidate.pattern, pathname));
    if (!route) {
      return json(404, { error: "not found" });
    }
    const params = parsePath(route.pattern, pathname)!;
    try {
      const result = await route.handler({
        params,
        query: Object.fromEntries(searchParams.entries()),
        headers,
        body
      });
      const normalized = result as { statusCode?: number; headers?: { "content-type": string }; body?: any };
      if (normalized?.headers) {
        return {
          statusCode: normalized.statusCode ?? 200,
          headers: normalized.headers,
          body: normalized.body
        };
      }
      return json(normalized.statusCode ?? 200, normalized.body ?? result);
    } catch (error) {
      if (error instanceof AppError) {
        return json(error.statusCode, {
          error: error.message,
          ...(error.details ? { details: error.details } : {})
        });
      }
      return json(500, { error: "internal server error", detail: (error as Error).message });
    }
  }

  addRoute("GET", "/v1/me", ({ headers, body }) => ({
    body: requireAuthenticatedWalletPrincipal(services, headers, body)
  }));

  addRoute("POST", "/v1/auth/login-requests", async ({ headers, body }) => ({
    statusCode: 201,
    body: await services.authGatewayService.createLoginRequest({
      projectId: body.projectId as string,
      origin: requireOrigin(headers),
      redirectUri: body.redirectUri as string,
      codeChallenge: body.codeChallenge as string,
      zkLogin: {
        ephemeralPublicKey: (body.zkLogin as Record<string, unknown> | undefined)?.ephemeralPublicKey as string,
        jwtRandomness: (body.zkLogin as Record<string, unknown> | undefined)?.jwtRandomness as string
      }
    })
  }));

  addRoute("POST", "/v1/auth/token", ({ body }) => {
    if (body.grantType === "authorization_code") {
      return {
        body: services.authGatewayService.exchangeAuthorizationCode(body.code as string, body.codeVerifier as string)
      };
    }

    if (body.grantType === "google_identity_token") {
      return services.authGatewayService.completeHostedLoginWithGoogleIdToken({
        loginRequestId: body.loginRequestId as string,
        googleIdToken: body.googleIdToken as string
      });
    }

    throw new AppError(400, "unsupported grantType");
  });

  if (isTestAuthMockEnabled()) {
    addRoute("POST", "/v1/auth/google/dev-token", ({ body }) => {
      const loginRequest = services.authGatewayService.getLoginRequest(body.loginRequestId as string);
      return {
        body: {
          googleIdToken: createGoogleTestIdToken({
            subject: (body.subject as string | undefined) ?? "google-dev-user",
            email: (body.email as string | undefined) ?? "player@example.com",
            nonce: loginRequest.zkLoginNonce,
            audience: services.platformZkLoginConfig.googleClientId,
            issuer: services.platformZkLoginConfig.googleIssuer
          })
        }
      };
    });
  }

  addRoute("GET", "/v1/apps/:appId/me/credits", ({ params, headers, body }) => {
    const player = requireAuthenticatedPlayer(services, headers, body, params.appId);
    const balance = services.store.getBalance(player.walletPrincipal, params.appId);

    return {
      body: {
        appId: params.appId,
        walletAddress: player.walletPrincipal.walletAddress,
        chainId: player.walletPrincipal.chainId,
        balance: balance.balance,
        reserved: balance.reserved,
        updatedAt: balance.updatedAt
      }
    };
  });

  addRoute("GET", "/v1/apps/:appId/me/asset-history", ({ params, headers, body }) => {
    const player = requireAuthenticatedPlayer(services, headers, body, params.appId);

    return {
      body: {
        appId: params.appId,
        walletAddress: player.walletPrincipal.walletAddress,
        chainId: player.walletPrincipal.chainId,
        deliveries: [...services.store.assetDeliveries.values()]
          .filter(
            (delivery) =>
              delivery.appId === params.appId &&
              delivery.walletAddress === player.walletPrincipal.walletAddress &&
              delivery.chainId === player.walletPrincipal.chainId
          )
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      }
    };
  });

  addRoute("GET", "/v1/apps/:appId/catalog", ({ params, headers, body }) => {
    requireAuthenticatedPlayer(services, headers, body, params.appId);
    const app = services.store.apps.get(params.appId);
    if (!app) {
      throw new AppError(404, "app not found");
    }
    const playerPolicy = services.store.appPlayerPolicies.get(params.appId);
    if (!playerPolicy) {
      throw new AppError(404, "app player policy not found");
    }

    return {
      body: {
        appId: app.appId,
        name: app.name,
        playerPolicy,
        registeredProgram: services.store.getRegisteredProgram(params.appId),
        creditPackages: [...services.store.creditPackages.values()].filter((pkg) => pkg.appId === params.appId),
        actions: [...services.store.actionTypes.values()].filter((action) => action.appId === params.appId)
      }
    };
  });

  addRoute("GET", "/v1/apps/:appId/transactions", ({ params, headers, body }) => {
    requireAuthenticatedPlayer(services, headers, body, params.appId);
    return {
      body: [...services.store.transactions.values()]
        .filter((tx) => tx.appId === params.appId)
        .sort((left, right) => {
          const leftTime =
            left.summary.actionType === "say_hello" ? left.summary.submittedAt : left.createdAt;
          const rightTime =
            right.summary.actionType === "say_hello" ? right.summary.submittedAt : right.createdAt;
          return rightTime.localeCompare(leftTime);
        })
        .map(projectPlayerTransactionFeedItem)
    };
  });

  addRoute("POST", "/v1/developer/sign-up", ({ headers, body }) => {
    const developer = services.appService.signUpDeveloper({
      username: body.username as string,
      password: body.password as string,
      developerId: body.developerId as string | undefined,
      idempotencyKey: requireIdempotency(headers, body)
    });
    const session = services.developerSessionService.createDeveloperSession({
      developerId: developer.developerId
    });
    return {
      statusCode: 201,
      body: {
        ...developer,
        ...session
      }
    };
  });

  addRoute("POST", "/v1/developer/sign-in", ({ body }) => {
    const developer = services.appService.signInDeveloper({
      username: body.username as string,
      password: body.password as string
    });
    const session = services.developerSessionService.createDeveloperSession({
      developerId: developer.developerId
    });
    return {
      body: {
        ...developer,
        ...session
      }
    };
  });

  addRoute("GET", "/v1/developer/apps", ({ headers }) => {
    const developer = requireAuthenticatedDeveloper(services, headers);
    return {
      body: services.appService.listApps(developer.developerId)
    };
  });

  addRoute("POST", "/v1/developer/apps", ({ headers, body }) => {
    const developer = requireAuthenticatedDeveloper(services, headers);
    return {
      statusCode: 201,
      body: services.appService.toCreateAppResponse(
        services.appService.createApp({
          developerId: developer.developerId,
          name: body.name as string,
          priceCents: body.priceCents as number,
          credits: body.credits as number,
          allowedChainId: body.allowedChainId as string,
          allowedFrontendOrigins: body.allowedFrontendOrigins as string[] | undefined,
          allowedRedirectUris: body.allowedRedirectUris as string[] | undefined,
          idempotencyKey: requireIdempotency(headers, body)
        })
      )
    };
  });

  addRoute("GET", "/v1/developer/apps/:appId", ({ params, headers }) => {
    const developer = requireAuthenticatedDeveloper(services, headers);
    services.appService.requireDeveloperOwnsApp(developer.developerId, params.appId);
    return {
      body: services.appService.getAppSetupDetails(params.appId)
    };
  });

  addRoute("PUT", "/v1/developer/apps/:appId/program", ({ params, headers, body }) => {
    const developer = requireAuthenticatedDeveloper(services, headers);
    services.appService.requireDeveloperOwnsApp(developer.developerId, params.appId);
    return {
      body: services.appService.registerProgram({
        appId: params.appId,
        packageId: body.packageId as string,
        appStateObjectId: body.appStateObjectId as string,
        authorityCapObjectId: body.authorityCapObjectId as string,
        idempotencyKey: requireIdempotency(headers, body)
      })
    };
  });

  addRoute("GET", "/v1/developer/apps/:appId/program", ({ params, headers }) => {
    const developer = requireAuthenticatedDeveloper(services, headers);
    services.appService.requireDeveloperOwnsApp(developer.developerId, params.appId);
    return {
      body: services.appService.getProgram(params.appId)
    };
  });

  addRoute("POST", "/v1/developer/apps/:appId/sponsor-wallet", ({ params, headers, body }) => {
    const developer = requireAuthenticatedDeveloper(services, headers);
    services.appService.requireDeveloperOwnsApp(developer.developerId, params.appId);
    const result = services.appService.provisionSponsorWallet({
      appId: params.appId,
      idempotencyKey: requireIdempotency(headers, body)
    });
    return {
      statusCode: result.created ? 201 : 200,
      body: result.sponsorWallet
    };
  });

  addRoute("GET", "/v1/developer/apps/:appId/sponsor-wallet", ({ params, headers }) => {
    const developer = requireAuthenticatedDeveloper(services, headers);
    services.appService.requireDeveloperOwnsApp(developer.developerId, params.appId);
    return {
      body: services.appService.getSponsorWallet(params.appId)
    };
  });

  addRoute("PUT", "/v1/developer/apps/:appId", ({ params, headers, body }) => {
    const developer = requireAuthenticatedDeveloper(services, headers);
    services.appService.requireDeveloperOwnsApp(developer.developerId, params.appId);
    return {
      body: services.appService.toCreateAppResponse(
        services.appService.updateApp({
          appId: params.appId,
          name: body.name as string,
          priceCents: body.priceCents as number,
          credits: body.credits as number,
          allowedChainId: body.allowedChainId as string,
          allowedFrontendOrigins: body.allowedFrontendOrigins as string[] | undefined,
          allowedRedirectUris: body.allowedRedirectUris as string[] | undefined,
          idempotencyKey: requireIdempotency(headers, body)
        })
      )
    };
  });

  addRoute("DELETE", "/v1/developer/apps/:appId", ({ params, headers, body }) => {
    const developer = requireAuthenticatedDeveloper(services, headers);
    services.appService.requireDeveloperOwnsApp(developer.developerId, params.appId);
    return {
      body: {
        deleted: services.appService.deleteApp({
          appId: params.appId,
          idempotencyKey: requireIdempotency(headers, body)
        })
      }
    };
  });

  addRoute("POST", "/v1/developer/apps/:appId/actions", ({ params, headers, body }) => {
    const developer = requireAuthenticatedDeveloper(services, headers);
    services.appService.requireDeveloperOwnsApp(developer.developerId, params.appId);
    return {
      statusCode: 201,
      body: services.appService.configureAction({
        appId: params.appId,
        actionType: body.actionType as string,
        cost: body.cost as number,
        executionMode: body.executionMode as "managed" | "server" | "webhook",
        idempotencyKey: requireIdempotency(headers, body)
      })
    };
  });

  addRoute("PUT", "/v1/developer/apps/:appId/actions/:actionType", ({ params, headers, body }) => {
    const developer = requireAuthenticatedDeveloper(services, headers);
    services.appService.requireDeveloperOwnsApp(developer.developerId, params.appId);
    return {
      body: services.appService.updateAction({
        appId: params.appId,
        currentActionType: decodeURIComponent(params.actionType),
        nextActionType: (body.actionType as string | undefined) ?? decodeURIComponent(params.actionType),
        cost: body.cost as number,
        executionMode: body.executionMode as "managed" | "server" | "webhook",
        idempotencyKey: requireIdempotency(headers, body)
      })
    };
  });

  addRoute("DELETE", "/v1/developer/apps/:appId/actions/:actionType", ({ params, headers, body }) => {
    const developer = requireAuthenticatedDeveloper(services, headers);
    services.appService.requireDeveloperOwnsApp(developer.developerId, params.appId);
    return {
      body: {
        deleted: services.appService.deleteAction({
          appId: params.appId,
          actionType: decodeURIComponent(params.actionType),
          idempotencyKey: requireIdempotency(headers, body)
        })
      }
    };
  });

  addRoute("POST", "/v1/apps/:appId/checkout-sessions", async ({ params, headers, body }) => ({
    statusCode: 201,
    body: await services.paymentService.createCheckoutSession({
      appId: params.appId,
      walletPrincipal: requireAuthenticatedPlayer(services, headers, body, params.appId).walletPrincipal,
      packageId: body.packageId as string,
      successUrl: body.successUrl as string | undefined,
      cancelUrl: body.cancelUrl as string | undefined,
      idempotencyKey: requireIdempotency(headers, body)
    })
  }));

  addRoute("POST", "/v1/webhooks/stripe", ({ headers, body }) => ({
    body: services.paymentService.applyPaymentWebhook({
      payload: body as never,
      stripeSignature: typeof headers["stripe-signature"] === "string" ? headers["stripe-signature"] : undefined,
      idempotencyKey: requireIdempotency(headers, body)
    })
  }));

  addRoute("POST", "/v1/apps/:appId/actions/:actionId/execute", async ({ params, headers, body }) => {
    const authenticated = requireAuthenticatedPlayer(services, headers, body, params.appId);
    const idempotencyKey = requireIdempotency(headers, body);

    if (params.actionId === "mint_item") {
      return {
        body: await services.mintItemService.execute({
          appId: params.appId,
          walletPrincipal: authenticated.walletPrincipal,
          payload: body.payload as { itemDefId: string },
          idempotencyKey
        })
      };
    }

    if (params.actionId === "claim_rewards" || params.actionId === "first_time_claim") {
      return {
        body: services.claimRewardsService.execute({
          appId: params.appId,
          walletPrincipal: authenticated.walletPrincipal,
          actionId: params.actionId,
          idempotencyKey
        })
      };
    }

    if (params.actionId === "say_hello") {
      const sayHelloPayload =
        typeof body.payload === "object" && body.payload && !Array.isArray(body.payload)
          ? (body.payload as Record<string, unknown>)
          : body;
      return {
        body: await services.sayHelloService.execute({
          appId: params.appId,
          walletPrincipal: authenticated.walletPrincipal,
          payload: sayHelloPayload,
          idempotencyKey
        })
      };
    }

    throw new AppError(404, "action not supported");
  });

  addRoute("POST", "/v1/apps/:appId/actions/say_hello/complete", async ({ params, headers, body }) => {
    const authenticated = requireAuthenticatedPlayer(services, headers, body, params.appId);
    return {
      body: await services.sayHelloService.complete({
        appId: params.appId,
        walletPrincipal: authenticated.walletPrincipal,
        reservationId: body.reservationId as string,
        outcome: body.outcome as "submitted" | "failed",
        digest: body.digest as string | undefined,
        idempotencyKey: requireIdempotency(headers, body)
      })
    };
  });

  addRoute("GET", "/v1/developer/apps/:appId/metrics", ({ params, headers }) => {
    const developer = requireAuthenticatedDeveloper(services, headers);
    services.appService.requireDeveloperOwnsApp(developer.developerId, params.appId);
    return {
      body: services.metricsService.getAppMetrics(params.appId) as AppMetrics
    };
  });

  addRoute("GET", "/v1/developer/apps/:appId/transactions", ({ params, headers }) => {
    const developer = requireAuthenticatedDeveloper(services, headers);
    services.appService.requireDeveloperOwnsApp(developer.developerId, params.appId);
    return {
      body: [...services.store.transactions.values()].filter((tx) => tx.appId === params.appId)
    };
  });

  addRoute("GET", "/v1/developer/apps/:appId/players", ({ params, headers }) => {
    const developer = requireAuthenticatedDeveloper(services, headers);
    services.appService.requireDeveloperOwnsApp(developer.developerId, params.appId);
    return {
      body: [...services.store.creditBalances.values()]
      .filter((balance) => balance.appId === params.appId)
      .map((balance) => ({
        walletAddress: balance.walletAddress,
        chainId: balance.chainId,
        appId: balance.appId,
        balance: balance.balance,
        reserved: balance.reserved
      }))
    };
  });

  function createNodeServer() {
    return http.createServer(async (req, res) => {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(chunk as Buffer);
        }
        const rawBody = chunks.length ? Buffer.concat(chunks).toString("utf8") : "";
        let body: Record<string, unknown> = {};
        if (rawBody) {
          try {
            body = JSON.parse(rawBody) as Record<string, unknown>;
          } catch {
            res.writeHead(400, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: "invalid json body" }));
            return;
          }
        }
        const response = await handle({
          method: req.method ?? "GET",
          url: req.url ?? "/",
          headers: req.headers,
          body
        });
        res.writeHead(response.statusCode, response.headers);
        if (Buffer.isBuffer(response.body) || typeof response.body === "string") {
          res.end(response.body);
          return;
        }
        res.end(JSON.stringify(response.body));
      } catch (error) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "internal server error", detail: (error as Error).message }));
      }
    });
  }

  return { handle, createNodeServer };
}

function projectPlayerTransactionFeedItem(record: TransactionRecord): PlayerTransactionFeedItem {
  return {
    transactionId: record.txId,
    actionId: record.summary.actionType,
    digest: record.summary.actionType === "say_hello" ? record.summary.digest : record.providerTxId,
    providerTxId: record.providerTxId || null,
    explorerUrl: record.explorerUrl ?? null,
    walletAddress: record.walletAddress,
    username: record.summary.actionType === "say_hello" ? record.summary.username : null,
    message: record.summary.actionType === "say_hello" ? record.summary.message : null,
    status: record.status,
    submittedAt: record.summary.actionType === "say_hello" ? record.summary.submittedAt : record.createdAt,
    confirmedAt: record.confirmedAt ?? null
  };
}

function requireIdempotency(headers: http.IncomingHttpHeaders, body: Record<string, unknown>) {
  const key = headers["idempotency-key"] ?? body.idempotencyKey;
  if (typeof key !== "string" || !key) {
    throw new AppError(400, "idempotency key required");
  }
  return key;
}

function requireAuthenticatedPlayer(
  services: Services,
  headers: http.IncomingHttpHeaders,
  body: Record<string, unknown>,
  appId?: string
) {
  rejectPlayerIdentityInput(body);
  const authorization = headers.authorization;
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) {
    throw new AppError(401, "authorization token required");
  }

  const token = authorization.slice("Bearer ".length).trim();
  const allowedChainId = appId ? services.store.appPlayerPolicies.get(appId)?.allowedChainId : undefined;
  if (appId && !services.store.apps.has(appId)) {
    throw new AppError(404, "app not found");
  }
  if (appId && !allowedChainId) {
    throw new AppError(404, "app player policy not found");
  }

  return services.playerSessionService.authenticatePlayerSessionToken(token, { projectId: appId, allowedChainId });
}

function requireAuthenticatedWalletPrincipal(
  services: Services,
  headers: http.IncomingHttpHeaders,
  body: Record<string, unknown>
) {
  return requireAuthenticatedPlayer(services, headers, body).walletPrincipal;
}

function requireAuthenticatedDeveloper(services: Services, headers: http.IncomingHttpHeaders) {
  const authorization = headers.authorization;
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) {
    throw new AppError(401, "authorization token required");
  }

  const token = authorization.slice("Bearer ".length).trim();
  return services.developerSessionService.authenticateDeveloperSessionToken(token);
}

function rejectPlayerIdentityInput(body: Record<string, unknown>) {
  if (typeof body.userId === "string" || typeof body.walletAddress === "string" || typeof body.chainId === "string") {
    throw new AppError(400, "player identity must come from the authenticated session");
  }
}

function requireOrigin(headers: http.IncomingHttpHeaders) {
  const origin = headers.origin;
  if (typeof origin !== "string" || !origin) {
    throw new AppError(400, "origin header required");
  }
  return origin;
}

async function tryServeWebAsset(pathname: string) {
  if (pathname === "/" || pathname === "/index.html" || pathname === "/dashboard" || pathname === "/dashboard/") {
    return serveFile(path.join(webRoot, "index.html"), "text/html; charset=utf-8");
  }
  if (pathname === "/app.js" || pathname === "/dashboard/app.js") {
    return serveFile(path.join(webRoot, "app.js"), "text/javascript; charset=utf-8");
  }
  if (pathname === "/styles.css" || pathname === "/dashboard/styles.css") {
    return serveFile(path.join(webRoot, "styles.css"), "text/css; charset=utf-8");
  }
  return null;
}

async function serveFile(filePath: string, contentType: string) {
  try {
    const body = await fs.readFile(filePath);
    return {
      statusCode: 200,
      headers: {
        "content-type": contentType,
        "cache-control": "no-store"
      },
      body
    };
  } catch {
    return {
      statusCode: 404,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: "not found" })
    };
  }
}

function serveHostedLoginPage(services: Services, loginRequestId: string) {
  if (!loginRequestId) {
    return json(400, { error: "loginRequestId is required" });
  }

  const loginRequest = services.authGatewayService.getLoginRequest(loginRequestId);
  const playerPolicy = services.store.appPlayerPolicies.get(loginRequest.projectId);
  if (!playerPolicy) {
    return json(404, { error: "app player policy not found" });
  }

  const body = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Celeris Login</title>
    <style>
      body { font-family: sans-serif; background: #f6efe4; color: #1f1a14; margin: 0; min-height: 100vh; display: grid; place-items: center; }
      main { width: min(420px, calc(100vw - 32px)); background: white; border-radius: 20px; padding: 24px; box-shadow: 0 20px 60px rgba(58, 39, 21, 0.15); }
      h1 { margin: 0 0 8px; font-size: 1.8rem; }
      p { margin: 0 0 16px; line-height: 1.5; }
      button { width: 100%; border: 0; border-radius: 999px; padding: 12px 16px; font: inherit; font-weight: 700; color: white; background: #b85c38; cursor: pointer; }
      button[disabled] { cursor: wait; opacity: 0.7; }
      .feedback { margin-top: 12px; min-height: 1.25rem; color: #8a2d17; }
      .eyebrow { display: inline-flex; margin-bottom: 12px; padding: 6px 10px; border-radius: 999px; background: #f6efe4; color: #8a4f26; font-size: 0.78rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
      .helper { color: #594736; font-size: 0.95rem; }
    </style>
  </head>
  <body>
    <main>
      <span class="eyebrow">Celeris Hosted Auth</span>
      <h1>Celeris Hosted Login</h1>
      <p>Sign up or sign in with Google on the Celeris auth origin. Celeris verifies the Google identity token, derives the zkLogin Sui wallet address, and returns only a Celeris auth code and player session.</p>
      <p class="helper">The browser keeps zkLogin ephemeral secret material in session-scoped storage only and never sends raw Google credentials to player routes.</p>
      <button id="login-button" type="button">Continue with Google</button>
      <p id="feedback" class="feedback"></p>
    </main>
    <script>
      window.CELERIS_HOSTED_AUTH_CONFIG = ${JSON.stringify({
        loginRequestId,
        googleClientId: services.platformZkLoginConfig.googleClientId,
        googleIssuer: services.platformZkLoginConfig.googleIssuer,
        googleAuthorizeUrl: services.platformZkLoginConfig.googleAuthorizeUrl,
        zkLoginNonce: loginRequest.zkLoginNonce,
        zkLoginMaxEpoch: loginRequest.zkLoginMaxEpoch,
        hostedAuthOrigin: services.hostedAuthConfig.hostedAuthOrigin,
        authApiBaseUrl: services.hostedAuthConfig.hostedAuthOrigin,
        googleCallbackUrl: new URL("/auth/google/callback", services.hostedAuthConfig.hostedAuthOrigin).toString(),
        allowedChainId: playerPolicy.allowedChainId
      })};
    </script>
    <script src="/auth/client.js"></script>
  </body>
</html>`;

  return {
    statusCode: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
    body
  };
}

function serveHostedGoogleCallbackPage() {
  const body = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Celeris Login Callback</title>
  </head>
  <body>
    <main>
      <p id="feedback">Completing Google sign-in...</p>
      <button id="login-button" type="button" hidden>Continue with Google</button>
    </main>
    <script src="/auth/client.js"></script>
  </body>
</html>`;

  return {
    statusCode: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
    body
  };
}

async function serveHostedAuthClientBundle() {
  const body = await getHostedAuthClientBundle();
  return {
    statusCode: 200,
    headers: {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "no-store"
    },
    body
  };
}

async function getHostedAuthClientBundle() {
  if (!hostedAuthClientBundlePromise) {
    hostedAuthClientBundlePromise = esbuildBuild({
      entryPoints: [hostedAuthClientEntry],
      bundle: true,
      write: false,
      platform: "browser",
      format: "iife",
      target: "es2022",
      logLevel: "silent"
    })
      .then((result) => {
        const output = result.outputFiles.find((file) => file.path.endsWith(".js")) ?? result.outputFiles[0];
        return Buffer.from(output.text, "utf8");
      })
      .catch((error) => {
        hostedAuthClientBundlePromise = null;
        throw error;
      });
  }

  return hostedAuthClientBundlePromise;
}

function isTestAuthMockEnabled() {
  return (
    process.env.CELERIS_ENABLE_TEST_AUTH_MOCKS === "true" ||
    process.env.NODE_ENV === "test" ||
    Boolean(process.env.NODE_TEST_CONTEXT) ||
    process.execArgv.includes("--test") ||
    process.argv.includes("--test")
  );
}
