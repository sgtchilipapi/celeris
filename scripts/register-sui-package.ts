import { fileURLToPath } from "node:url";
import {
  parseRegisterProgramArgs,
  runRegisterProgram,
  type RegisterProgramScriptConfig
} from "./register-program.js";

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);

export type RegisterSuiPackageScriptConfig = RegisterProgramScriptConfig;

export function parseRegisterSuiPackageArgs(args: string[]): RegisterSuiPackageScriptConfig {
  return parseRegisterProgramArgs(args);
}

export async function runRegisterSuiPackage(
  config: RegisterSuiPackageScriptConfig,
  options?: { fetchImpl?: typeof fetch }
) {
  return runRegisterProgram(config, options);
}

async function main() {
  const result = await runRegisterSuiPackage(parseRegisterSuiPackageArgs(process.argv.slice(2)));
  console.log(JSON.stringify(result, null, 2));
}

if (isMainModule) {
  main().catch((error) => {
    console.error((error as Error).message);
    process.exitCode = 1;
  });
}
