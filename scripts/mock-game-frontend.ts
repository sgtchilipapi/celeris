import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPrivyTestToken } from "../celeris/services/privy-auth-service.js";
import { MockStripeGateway } from "../celeris/services/mock-stripe-gateway.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontendRoot = path.join(projectRoot, "mock-game-frontend");
const browserSdkPath = path.join(projectRoot, "celeris/sdk/browser-client.ts");
const port = Number(process.env.MOCK_GAME_FRONTEND_PORT ?? 3002);
const apiOrigin = process.env.CELERIS_API_ORIGIN ?? "http://localhost:3000";
const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);
const defaultRunConfig = buildRunConfig({
  appId: "",
  appName: "Mock Game",
  programId: "core_gameplay",
  privyAppId: "cl-dev-privy-app",
  allowedChainId: "eip155:1",
  firstTimeClaimActionId: "first_time_claim",
  claimRewardsActionId: "claim_rewards",
  mintItemActionId: "mint_item",
  itemDefId: "iron_sword"
});
const runConfig = isMainModule ? parseArgs(process.argv.slice(2)) : defaultRunConfig;

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".ts", "text/javascript; charset=utf-8"]
]);

export function createMockGameFrontendServer({
  config = runConfig,
  upstreamApiOrigin = apiOrigin
}: {
  config?: ReturnType<typeof buildRunConfig>;
  upstreamApiOrigin?: string;
} = {}) {
  const stripeGateway = new MockStripeGateway();

  return http.createServer(async (req, res) => {
    try {
      const method = req.method ?? "GET";
      const requestUrl = new URL(req.url ?? "/", "http://localhost");

      if (requestUrl.pathname === "/config.json") {
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(config));
        return;
      }

      if (requestUrl.pathname === "/sdk/browser-client.ts") {
        const source = await fs.readFile(browserSdkPath, "utf8");
        res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
        res.end(source);
        return;
      }

      if (requestUrl.pathname === "/privy/mock-token") {
        if (method !== "POST") {
          res.writeHead(405, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "method not allowed" }));
          return;
        }

        const payload = await readJsonBody(req);
        const walletAddress = typeof payload.walletAddress === "string" ? payload.walletAddress.trim().toLowerCase() : "";
        if (!walletAddress) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "walletAddress is required" }));
          return;
        }

        const token = createPrivyTestToken(
          {
            walletAddress,
            chainId: config.celeris.auth.allowedChainId
          },
          {
            secret: process.env.PRIVY_VERIFIER_SECRET ?? "privy-dev-secret"
          }
        );

        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(
          JSON.stringify({
            token,
            walletAddress,
            chainId: config.celeris.auth.allowedChainId,
            privyAppId: config.celeris.auth.privyAppId
          })
        );
        return;
      }

      if (requestUrl.pathname === "/mock-checkout") {
        await completeMockCheckout({
          res,
          requestUrl,
          upstreamApiOrigin,
          webhookSecret: stripeGateway.webhookSecret
        });
        return;
      }

      if (requestUrl.pathname.startsWith("/api/")) {
        await proxyApiRequest(req, res, requestUrl, method, upstreamApiOrigin);
        return;
      }

      if (method !== "GET" && method !== "HEAD") {
        res.writeHead(405, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "method not allowed" }));
        return;
      }

      const assetPath = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
      await serveAsset(res, assetPath, method === "HEAD");
    } catch (error) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "mock game frontend failed", detail: (error as Error).message }));
    }
  });
}

async function proxyApiRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  requestUrl: URL,
  method: string,
  upstreamApiOrigin: string
) {
  const targetUrl = new URL(requestUrl.pathname.replace(/^\/api/, "") + requestUrl.search, upstreamApiOrigin);
  const body = await readBody(req);
  const headers = new Headers();

  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined || key === "host" || key === "connection" || key === "content-length") {
      continue;
    }
    if (Array.isArray(value)) {
      headers.set(key, value.join(", "));
      continue;
    }
    headers.set(key, value);
  }

  const response = await fetch(targetUrl, {
    method,
    headers,
    body: body.length > 0 && method !== "GET" && method !== "HEAD" ? body : undefined
  });

  const responseBody = Buffer.from(await response.arrayBuffer());
  const responseHeaders: Record<string, string> = {};
  for (const [key, value] of response.headers.entries()) {
    if (key === "transfer-encoding" || key === "content-encoding") {
      continue;
    }
    responseHeaders[key] = value;
  }

  res.writeHead(response.status, responseHeaders);
  res.end(responseBody);
}

async function serveAsset(res: http.ServerResponse, requestPath: string, headOnly: boolean) {
  const normalized = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, "");
  const absolutePath = path.resolve(frontendRoot, `.${normalized}`);
  if (!absolutePath.startsWith(frontendRoot)) {
    res.writeHead(403, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "forbidden" }));
    return;
  }

  try {
    const content = await fs.readFile(absolutePath);
    const contentType = contentTypes.get(path.extname(absolutePath)) ?? "application/octet-stream";
    res.writeHead(200, { "content-type": contentType });
    if (headOnly) {
      res.end();
      return;
    }
    res.end(content);
  } catch {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  }
}

