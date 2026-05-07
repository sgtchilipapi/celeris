import fsSync from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { transform } from "esbuild";
import { MockStripeGateway } from "../celeris/services/mock-stripe-gateway.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadDotEnv(path.join(projectRoot, ".env"));
loadDotEnv(path.join(projectRoot, ".env.local"));

const frontendRoot = path.join(projectRoot, "mock-game-frontend");
const browserSdkPath = path.join(projectRoot, "celeris/sdk/browser-client.ts");
const port = Number(process.env.MOCK_GAME_FRONTEND_PORT ?? 3002);
const apiOrigin = process.env.CELERIS_API_ORIGIN ?? "http://localhost:3000";
const hostedAuthOrigin = process.env.CELERIS_HOSTED_AUTH_ORIGIN ?? apiOrigin;
const defaultFrontendOrigin = `http://localhost:${port}`;
const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);
const defaultRunConfig = buildRunConfig({
  appId: "",
  appName: "Mock Game",
  apiOrigin: "/api",
  hostedAuthOrigin,
  redirectUri: `${defaultFrontendOrigin}/auth/callback`
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
        const compiled = await transform(source, {
          loader: "ts",
          format: "esm",
          target: "es2022"
        });
        res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
        res.end(compiled.code);
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
  const resolvedRequestPath = requestPath === "/auth/callback" ? "/index.html" : requestPath;
  const normalized = path.normalize(resolvedRequestPath).replace(/^(\.\.[/\\])+/, "");
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

function parseArgs(args: string[]) {
  const config = {
    appId: "",
    appName: "Mock Game",
    apiOrigin: "/api",
    hostedAuthOrigin,
    redirectUri: `${defaultFrontendOrigin}/auth/callback`
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
    if (arg.startsWith("--api-origin=")) {
      config.apiOrigin = arg.slice("--api-origin=".length);
      continue;
    }
    if (arg.startsWith("--hosted-auth-origin=")) {
      config.hostedAuthOrigin = arg.slice("--hosted-auth-origin=".length);
      continue;
    }
    if (arg.startsWith("--redirect-uri=")) {
      config.redirectUri = arg.slice("--redirect-uri=".length);
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
  apiOrigin: string;
  hostedAuthOrigin: string;
  redirectUri: string;
}) {
  return {
    appId: config.appId,
    appName: config.appName,
    apiOrigin: config.apiOrigin,
    hostedAuthOrigin: config.hostedAuthOrigin,
    redirectUri: config.redirectUri
  };
}

if (isMainModule) {
  createMockGameFrontendServer().listen(port, () => {
    console.log(`Mock game frontend listening on http://localhost:${port}`);
    console.log(`Proxying API requests to ${apiOrigin}`);
    console.log(`Configured appId: ${runConfig.appId}`);
    console.log(`Hosted auth origin: ${runConfig.hostedAuthOrigin}`);
  });
}

function loadDotEnv(filePath: string) {
  if (!fsSync.existsSync(filePath)) {
    return;
  }

  const source = fsSync.readFileSync(filePath, "utf8");
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }

    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}
