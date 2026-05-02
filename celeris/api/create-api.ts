import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AppError } from "../services/errors.js";
import type { AppMetrics, MemoryStore } from "../types.js";
import type { AppService } from "../services/app-service.js";
import type { PaymentService } from "../services/payment-service.js";
import type { MintItemService } from "../services/mint-item-service.js";
import type { MetricsService } from "../services/metrics-service.js";
import type { ClaimRewardsService } from "../services/claim-rewards-service.js";
import type { PrivyAuthService } from "../services/privy-auth-service.js";

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
  privyAuthService: PrivyAuthService;
  appService: AppService;
  paymentService: PaymentService;
  claimRewardsService: ClaimRewardsService;
  mintItemService: MintItemService;
  metricsService: MetricsService;
};

type RouteContext = {
  params: Record<string, string>;
  query: Record<string, string>;
  headers: http.IncomingHttpHeaders;
  body: Record<string, unknown>;
};

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../web");

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

  addRoute("POST", "/developer/sign-up", ({ headers, body }) => ({
    statusCode: 201,
    body: services.appService.signUpDeveloper({
      username: body.username as string,
      password: body.password as string,
      developerId: body.developerId as string | undefined,
      idempotencyKey: requireIdempotency(headers, body)
    })
  }));

  addRoute("POST", "/developer/sign-in", ({ body }) => ({
    body: services.appService.signInDeveloper({
      username: body.username as string,
      password: body.password as string
    })
  }));

  addRoute("POST", "/apps", ({ headers, body }) => ({
    statusCode: 201,
    body: services.appService.toCreateAppResponse(
      services.appService.createApp({
        developerId: body.developerId as string,
        name: body.name as string,
        priceCents: body.priceCents as number,
        credits: body.credits as number,
        privyAppId: body.privyAppId as string,
        allowedChainId: body.allowedChainId as string,
        idempotencyKey: requireIdempotency(headers, body)
      })
    )
  }));

  addRoute("PUT", "/apps/:appId", ({ params, headers, body }) => ({
    body: services.appService.toCreateAppResponse(
      services.appService.updateApp({
        appId: params.appId,
        name: body.name as string,
        priceCents: body.priceCents as number,
        credits: body.credits as number,
        privyAppId: body.privyAppId as string,
        allowedChainId: body.allowedChainId as string,
        idempotencyKey: requireIdempotency(headers, body)
      })
    )
  }));

  addRoute("DELETE", "/apps/:appId", ({ params, headers, body }) => ({
    body: {
      deleted: services.appService.deleteApp({
        appId: params.appId,
        idempotencyKey: requireIdempotency(headers, body)
      })
    }
  }));

  addRoute("POST", "/demo/developer/session", ({ body }) => ({
    body: services.appService.createDemoDeveloperSession(
      typeof body.developerId === "string" ? body.developerId : undefined
    )
  }));

  addRoute("GET", "/apps", ({ query }) => ({
    body: services.appService.listApps(query.developerId)
  }));

  addRoute("POST", "/apps/:appId/actions", ({ params, headers, body }) => ({
    statusCode: 201,
    body: services.appService.configureAction({
      appId: params.appId,
      actionType: body.actionType as string,
      cost: body.cost as number,
      executionMode: body.executionMode as "managed" | "server" | "webhook",
      idempotencyKey: requireIdempotency(headers, body)
    })
  }));

  addRoute("PUT", "/apps/:appId/actions/:actionType", ({ params, headers, body }) => ({
    body: services.appService.updateAction({
      appId: params.appId,
      currentActionType: decodeURIComponent(params.actionType),
      nextActionType: (body.actionType as string | undefined) ?? decodeURIComponent(params.actionType),
      cost: body.cost as number,
      executionMode: body.executionMode as "managed" | "server" | "webhook",
      idempotencyKey: requireIdempotency(headers, body)
    })
  }));

  addRoute("DELETE", "/apps/:appId/actions/:actionType", ({ params, headers, body }) => ({
    body: {
      deleted: services.appService.deleteAction({
        appId: params.appId,
        actionType: decodeURIComponent(params.actionType),
        idempotencyKey: requireIdempotency(headers, body)
      })
    }
  }));

  addRoute("GET", "/apps/:appId/setup", ({ params }) => ({
    body: services.appService.getAppSetupDetails(params.appId)
  }));

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

  addRoute("POST", "/demo/checkout/complete", ({ headers, body }) => ({
    body: services.paymentService.completeDemoCheckoutSession({
      checkoutSessionId: body.checkoutSessionId as string,
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

  addRoute("POST", "/actions/mint_item", async ({ headers, body }) => ({
    body: await services.mintItemService.execute({
      appId: body.appId as string,
      userId: requireAuthenticatedPlayer(services, headers, body, body.appId as string | undefined).userId,
      payload: body.payload as { itemDefId: string },
      idempotencyKey: requireIdempotency(headers, body)
    })
  }));

  addRoute("POST", "/actions/claim_rewards", ({ headers, body }) => ({
    body: (() => {
      const requestedActionId = body.actionId ?? "claim_rewards";
      if (requestedActionId !== "claim_rewards" && requestedActionId !== "first_time_claim") {
        throw new AppError(400, "unsupported claim rewards action id");
      }

      return services.claimRewardsService.execute({
        appId: body.appId as string,
        userId: requireAuthenticatedPlayer(services, headers, body, body.appId as string | undefined).userId,
        actionId: requestedActionId,
        idempotencyKey: requireIdempotency(headers, body)
      });
    })()
  }));

  addRoute("GET", "/metrics", ({ query }) => ({
    body: services.metricsService.getAppMetrics(query.appId) as AppMetrics
  }));

  addRoute("GET", "/transactions", ({ query }) => ({
    body: [...services.store.transactions.values()].filter((tx) => !query.appId || tx.appId === query.appId)
  }));

  addRoute("GET", "/users", ({ query }) => ({
    body: [...services.store.creditBalances.values()]
      .filter((balance) => !query.appId || balance.appId === query.appId)
      .map((balance) => ({
        walletAddress: balance.walletAddress,
        chainId: balance.chainId,
        appId: balance.appId,
        balance: balance.balance,
        reserved: balance.reserved
      }))
  }));

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
  const allowedChainId = appId ? services.store.appAuthConfigs.get(appId)?.allowedChainId : undefined;
  if (appId && !services.store.apps.has(appId)) {
    throw new AppError(404, "app not found");
  }
  if (appId && !allowedChainId) {
    throw new AppError(404, "app auth config not found");
  }

  return services.privyAuthService.authenticatePlayerToken(token, { allowedChainId });
}

function requireAuthenticatedWalletPrincipal(
  services: Services,
  headers: http.IncomingHttpHeaders,
  body: Record<string, unknown>
) {
  return requireAuthenticatedPlayer(services, headers, body).walletPrincipal;
}

function rejectPlayerIdentityInput(body: Record<string, unknown>) {
  if (typeof body.userId === "string" || typeof body.walletAddress === "string" || typeof body.chainId === "string") {
    throw new AppError(400, "player identity must come from the authenticated session");
  }
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
  if (pathname === "/demo" || pathname === "/demo/") {
    return serveFile(path.join(webRoot, "demo.html"), "text/html; charset=utf-8");
  }
  if (pathname === "/demo/app.js") {
    return serveFile(path.join(webRoot, "demo-app.js"), "text/javascript; charset=utf-8");
  }
  if (pathname === "/demo/styles.css") {
    return serveFile(path.join(webRoot, "demo-styles.css"), "text/css; charset=utf-8");
  }
  return null;
}

async function serveFile(filePath: string, contentType: string) {
  try {
    const body = await fs.readFile(filePath);
    return {
      statusCode: 200,
      headers: { "content-type": contentType },
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
