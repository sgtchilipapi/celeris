import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../mock-game-frontend");
const port = Number(process.env.MOCK_GAME_FRONTEND_PORT ?? 3002);
const apiOrigin = process.env.CELERIS_API_ORIGIN ?? "http://localhost:3000";
const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);
const runConfig = isMainModule
  ? parseArgs(process.argv.slice(2))
  : buildRunConfig({
      appId: "",
      programId: "core_gameplay",
      firstTimeClaimActionId: "first_time_claim",
      claimRewardsActionId: "claim_rewards",
      mintItemActionId: "mint_item",
      itemDefId: "iron_sword"
    });

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"]
]);

export function createMockGameFrontendServer() {
  return http.createServer(async (req, res) => {
    try {
      const method = req.method ?? "GET";
      const requestUrl = new URL(req.url ?? "/", "http://localhost");

      if (requestUrl.pathname === "/config.json") {
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(runConfig));
        return;
      }

      if (requestUrl.pathname.startsWith("/api/")) {
        await proxyApiRequest(req, res, requestUrl, method);
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

async function proxyApiRequest(req: http.IncomingMessage, res: http.ServerResponse, requestUrl: URL, method: string) {
  const targetUrl = new URL(requestUrl.pathname.replace(/^\/api/, "") + requestUrl.search, apiOrigin);
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
    programId: "core_gameplay",
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
    if (arg.startsWith("--program-id=")) {
      config.programId = arg.slice("--program-id=".length);
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

function buildRunConfig(config: {
  appId: string;
  programId: string;
  firstTimeClaimActionId: string;
  claimRewardsActionId: string;
  mintItemActionId: string;
  itemDefId: string;
}) {
  return {
    celeris: {
      appId: config.appId,
      programId: config.programId,
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
    console.log(`Configured programId: ${runConfig.celeris.programId}`);
  });
}
