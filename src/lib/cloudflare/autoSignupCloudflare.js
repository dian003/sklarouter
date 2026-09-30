import { chromium } from "playwright";
import { createProviderConnection } from "@/lib/db/repos/connectionsRepo";

// Cloudflare Turnstile sitekey for sign-up page
const CF_SIGNUP_SITEKEY = "0x4AAAAAAAJel0iaAR3mgkjp";
const CF_SIGNUP_URL = "https://dash.cloudflare.com/sign-up";
const GOMAIL_SIGNUP_URL = "https://mail.gopretstudio.com/signup";

/**
 * Generate random username
 */
function generateUsername(length = 10) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

/**
 * Generate random password
 */
function generatePassword(length = 16) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

/**
 * Extract Cloudflare verification link from text/HTML
 * @param {string} text
 * @returns {string|null}
 */
function extractVerificationLink(text) {
  if (!text) return null;
  const match = text.match(/https:\/\/dash\.cloudflare\.com\/email-verification\?token=[^\s\n\r"<>]+/);
  return match ? match[0] : null;
}

/**
 * Solve Cloudflare Turnstile via 2captcha API (single attempt)
 * @param {string} apiKey - 2captcha API key
 * @param {string} pageUrl - page URL where Turnstile is located
 * @param {string} sitekey - Turnstile sitekey
 * @returns {Promise<string|null>}
 */
async function solveTurnstile2captcha(apiKey, pageUrl, sitekey = CF_SIGNUP_SITEKEY) {
  if (!apiKey) return null;
  try {
    const createRes = await fetch("https://api.2captcha.com/createTask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientKey: apiKey,
        task: {
          type: "TurnstileTaskProxyless",
          websiteURL: pageUrl,
          websiteKey: sitekey,
        },
      }),
    });

    const createText = await createRes.text();
    let createData;
    try {
      createData = JSON.parse(createText);
    } catch (err) {
      return null;
    }

    if (createData.errorId !== 0) return null;

    const taskId = createData.taskId;
    if (!taskId) return null;

    // Poll for result (max 60s)
    for (let i = 0; i < 30; i++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const resultRes = await fetch("https://api.2captcha.com/getTaskResult", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientKey: apiKey, taskId }),
      });

      const resultText = await resultRes.text();
      let resultData;
      try {
        resultData = JSON.parse(resultText);
      } catch (err) {
        continue;
      }

      if (resultData.status === "ready") {
        return resultData.solution.token;
      }
      if (resultData.errorId !== 0) return null;
    }
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Wait for user to manually solve Turnstile in browser window.
 * Polls hidden input for token, up to timeoutMs.
 * @param {import('playwright').Page} page
 * @param {number} timeoutMs
 * @returns {Promise<string|null>}
 */
async function waitForManualTurnstileSolve(page, timeoutMs = 180000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const token = await page.evaluate(() => {
        const input = document.querySelector('input[name="cf_challenge_response"]');
        return input ? input.value : null;
      });
      if (token && token.length > 10) return token;
    } catch (e) {}
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return null;
}

/**
 * Solve Turnstile: try 2captcha 3x, fallback to manual solve in browser.
 * Mirrors solve_turnstile_with_fallback from cf_signup.py.
 * @param {import('playwright').Page} page
 * @param {string} apiKey - 2captcha API key (optional)
 * @param {string} pageUrl
 * @param {string} sitekey
 * @returns {Promise<string>}
 */
async function solveTurnstile(page, apiKey, pageUrl, sitekey = CF_SIGNUP_SITEKEY) {
  // Try 2captcha up to 3 times
  for (let attempt = 1; attempt <= 3; attempt++) {
    const token = await solveTurnstile2captcha(apiKey, pageUrl, sitekey);
    if (token) {
      await injectTurnstileToken(page, token);
      await page.waitForTimeout(1000);
      // Verify injection worked
      const hasToken = await page.evaluate(
        () => !!document.querySelector('input[name="cf_challenge_response"]')?.value
      );
      if (hasToken) return token;
    }
  }

  // Fallback: wait for manual solve in visible browser
  const manualToken = await waitForManualTurnstileSolve(page, 180000);
  if (manualToken) return manualToken;

  throw new Error("Turnstile not solved (2captcha failed + manual timeout)");
}

/**
 * Inject Turnstile token into page
 * @param {import('playwright').Page} page
 * @param {string} token
 */
