export default {
  id: "clinepass",
  priority: 79,
  alias: "clp",
  uiAlias: "clp",
  display: {
    name: "ClinePass",
    icon: "smart_toy",
    color: "#5B9BD5",
    textIcon: "CLP",
    website: "https://cline.bot",
    notice: {
      signupUrl: "https://cline.bot",
    },
  },
  category: "oauth",
  transport: {
    baseUrl: "https://api.cline.bot/api/v1/chat/completions",
    headers: {
      "HTTP-Referer": "https://cline.bot",
      "X-Title": "Cline",
    },
    tokenUrl: "https://api.cline.bot/api/v1/auth/token",
    refreshUrl: "https://api.cline.bot/api/v1/auth/refresh",
    auth: {
      combined: true,
      header: "Authorization",
      scheme: "bearer",
      hooks: [
        "clinePassHeaders",
      ],
    },
  },
  models: [
    // ClinePass models ($9.99/month subscription) — use cline-pass/ prefix per Cline API
    { id: "cline-pass/glm-5.2", name: "GLM-5.2" },
    { id: "cline-pass/kimi-k2.7-code", name: "Kimi K2.7 Code" },
    { id: "cline-pass/kimi-k2.6", name: "Kimi K2.6" },
    { id: "cline-pass/deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    { id: "cline-pass/deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    { id: "cline-pass/mimo-v2.5", name: "MiMo-V2.5" },
    { id: "cline-pass/mimo-v2.5-pro", name: "MiMo-V2.5-Pro" },
    { id: "cline-pass/minimax-m3", name: "MiniMax M3" },
    { id: "cline-pass/qwen3.7-max", name: "Qwen3.7 Max" },
    { id: "cline-pass/qwen3.7-plus", name: "Qwen3.7 Plus" },
  ],
  oauth: {
    appBaseUrl: "https://app.cline.bot",
    apiBaseUrl: "https://api.cline.bot",
    authorizeUrl: "https://api.cline.bot/api/v1/auth/authorize",
    tokenExchangeUrl: "https://api.cline.bot/api/v1/auth/token",
    refreshUrl: "https://api.cline.bot/api/v1/auth/refresh",
  },
};