async function completeMockCheckout({
  res,
  requestUrl,
  upstreamApiOrigin,
  webhookSecret
}: {
  res: http.ServerResponse;
  requestUrl: URL;
  upstreamApiOrigin: string;
  webhookSecret: string;
}) {
  const sessionId = requestUrl.searchParams.get("session_id");
  const successUrl = requestUrl.searchParams.get("success_url");
  const cancelUrl = requestUrl.searchParams.get("cancel_url");
  const appId = requestUrl.searchParams.get("app_id");
  const walletAddress = requestUrl.searchParams.get("wallet_address");
  const chainId = requestUrl.searchParams.get("chain_id");
  const credits = Number(requestUrl.searchParams.get("credits"));
  const amountCents = Number(requestUrl.searchParams.get("amount_cents"));

  if (!sessionId || !successUrl || !cancelUrl || !appId || !walletAddress || !chainId || !credits || !amountCents) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "mock checkout is missing required metadata" }));
    return;
  }

  const event = {
    id: `evt_mock_${sessionId}`,
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionId,
        amount_total: amountCents,
        metadata: {
          appId,
          walletAddress,
          chainId,
          credits
        }
      }
    }
  };

  const signature = new MockStripeGateway({ webhookSecret }).signWebhookPayload(event);
  const webhookResponse = await fetch(new URL("/v1/webhooks/stripe", upstreamApiOrigin), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": `mock-checkout:${sessionId}`,
      "stripe-signature": signature
    },
    body: JSON.stringify(event)
  });

  if (!webhookResponse.ok) {
    const payload = await webhookResponse.json().catch(() => null);
    res.writeHead(webhookResponse.status, { "content-type": "application/json" });
    res.end(JSON.stringify(payload ?? { error: "mock checkout completion failed" }));
    return;
  }

  const redirectUrl = new URL(successUrl);
  redirectUrl.searchParams.set("checkout", "success");
  redirectUrl.searchParams.set("session_id", sessionId);
  res.writeHead(302, { location: redirectUrl.toString() });
  res.end();
}

async function readBody(req: http.IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

async function readJsonBody(req: http.IncomingMessage) {
  const body = await readBody(req);
  if (!body.length) {
    return {};
  }
  try {
    return JSON.parse(body.toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new Error("invalid json body");
  }
}

function parseArgs(args: string[]) {
  const config = {
    appId: "",
    appName: "Mock Game",
    programId: "core_gameplay",
    privyAppId: "cl-dev-privy-app",
    allowedChainId: "eip155:1",
    firstTimeClaimActionId: "first_time_claim",
    claimRewardsActionId: "claim_rewards",
    mintItemActionId: "mint_item",
    itemDefId: "iron_sword"
  };

  for (const arg of args) {
    if (arg.startsWith("--app-id=")) {
      config.appId = arg.slice("--app-id=".length);
      continue;
    }
    if (arg.startsWith("--app-name=")) {
      config.appName = arg.slice("--app-name=".length);
      continue;
    }
    if (arg.startsWith("--program-id=")) {
      config.programId = arg.slice("--program-id=".length);
      continue;
    }
    if (arg.startsWith("--privy-app-id=")) {
      config.privyAppId = arg.slice("--privy-app-id=".length);
      continue;
    }
    if (arg.startsWith("--allowed-chain-id=")) {
      config.allowedChainId = arg.slice("--allowed-chain-id=".length);
      continue;
    }
    if (arg.startsWith("--claim-rewards-action-id=")) {
      config.claimRewardsActionId = arg.slice("--claim-rewards-action-id=".length);
      continue;
    }
    if (arg.startsWith("--first-time-claim-action-id=")) {
      config.firstTimeClaimActionId = arg.slice("--first-time-claim-action-id=".length);
      continue;
    }
    if (arg.startsWith("--mint-item-action-id=")) {
      config.mintItemActionId = arg.slice("--mint-item-action-id=".length);
      continue;
    }
    if (arg.startsWith("--item-def-id=")) {
      config.itemDefId = arg.slice("--item-def-id=".length);
    }
  }

  if (!config.appId) {
    throw new Error("mock-game-frontend requires --app-id=<app-id>");
  }

  return buildRunConfig(config);
}

export function buildRunConfig(config: {
  appId: string;
  appName: string;
  programId: string;
  privyAppId: string;
  allowedChainId: string;
  firstTimeClaimActionId: string;
  claimRewardsActionId: string;
  mintItemActionId: string;
  itemDefId: string;
}) {
  return {
    celeris: {
      appId: config.appId,
      appName: config.appName,
      programId: config.programId,
      auth: {
        provider: "privy",
        privyAppId: config.privyAppId,
        allowedChainId: config.allowedChainId
      },
      actionIds: {
        firstTimeClaim: config.firstTimeClaimActionId,
        claimRewards: config.claimRewardsActionId,
        mintItem: config.mintItemActionId
      }
    },
    itemDefId: config.itemDefId
  };
}

if (isMainModule) {
  createMockGameFrontendServer().listen(port, () => {
    console.log(`Mock game frontend listening on http://localhost:${port}`);
    console.log(`Proxying API requests to ${apiOrigin}`);
    console.log(`Configured appId: ${runConfig.celeris.appId}`);
    console.log(`Configured Privy app: ${runConfig.celeris.auth.privyAppId}`);
  });
}