async function injectTurnstileToken(page, token) {
  await page.evaluate((t) => {
    const input = document.querySelector('input[name="cf_challenge_response"]');
    if (input) {
      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      nativeSetter.call(input, t);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
    try {
      if (typeof window._cf_chl_opt !== "undefined" && window._cf_chl_opt.callback) {
        window._cf_chl_opt.callback(t);
      }
    } catch (e) {}
    try {
      if (typeof turnstileCallback === "function") {
        turnstileCallback(t);
      }
    } catch (e) {}
  }, token);
}

/**
 * Create GoMail temp email account via browser
 * @param {import('playwright').Page} page
 * @returns {Promise<{email: string, username: string, password: string}>}
 */
async function createGomailAccount(page) {
  const username = generateUsername(10);
  const password = generatePassword(16);

  await page.goto(GOMAIL_SIGNUP_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(1000);

  await page.fill("input#signup-username", username);
  await page.fill("input#signup-password", password);
  await page.fill("input#signup-confirm", password);

  // Pick random domain from dropdown
  let domainSuffix = "@awdigi.dev";
  try {
    await page.click('button[role="combobox"]');
    await page.waitForSelector('[role="option"]', { timeout: 10000 });
    const options = await page.$$('[role="option"]');
    if (options.length > 0) {
      const selected = options[Math.floor(Math.random() * options.length)];
      const domainText = ((await selected.innerText()) || "").trim();
      await selected.click();
      await page.waitForTimeout(300);
      domainSuffix = domainText.startsWith("@") ? domainText : `@${domainText}`;
    }
  } catch (e) {
    // fallback to default domain
  }

  const tempEmail = `${username}${domainSuffix}`;

  // Submit
  await page.waitForSelector('button[type="submit"]:has-text("Create Account")', { timeout: 5000 });
  const submitBtn = await page.$('button[type="submit"]:has-text("Create Account")');
  if (submitBtn) {
    await submitBtn.click({ force: true });
  } else {
    await page.click('button[type="submit"]', { force: true });
  }

  // Wait for inbox
  await page.waitForSelector('h1:has-text("Inbox")', { timeout: 15000 });

  return { email: tempEmail, username, password };
}

/**
 * Monitor GoMail inbox for Cloudflare verification email
 * @param {import('playwright').Page} page
 * @param {number} timeoutMs
 * @returns {Promise<string|null>}
 */
async function monitorGomailInbox(page, timeoutMs = 120000) {
  const start = Date.now();
  const checkedButtons = new Set();

  while (Date.now() - start < timeoutMs) {
    try {
      await page.reload({ waitUntil: "domcontentloaded" });
    } catch (e) {}
    await page.waitForTimeout(1500);

    const buttons = await page.$$("button");
    for (const btn of buttons) {
      try {
        const text = ((await btn.innerText()) || "").trim();
        if (!text) continue;

        const lower = text.toLowerCase();
        if (lower.includes("cloudflare") || lower.includes("verify") || lower.includes("action required")) {
          if (checkedButtons.has(text)) continue;
          checkedButtons.add(text);

          await btn.click({ force: true });
          await page.waitForTimeout(2000);

          // Check all frames
          for (const frame of page.frames) {
            try {
              const body = await frame.innerText("body");
              const link = extractVerificationLink(body);
              if (link) return link;
            } catch (e) {}
          }

          // Check main body
          try {
            const body = await page.innerText("body");
            const link = extractVerificationLink(body);
            if (link) return link;
          } catch (e) {}

          // Check HTML content
          try {
            const content = await page.content();
            const link = extractVerificationLink(content);
            if (link) return link;
          } catch (e) {}
        }
      } catch (e) {}
    }

    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  return null;
}

/**
 * Fill Cloudflare signup form + submit
 * @param {import('playwright').Page} page
 * @param {string} email
 * @param {string} password
 * @param {string} captchaApiKey
 * @returns {Promise<boolean>}
 */
async function signupCloudflare(page, email, password, captchaApiKey) {
  await page.goto(CF_SIGNUP_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(3000);
  try {
    await page.waitForLoadState("networkidle", { timeout: 15000 });
  } catch (e) {}
  await page.waitForTimeout(2000);

  // Handle page-level challenge
  const title = await page.title();
  if (title.includes("Just a moment")) {
    const challengeToken = await solveTurnstile(page, captchaApiKey, CF_SIGNUP_URL);
    await injectTurnstileToken(page, challengeToken);
    await page.waitForTimeout(5000);
    try {
      await page.waitForLoadState("networkidle", { timeout: 15000 });
    } catch (e) {}
    await page.waitForTimeout(3000);
  }

  // Wait for signup form
  const emailSelectors = [
    'input[data-testid="signup-input-email"]',
    'input[name="email"]',
    'input[type="email"]',
    'input#email',
  ];
  let emailInput = null;
  for (const sel of emailSelectors) {
    try {
      await page.waitForSelector(sel, { timeout: 5000 });
      emailInput = await page.$(sel);
      if (emailInput) break;
    } catch (e) {}
  }

  if (!emailInput) throw new Error("Signup email input not found");

  await emailInput.click();
  await emailInput.fill(email);
  await page.waitForTimeout(300);

  const pwdSelectors = [
    'input[data-testid="signup-input-password"]',
    'input[name="password"]',
    'input[type="password"]',
  ];
  let pwdInput = null;
  for (const sel of pwdSelectors) {
    try {
      pwdInput = await page.$(sel);
      if (pwdInput) break;
    } catch (e) {}
  }
  if (!pwdInput) throw new Error("Signup password input not found");

  await pwdInput.click();
  await pwdInput.fill(password);
  await page.waitForTimeout(500);

  // Solve Turnstile
  const turnstileToken = await solveTurnstile(page, captchaApiKey, CF_SIGNUP_URL);
  await injectTurnstileToken(page, turnstileToken);
  await page.waitForTimeout(1000);

  // Submit
  const submitSelectors = [
    'button[data-testid="signup-submit-button"]',
    'button[type="submit"]:has-text("Sign up")',
    'button[type="submit"]',
  ];
  let clicked = false;
  for (const sel of submitSelectors) {
    try {
      const btn = await page.$(sel);
      if (btn) {
        await btn.click({ force: true });
        clicked = true;
        break;
      }
    } catch (e) {}
  }
  if (!clicked) throw new Error("Could not click signup submit button");

  // Wait for redirect
  try {
    await page.waitForURL((u) => !u.includes("sign-up"), { timeout: 15000 });
  } catch (e) {}
  await page.waitForTimeout(2000);

  const url = page.url();
  if (url && !url.includes("sign-up") && (url.includes("home") || url.includes("account") || url.includes("/login") || url.replace(/\/$/, "").endsWith("cloudflare.com"))) {
    return true;
  }

  // Check body for known states
  let bodyText = "";
  try {
    bodyText = (await page.innerText("body")).toLowerCase();
  } catch (e) {}

  if (bodyText.includes("check your email") || bodyText.includes("verify your email")) {
    return true;
  }
  if (bodyText.includes("already") && (bodyText.includes("exist") || bodyText.includes("taken"))) {
    throw new Error("Email already exists");
  }

  return true;
}

/**
 * Verify email + extract account_id + create API token
 * @param {import('playwright').Page} page
 * @param {import('playwright').BrowserContext} context
 * @param {string} verifyLink
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{accountId: string, tokenId: string, apiToken: string}>}
 */
async function verifyAndExtract(page, context, verifyLink, email, password) {
  await page.goto(verifyLink, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(5000);

  const url = page.url();

  let bodyText = "";
  try {
    bodyText = (await page.innerText("body")).toLowerCase();
  } catch (e) {}

  const needsLogin = url.includes("/login") || bodyText.includes("sign in") || (bodyText.includes("log in") && !bodyText.includes("sign up"));

  if (needsLogin) {
    await page.goto("https://dash.cloudflare.com/login", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(3000);
    await page.waitForSelector('input[type="email"]', { timeout: 15000 });
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);
    await page.waitForTimeout(4000);
    await page.click('button[type="submit"]', { timeout: 5000 });
    await page.waitForTimeout(5000);
  } else {
    await page.waitForTimeout(2000);
  }

  const currentUrl = page.url();

  // Extract account ID from URL
  let accountId = null;
  const parts = currentUrl.split("dash.cloudflare.com/");
  if (parts.length > 1) {
    const accountPart = parts[1].split("/")[0].split("?")[0];
    if (accountPart && !["login", "home", "sign-up", "", "profile"].includes(accountPart)) {
      accountId = accountPart;
    }
  }

  // Fallback: extract from curr-account cookie
  if (!accountId) {
    const cookies = await context.cookies();
    for (const c of cookies) {
      if (c.name === "curr-account") {
        try {
          const data = JSON.parse(c.value);
          accountId = Object.values(data)[0];
          break;
        } catch (e) {}
      }
    }
  }

  if (!accountId) throw new Error("Could not extract account ID");

  // Wait for dashboard to fully load
  try {
    await page.waitForLoadState("networkidle", { timeout: 15000 });
  } catch (e) {}
  await page.waitForTimeout(2000);

  // Create API token
  const tokenName = `WorkersAI-${Date.now()}`;
  const response = await page.evaluate(
    async ([aid, tname]) => {
      const headers = {
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-cross-site-security": "dash",
      };
      const m = document.cookie.match(/(?:^|; )x-atok=([^;]+)/);
      if (m) headers["x-atok"] = decodeURIComponent(m[1]);

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

  const result = (response && response.result) || {};
  if (!response || !response.success || !result.id || !result.value) {
    throw new Error(`Token creation failed: ${JSON.stringify((response && response.errors) || response)}`);
  }

  return {
    accountId,
    tokenId: result.id,
    apiToken: result.value,
  };
}

/**
 * Run one full Cloudflare auto-signup flow
 * @param {import('playwright').Browser} browser
 * @param {string} captchaApiKey - 2captcha API key
 * @returns {Promise<{email: string, password: string, accountId: string, tokenId: string, apiToken: string}>}
 */
async function runCloudflareSignup(browser, captchaApiKey) {
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    locale: "en-US",
    timezoneId: "America/New_York",
  });

  await context.addInitScript(() => {
    // Stealth: hide automation flags
    Object.defineProperty(navigator, "webdriver", { get: () => false });
    Object.defineProperty(navigator, "plugins", {
      get: () => [1, 2, 3, 4, 5],
    });
    Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
    // Fake chrome runtime (real Chrome has window.chrome)
    window.chrome = { runtime: {}, loadTimes: () => ({}), csi: () => ({}) };
    // WebGL vendor spoofing
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (p) {
      if (p === 37445) return "Intel Inc.";
      if (p === 37446) return "Intel Iris OpenGL Engine";
      return getParameter.call(this, p);
    };
    // Permissions API
    const originalQuery = window.navigator.permissions && window.navigator.permissions.query;
    if (originalQuery) {
      window.navigator.permissions.query = (parameters) =>
        parameters.name === "notifications"
          ? Promise.resolve({ state: Notification.permission })
          : originalQuery(parameters);
    }
  });

  const cfPassword = generatePassword(16);

  try {
    // Step 1: Create GoMail temp email
    const gomailPage = await context.newPage();
    const gomailInfo = await createGomailAccount(gomailPage);

    // Step 2: Cloudflare signup
    const cfPage = await context.newPage();
    await signupCloudflare(cfPage, gomailInfo.email, cfPassword, captchaApiKey);

    // Step 3: Monitor GoMail inbox for verification link
    const verifyLink = await monitorGomailInbox(gomailPage, 120000);
    await gomailPage.close();

    if (!verifyLink) throw new Error("Verification email not received in GoMail inbox");

    // Step 4: Verify + extract token
    const result = await verifyAndExtract(cfPage, context, verifyLink, gomailInfo.email, cfPassword);
    await cfPage.close();

    return {
      email: gomailInfo.email,
      password: cfPassword,
      ...result,
    };
  } catch (err) {
    await context.close();
    throw err;
  }
}

/**
 * Auto-signup multiple Cloudflare accounts
 * @param {number} count - number of accounts to create
 * @param {string} captchaApiKey - 2captcha API key
 * @param {{onProgress: (p: {index: number, email: string, ok: boolean, error?: string, id?: string, elapsedMs: number}) => void}} options
 * @returns {Promise<{success: number, failed: number}>}
 */
export async function autoSignupAccounts(count, captchaApiKey, { onProgress }) {
  let success = 0;
  let failed = 0;

  // Try real system Chrome first (better anti-detection than bundled Chromium),
  // fallback to Edge then Chromium.
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
    } catch (e) {
      // try next channel
    }
  }
  if (!browser) throw new Error("Could not launch Chrome/Edge/Chromium");

  try {
    for (let i = 0; i < count; i++) {
      const start = Date.now();

      try {
        const { email, password, accountId, tokenId, apiToken } = await runCloudflareSignup(browser, captchaApiKey);

        // Create connection in DB
        const conn = await createProviderConnection({
          providerId: "cloudflare-ai",
          email,
          apiKey: apiToken,
          providerSpecificData: { accountId, tokenId, password },
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
          email: "auto-generated",
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
