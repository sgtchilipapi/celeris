import http from "node:http";
import { AppError } from "../services/errors.js";

function json(statusCode, body) {
  return { statusCode, headers: { "content-type": "application/json" }, body };
}

function parsePath(pattern, path) {
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = path.split("/").filter(Boolean);
  if (patternParts.length !== pathParts.length) {
    return null;
  }
  const params = {};
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

export function createApi(services) {
  const routes = [];

  function addRoute(method, pattern, handler) {
    routes.push({ method, pattern, handler });
  }

  async function handle({ method, url, headers = {}, body = {} }) {
    const { pathname, searchParams } = new URL(url, "http://localhost");
    const route = routes.find((candidate) => candidate.method === method && parsePath(candidate.pattern, pathname));
    if (!route) {
      return json(404, { error: "not found" });
    }
    const params = parsePath(route.pattern, pathname);
    try {
      const result = await route.handler({
        params,
        query: Object.fromEntries(searchParams.entries()),
        headers,
        body
      });
      return json(result.statusCode ?? 200, result.body ?? result);
    } catch (error) {
      if (error instanceof AppError) {
        return json(error.statusCode, { error: error.message });
      }
      return json(500, { error: "internal server error", detail: error.message });
    }
  }

  addRoute("POST", "/auth/session", async ({ headers, body }) => ({
    body: services.authService.createSession({
      provider: body.provider,
      email: body.email,
      idempotencyKey: requireIdempotency(headers, body)
    })
  }));

  addRoute("POST", "/apps", async ({ headers, body }) => ({
    statusCode: 201,
    body: services.appService.createApp({
      developerId: body.developerId,
      name: body.name,
      priceCents: body.priceCents,
      credits: body.credits,
      developerWebhookUrl: body.developerWebhookUrl,
      idempotencyKey: requireIdempotency(headers, body)
    })
  }));

  addRoute("POST", "/apps/:appId/actions", async ({ params, headers, body }) => ({
    statusCode: 201,
    body: services.appService.configureAction({
      appId: params.appId,
      actionType: body.actionType,
      cost: body.cost,
      idempotencyKey: requireIdempotency(headers, body)
    })
  }));

  addRoute("POST", "/checkout/session", async ({ headers, body }) => ({
    statusCode: 201,
    body: services.paymentService.createCheckoutSession({
      appId: body.appId,
      userId: body.userId,
      packageId: body.packageId,
      successUrl: body.successUrl,
      cancelUrl: body.cancelUrl,
      idempotencyKey: requireIdempotency(headers, body)
    })
  }));

  addRoute("POST", "/webhooks/payment", async ({ headers, body }) => ({
    body: services.paymentService.applyPaymentWebhook({
      payload: body,
      stripeSignature: headers["stripe-signature"],
      idempotencyKey: requireIdempotency(headers, body)
    })
  }));

  addRoute("POST", "/actions/mint_item", async ({ headers, body }) => ({
    body: await services.mintItemService.execute({
      appId: body.appId,
      userId: body.userId,
      payload: body.payload,
      idempotencyKey: requireIdempotency(headers, body)
    })
  }));

  addRoute("GET", "/metrics", async ({ query }) => ({
    body: services.metricsService.getAppMetrics(query.appId)
  }));

  addRoute("GET", "/transactions", async ({ query }) => ({
    body: [...services.store.transactions.values()].filter((tx) => !query.appId || tx.appId === query.appId)
  }));

  addRoute("GET", "/users", async ({ query }) => ({
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
        const chunks = [];
        for await (const chunk of req) {
          chunks.push(chunk);
        }
        const rawBody = chunks.length ? Buffer.concat(chunks).toString("utf8") : "";
        let body = {};
        if (rawBody) {
          try {
            body = JSON.parse(rawBody);
          } catch {
            res.writeHead(400, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: "invalid json body" }));
            return;
          }
        }
        const response = await handle({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body
        });
        res.writeHead(response.statusCode, response.headers);
        res.end(JSON.stringify(response.body));
      } catch (error) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "internal server error", detail: error.message }));
      }
    });
  }

  return { handle, createNodeServer };
}

function requireIdempotency(headers, body) {
  const key = headers["idempotency-key"] ?? body.idempotencyKey;
  if (!key) {
    throw new AppError(400, "idempotency key required");
  }
  return key;
}
