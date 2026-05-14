import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createServerClient } from "../celeris/sdk/server-client.js";
import {
  normalizeApiOrigin,
  resolveDeveloperAccessToken,
  type DeveloperScriptAuth
} from "./developer-script-utils.js";

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);

export type RegisterProgramScriptConfig = DeveloperScriptAuth & {
  appId: string;
  packageId: string;
  appStateObjectId: string;
  authorityCapObjectId: string;
};

export function parseRegisterProgramArgs(args: string[]): RegisterProgramScriptConfig {
  const config: RegisterProgramScriptConfig = {
    apiOrigin: process.env.CELERIS_API_ORIGIN ?? "http://localhost:3000",
    appId: "",
    packageId: "",
    appStateObjectId: "",
    authorityCapObjectId: "",
    accessToken: null,
    username: null,
    password: null
  };

  for (const arg of args) {
    if (arg.startsWith("--api-origin=")) {
      config.apiOrigin = arg.slice("--api-origin=".length);
      continue;
    }
    if (arg.startsWith("--app-id=")) {
      config.appId = arg.slice("--app-id=".length);
      continue;
    }
    if (arg.startsWith("--package-id=")) {
      config.packageId = arg.slice("--package-id=".length);
      continue;
    }
    if (arg.startsWith("--app-state-object-id=")) {
      config.appStateObjectId = arg.slice("--app-state-object-id=".length);
      continue;
    }
    if (arg.startsWith("--authority-cap-object-id=")) {
      config.authorityCapObjectId = arg.slice("--authority-cap-object-id=".length);
      continue;
    }
    if (arg.startsWith("--access-token=")) {
      config.accessToken = arg.slice("--access-token=".length);
      continue;
    }
    if (arg.startsWith("--username=")) {
      config.username = arg.slice("--username=".length);
      continue;
    }
    if (arg.startsWith("--password=")) {
      config.password = arg.slice("--password=".length);
      continue;
    }
  }

  config.apiOrigin = normalizeApiOrigin(config.apiOrigin);
  if (!config.appId) {
    throw new Error("provide --app-id");
  }
  if (!config.packageId) {
    throw new Error("provide --package-id");
  }
  if (!config.appStateObjectId) {
    throw new Error("provide --app-state-object-id");
  }
  if (!config.authorityCapObjectId) {
    throw new Error("provide --authority-cap-object-id");
  }

  return config;
}

export async function runRegisterProgram(
  config: RegisterProgramScriptConfig,
  { fetchImpl = globalThis.fetch }: { fetchImpl?: typeof fetch } = {}
) {
  const accessToken = await resolveDeveloperAccessToken(config, { fetchImpl });
  const client = createServerClient({
    apiBaseUrl: config.apiOrigin,
    accessToken,
    fetchImpl
  });

  return client.apps.registerProgram(config.appId, {
    packageId: config.packageId,
    appStateObjectId: config.appStateObjectId,
    authorityCapObjectId: config.authorityCapObjectId,
    idempotencyKey: `script-register-program-${randomUUID()}`
  });
}

async function main() {
  const result = await runRegisterProgram(parseRegisterProgramArgs(process.argv.slice(2)));
  console.log(JSON.stringify(result, null, 2));
}

if (isMainModule) {
  main().catch((error) => {
    console.error((error as Error).message);
    process.exitCode = 1;
  });
}
