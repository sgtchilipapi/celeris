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
  programId: string;
};

export function parseRegisterProgramArgs(args: string[]): RegisterProgramScriptConfig {
  const config: RegisterProgramScriptConfig = {
    apiOrigin: process.env.CELERIS_API_ORIGIN ?? "http://localhost:3000",
    appId: "",
    programId: "",
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
    if (arg.startsWith("--program-id=")) {
      config.programId = arg.slice("--program-id=".length);
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
  if (!config.programId) {
    throw new Error("provide --program-id");
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
    programId: config.programId,
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
