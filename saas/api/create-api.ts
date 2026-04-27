import http from "node:http";
import { AppError } from "../services/errors.js";
import type { AppMetrics, MemoryStore } from "../types.js";
import type { AuthService } from "../services/auth-service.js";
import type { AppService } from "../services/app-service.js";
import type { PaymentService } from "../services/payment-service.js";
import type { MintItemService } from "../services/mint-item-service.js";
import type { MetricsService } from "../services/metrics-service.js";

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
  authService: AuthService;
  appService: AppService;
  paymentService: PaymentService;
  mintItemService: MintItemService;
  metricsService: MetricsService;
};

type RouteContext = {
  params: Record<string, string>;
  query: Record<string, string>;
  headers: http.IncomingHttpHeaders;
  body: Record<string, unknown>;
};

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
      const normalized = result as { statusCode?: number; body?: any };
      return json(normalized.statusCode ?? 200, normalized.body ?? result);
    } catch (error) {
      if (error instanceof AppError) {
        return json(error.statusCode, { error: error.message });
      }
      return json(500, { error: "internal server error", detail: (error as Error).message });
    }
  }

  addRoute("POST", "/auth/session", ({ headers, body }) => ({
    body: services.authService.createSession({
      provider: body.provider as string | undefined,
      email: body.email as string | undefined,
      idempotencyKey: requireIdempotency(headers, body)
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
        webhookUrl: (body.webhookUrl as string | undefined) ?? null,
        idempotencyKey: requireIdempotency(headers, body)
      })
    )
  }));

  addRoute("POST", "/apps/:appId/actions", ({ params, headers, body }) => ({
    statusCode: 201,
    body: services.appService.configureAction({
      appId: params.appId,
      actionType: body.actionType as string,
      cost: body.cost as number,
      idempotencyKey: requireIdempotency(headers, body)
    })
  }));

  addRoute("GET", "/apps/:appId/setup", ({ params }) => ({
    body: services.appService.getAppSetupDetails(params.appId)
  }));

  addRoute("POST", "/checkout/session", ({ headers, body }) => ({
    statusCode: 201,
    body: services.paymentService.createCheckoutSession({
      appId: body.appId as string,
      userId: body.userId as string,
      packageId: body.packageId as string,
      successUrl: body.successUrl as string | undefined,
      cancelUrl: body.cancelUrl as string | undefined,
      idempotencyKey: requireIdempotency(headers, body)
    })
  }));

  addRoute("POST", "/webhooks/payment", ({ headers, body }) => ({
    body: services.paymentService.applyPaymentWebhook({
      payload: body as never,
      stripeSignature: typeof headers["stripe-signature"] === "string" ? headers["stripe-signature"] : undefined,
      idempotencyKey: requireIdempotency(headers, body)
    })
  }));

  addRoute("POST", "/actions/mint_item", async ({ headers, body }) => ({
    body: await services.mintItemService.execute({
      appId: body.appId as string,
      userId: body.userId as string,
      payload: body.payload as { itemDefId: string },
      idempotencyKey: requireIdempotency(headers, body)
    })
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
        userId: balance.userId,
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
