import http from "node:http";

const port = Number(process.env.MOCK_DEVELOPER_PORT ?? 3001);
const scenario = process.env.MOCK_DEVELOPER_SCENARIO ?? "approve";

const server = http.createServer(async (req, res) => {
  if (req.method !== "POST") {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }

  let body: {
    actionType?: string;
    cost?: number;
    payload?: { itemDefId?: string };
  };

  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "invalid json body" }));
    return;
  }

  if (scenario === "reject" || body.payload?.itemDefId === "reject_item") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "rejected", reason: "item rejected by developer backend" }));
    return;
  }

  res.writeHead(200, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      status: "approved",
      tx: Buffer.from(JSON.stringify({ itemDefId: body.payload?.itemDefId ?? "unknown" })).toString("base64"),
      summary: {
        actionType: body.actionType ?? "mint_item",
        itemDefId: body.payload?.itemDefId ?? "unknown",
        debit: body.cost ?? 0
      }
    })
  );
});

server.listen(port, () => {
  console.log(`Mock developer backend listening on http://localhost:${port}`);
});
