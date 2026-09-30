import { generateAuthData, exchangeTokens } from "@/lib/oauth/providers";
import { createProviderConnection } from "@/models";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Drive Google OAuth login in a real Chromium via Playwright, capturing ?code=
// from the localhost callback redirect. Playwright (unlike puppeteer) does NOT
// set navigator.webdriver by default — the main reason Google flags automation.
// Ported from Gsuiteto9router/bot.js, rewritten for the Playwright API.
async function runGoogleLogin(context, authUrl, email, password, redirectUri) {
  const page = await context.newPage();

  // Block the localhost callback (capture code) + drop heavy assets for speed.
  await page.route("**/*", (route) => {
    const reqUrl = route.request().url();
    if (reqUrl.startsWith(redirectUri)) {
      const code = new URL(reqUrl).searchParams.get("code");
      if (code) page._authCode = code; // stash on page; checked after each step
      return route.abort();
    }
    const type = route.request().resourceType();
    if (["image", "media", "font"].includes(type)) return route.abort();
    return route.continue();
  });

  let authCode = null;
  try {
    await page.goto(authUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    authCode = page._authCode;
    if (authCode) return authCode; // already-authorized session auto-redirect

    // Email
    await page.waitForSelector("#identifierId", { state: "visible", timeout: 15000 });
    await page.type("#identifierId", email, { delay: 20 });
    await sleep(500);
    await page.keyboard.press("Enter");

    // Password — Google may briefly delay / show challenge; wait for the field.
    await sleep(2000);
    const pwdSelectors = [
      'input[type="password"][name="Passwd"]',
      'input[type="password"]',
      "#password input",
      'input[name="Passwd"]',
    ];
    let pwdField = null;
    for (const sel of pwdSelectors) {
      try {
        pwdField = await page.waitForSelector(sel, { state: "visible", timeout: 5000 });
        if (pwdField) break;
      } catch {}
    }
    if (!pwdField) throw new Error("Password field not found (Google challenge/2FA?)");

    await sleep(500);
    await pwdField.type(password, { delay: 20 });
    await sleep(500);
    await page.keyboard.press("Enter");

    // Consent: race code-capture against clicking Allow/Continue. Poll the stashed
    // code each step so an auto-approve short-circuits the consent clicks.
    const tryConsent = async () => {
      const click = (selectors) =>
        Promise.race([
          Promise.any(
            selectors.map((s) =>
              page
                .locator(s)
                .first()
                .click({ timeout: 2000 })
                .then(() => true)
                .catch(() => false)
            )
          ).catch(() => false),
          sleep(2500).then(() => false),
        ]);

      await sleep(2000);
      if (page._authCode) return;
      await click(["#gaplustosNext button", "#gaplustosNext", 'button:has-text("I understand")']);
      await sleep(1500);
      if (page._authCode) return;
      await click(['button:has-text("Sign in")', 'button:has-text("Masuk")']);
      await sleep(1500);
      if (page._authCode) return;
      await click([
        "#submit_approve_access button",
        "#submit_approve_access",
        'button:has-text("Allow")',
        'button:has-text("Continue")',
        'button:has-text("Izinkan")',
      ]);
    };

    await Promise.race([
      (async () => {
        while (!page._authCode) await sleep(200);
      })(),
      tryConsent(),
    ]);

    if (!page._authCode) {
      const start = Date.now();
      while (!page._authCode && Date.now() - start < 12000) await sleep(300);
    }
    if (!page._authCode) {
      try {
        const currentUrl = page.url();
        if (currentUrl.startsWith(redirectUri)) {
          page._authCode = new URL(currentUrl).searchParams.get("code");
        }
      } catch {}
    }
    authCode = page._authCode;
    if (!authCode) throw new Error("Auth code not captured (login failed or consent not approved)");
    return authCode;
  } finally {
    await page.close().catch(() => {});
  }
}

// Serial bulk login. onProgress({index, email, ok, error?, id?, elapsedMs}) per account.
// Reuses existing OAuth helpers — no reimplementation of authorize/exchange/save.
export async function bulkLoginAccounts(accounts, { redirectUri, onProgress }) {
  const { chromium } = await import("playwright");

  // Persistent context: survives cookies/sessions across the batch → Google trusts
  // returning sessions far more than fresh incognito, reducing "couldn't sign you in".
  const os = await import("node:os");
  const path = await import("node:path");
  const fs = await import("node:fs");
  const userDataDir = path.join(os.tmpdir(), "9router-ag-chromium-profile");
  fs.mkdirSync(userDataDir, { recursive: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-features=IsolateOrigins,site-per-process",
    ],
  });

  let success = 0;
  let failed = 0;
  try {
    for (let i = 0; i < accounts.length; i++) {
      const { email, password } = accounts[i];
      const t0 = Date.now();
      try {
        const { authUrl, codeVerifier, state } = await generateAuthData("antigravity", redirectUri);
        const code = await runGoogleLogin(context, authUrl, email, password, redirectUri);
        const tokenData = await exchangeTokens("antigravity", code, redirectUri, codeVerifier, state);
        const expiresAt = tokenData.expiresIn
          ? new Date(Date.now() + tokenData.expiresIn * 1000).toISOString()
          : null;
        const created = await createProviderConnection({
          provider: "antigravity",
          authType: "oauth",
          ...tokenData,
          expiresAt,
          testStatus: "active",
        });
        success++;
        onProgress?.({ index: i, email, ok: true, id: created.id, elapsedMs: Date.now() - t0 });
      } catch (err) {
        failed++;
        onProgress?.({ index: i, email, ok: false, error: err.message || String(err), elapsedMs: Date.now() - t0 });
      }
    }
  } finally {
    await context.close().catch(() => {});
  }
  return { success, failed };
}
