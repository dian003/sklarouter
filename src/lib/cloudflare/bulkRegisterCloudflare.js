import { chromium } from "playwright";
import { createProviderConnection } from "@/lib/db/repos/connectionsRepo";

/**
 * Detect browser executable path (not needed for playwright - uses bundled chromium)
 * Kept for API compatibility with antigravity bulkLogin
 */
export function detectBrowser() {
  return { path: "playwright-bundled", name: "Chromium" };
}

/**
 * Run Cloudflare login flow and extract account_id + create API token
 * @param {import('playwright').Browser} browser - Playwright browser instance
 * @param {string} email - Account email
 * @param {string} password - Account password
 * @returns {Promise<{accountId: string, tokenId: string, apiToken: string}>}
 */
export async function runCloudflareLogin(browser, email, password) {
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    locale: "en-US",
    timezoneId: "America/New_York",
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
    Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
    window.chrome = { runtime: {}, loadTimes: () => ({}), csi: () => ({}) };
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (p) {
      if (p === 37445) return "Intel Inc.";
      if (p === 37446) return "Intel Iris OpenGL Engine";
      return getParameter.call(this, p);
    };
  });

  const page = await context.newPage();

  try {
    // Navigate to login
    await page.goto("https://dash.cloudflare.com/login", { waitUntil: "domcontentloaded", timeout: 60000 });

    // Wait for challenge
    let challengePassed = false;
    for (let i = 0; i < 30; i++) {
      const title = await page.title();
      if (title.includes("Just a moment") || title.toLowerCase().includes("challenge")) {
        await page.waitForTimeout(2000);
        try {
          await page.waitForLoadState("networkidle", { timeout: 5000 });
        } catch {}
      } else {
        challengePassed = true;
        break;
      }
    }
    if (!challengePassed) throw new Error("Challenge timeout");

    // Wait for login form
    await page.waitForSelector('input[type="email"], input[name="email"]', { timeout: 15000 });

    // Fill credentials
    const emailSelectors = ['input[type="email"]', 'input[name="email"]'];
    let emailFilled = false;
    for (const sel of emailSelectors) {
      try {
        await page.fill(sel, email);
        emailFilled = true;
        break;
      } catch {}
    }
    if (!emailFilled) throw new Error("Email field not found");

    const passwordSelectors = ['input[type="password"]', 'input[name="password"]'];
    let passwordFilled = false;
    for (const sel of passwordSelectors) {
      try {
        await page.fill(sel, password);
        passwordFilled = true;
        break;
      } catch {}
    }
    if (!passwordFilled) throw new Error("Password field not found");

    // Wait for Turnstile
    await page.waitForTimeout(4500);

    // Check if button enabled
    const btn = await page.$('button[type="submit"]');
    if (btn) {
      const disabled = await btn.getAttribute("disabled");
      if (disabled !== null) throw new Error("Turnstile not solved");
    }

    // Click login
    const loginSelectors = ['button[type="submit"]', 'button:has-text("Log In")', 'button:has-text("Sign In")'];
    let loginClicked = false;
    for (const sel of loginSelectors) {
      try {
        await page.click(sel, { timeout: 5000 });
        loginClicked = true;
        break;
      } catch {}
    }
    if (!loginClicked) throw new Error("Login button not found");

    // Wait for dashboard
    try {
      await page.waitForSelector('div[role="main"]', { timeout: 10000 });
    } catch {
      try {
        await page.waitForURL("**/dash.cloudflare.com/**", { timeout: 10000 });
      } catch {
        throw new Error("Dashboard redirect failed");
      }
    }

    const currentUrl = page.url();
    if (currentUrl.includes("/login")) {
      const errorText = await page.$(".error-message, [data-testid='error'], .alert-danger");
      if (errorText) {
        const msg = await errorText.innerText();
        throw new Error(`Login failed: ${msg}`);
      }
      throw new Error("Still on login page - invalid credentials");
    }

    // Extract account ID
    let accountId = null;
    if (currentUrl.includes("/home") || currentUrl.endsWith("dash.cloudflare.com/")) {
      await page.goto("https://dash.cloudflare.com/", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(3000);
    }

    const parts = page.url().split("dash.cloudflare.com/");
    if (parts.length > 1) {
      const accountPart = parts[1].split("/")[0].split("?")[0];
      if (accountPart && !["login", "home", "sign-up", "profile", ""].includes(accountPart)) {
        accountId = accountPart;
      }
    }
    if (!accountId) throw new Error("Could not extract account ID");

    // Navigate to Workers AI
    await page.goto(`https://dash.cloudflare.com/${accountId}/workers-ai`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(3000);

    // Create API token via page.evaluate
    const tokenName = `WorkersAI-${Date.now()}`;
    const response = await page.evaluate(
      async ([aid, tname]) => {
        const headers = {
          Accept: "application/json",
          "Content-Type": "application/json",
          "x-cross-site-security": "dash",
        };
        const match = document.cookie.match(/(?:^|; )x-atok=([^;]+)/);
        if (match) headers["x-atok"] = decodeURIComponent(match[1]);

        const res = await fetch("https://dash.cloudflare.com/api/v4/user/tokens", {
          method: "POST",
          credentials: "include",
          headers,
          body: JSON.stringify({
            name: tname,
            condition: {},
            policies: [
              {
                effect: "allow",
                resources: { [`com.cloudflare.api.account.${aid}`]: "*" },
                permission_groups: [
                  { id: "644535f4ed854494a59cb289d634b257" },
                  { id: "a92d2450e05d4e7bb7d0a64968f83d11" },
                  { id: "bacc64e0f6c34fc0883a1223f938a104" },
                ],
              },
            ],
          }),
        });
        return await res.json();
      },
      [accountId, tokenName]
    );

    const result = response.result || {};
    if (!response.success || !result.id || !result.value) {
      throw new Error(`Token creation failed: ${JSON.stringify(response.errors || response)}`);
    }

    await context.close();

    return {
      accountId,
      tokenId: result.id,
      apiToken: result.value,
    };
  } catch (err) {
    await context.close();
    throw err;
  }
}

/**
 * Bulk register Cloudflare accounts
 * @param {Array<{email: string, password: string}>} accounts
 * @param {{onProgress: (p: {index: number, email: string, ok: boolean, error?: string, id?: string, elapsedMs: number}) => void}} options
 * @returns {Promise<{success: number, failed: number}>}
 */
export async function bulkRegisterAccounts(accounts, { onProgress }) {
  let success = 0;
  let failed = 0;

  const launchArgs = [
    "--disable-blink-features=AutomationControlled",
    "--disable-infobars",
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-features=IsolateOrigins,site-per-process",
    "--exclude-switches=enable-automation",
  ];
  let browser;
  for (const channel of ["chrome", "msedge", "chromium"]) {
    try {
      browser = await chromium.launch({
        headless: false,
        channel: channel === "chromium" ? undefined : channel,
        args: launchArgs,
      });
      break;
    } catch (e) {}
  }
  if (!browser) throw new Error("Could not launch Chrome/Edge/Chromium");

  try {
    for (let i = 0; i < accounts.length; i++) {
      const { email, password } = accounts[i];
      const start = Date.now();

      try {
        const { accountId, tokenId, apiToken } = await runCloudflareLogin(browser, email, password);

        // Create connection in DB
        const conn = await createProviderConnection({
          providerId: "cloudflare-ai",
          email,
          apiKey: apiToken,
          providerSpecificData: { accountId, tokenId },
        });

        success++;
        onProgress({
          index: i,
          email,
          ok: true,
          id: conn.id,
          elapsedMs: Date.now() - start,
        });
      } catch (err) {
        failed++;
        onProgress({
          index: i,
          email,
          ok: false,
          error: err.message || String(err),
          elapsedMs: Date.now() - start,
        });
      }
    }
  } finally {
    await browser.close();
  }

  return { success, failed };
}
