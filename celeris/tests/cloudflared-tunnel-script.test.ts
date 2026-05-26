import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { buildCloudflaredTunnelCommand, parseCloudflaredTunnelArgs } from "../../scripts/cloudflared-tunnel.js";

test("cloudflared tunnel script parses token-driven public hostname config", () => {
  const config = parseCloudflaredTunnelArgs(
    ["--cloudflared-bin=.bin/cloudflared"],
    {
      CLOUDFLARED_TUNNEL_TOKEN: "token_123",
      CLOUDFLARED_AUTH_HOSTNAME: "auth.celeris.pro",
      CLOUDFLARED_DEMO_FRONTEND_HOSTNAME: "demo-frontend.celeris.pro",
      PORT: "3100",
      MOCK_GAME_FRONTEND_PORT: "3102"
    }
  );

  assert.deepEqual(config, {
    binaryPath: path.resolve("/workspaces/celeris", ".bin/cloudflared"),
    tunnelToken: "token_123",
    apiPort: 3100,
    frontendPort: 3102,
    authHostname: "auth.celeris.pro",
    demoFrontendHostname: "demo-frontend.celeris.pro"
  });
});

test("cloudflared tunnel script passes the tunnel token through environment instead of argv", () => {
  const config = parseCloudflaredTunnelArgs(
    ["--cloudflared-bin=.bin/cloudflared"],
    {
      CLOUDFLARED_TUNNEL_TOKEN: "token_456"
    }
  );

  const command = buildCloudflaredTunnelCommand(config, { HOME: "/home/codespace" } as NodeJS.ProcessEnv);

  assert.equal(command.file, path.resolve("/workspaces/celeris", ".bin/cloudflared"));
  assert.deepEqual(command.args, ["tunnel", "run"]);
  assert.equal(command.env.TUNNEL_TOKEN, "token_456");
  assert.equal(command.env.HOME, "/home/codespace");
});
