import { bulkRegisterAccounts } from "@/lib/cloudflare/bulkRegisterCloudflare";

export const dynamic = "force-dynamic";

// Parse "email:password" lines
function parseAccounts(body) {
  if (Array.isArray(body?.accounts)) return body.accounts;
  if (typeof body?.text === "string") {
    return body.text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => {
        const idx = line.indexOf(":");
        if (idx < 1) return null;
        return { email: line.slice(0, idx).trim(), password: line.slice(idx + 1) };
      })
      .filter(Boolean);
  }
  if (Array.isArray(body)) return body;
  return null;
}

// POST /api/cloudflare/bulk-register — streams NDJSON progress
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const accounts = parseAccounts(body);
  if (!Array.isArray(accounts) || accounts.length === 0) {
    return new Response(JSON.stringify({ error: "No accounts provided (use email:password lines)" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const invalid = accounts.find((a) => !a?.email || !a?.password);
  if (invalid) {
    return new Response(JSON.stringify({ error: "Each account needs email and password" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      try {
        const { success, failed } = await bulkRegisterAccounts(accounts, {
          onProgress: (p) => send({ type: "progress", ...p }),
        });
        send({ type: "done", success, failed, total: accounts.length });
      } catch (err) {
        send({ type: "error", error: err.message || String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
