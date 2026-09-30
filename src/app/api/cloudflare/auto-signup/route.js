import { autoSignupAccounts } from "@/lib/cloudflare/autoSignupCloudflare";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 min max

// POST /api/cloudflare/auto-signup — streams NDJSON progress
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

  const { count, captchaApiKey } = body;

  if (!count || count < 1 || count > 10) {
    return new Response(JSON.stringify({ error: "Count must be between 1 and 10" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!captchaApiKey || typeof captchaApiKey !== "string") {
    return new Response(JSON.stringify({ error: "2captcha API key required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      try {
        const { success, failed } = await autoSignupAccounts(count, captchaApiKey, {
          onProgress: (p) => send({ type: "progress", ...p }),
        });
        send({ type: "done", success, failed, total: count });
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
