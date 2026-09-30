export default {
  id: "dashscope-intl",
  priority: 11,
  alias: "ds",
  display: {
    name: "DashScope Intl",
    icon: "cloud",
    color: "#FF6A00",
    textIcon: "DS",
    website: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    notice: {
      apiKeyUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
    headers: {},
  },
  models: [
    // Latest flagship
    { id: "qwen3.7-max", name: "Qwen3.7 Max" },
    { id: "qwen3.7-plus", name: "Qwen3.7 Plus" },
    { id: "qwen3.6-plus", name: "Qwen3.6 Plus" },
    { id: "qwen3.6-flash", name: "Qwen3.6 Flash" },
    { id: "qwen3.5-plus", name: "Qwen3.5 Plus" },
    { id: "qwen3.5-flash", name: "Qwen3.5 Flash" },
    // Coding
    { id: "qwen3-coder-next", name: "Qwen3 Coder Next" },
    { id: "qwen3-coder-plus", name: "Qwen3 Coder Plus" },
    { id: "qwen3-coder-flash", name: "Qwen3 Coder Flash" },
    { id: "qwen-coder-plus", name: "Qwen Coder Plus" },
    // Reasoning
    { id: "qwq-plus", name: "QwQ Plus" },
    { id: "qwen3-235b-a22b-thinking-2507", name: "Qwen3 235B Thinking" },
    { id: "qwen3-30b-a3b-thinking-2507", name: "Qwen3 30B Thinking" },
    // Standard
    { id: "qwen3-235b-a22b", name: "Qwen3 235B A22B" },
    { id: "qwen3-30b-a3b", name: "Qwen3 30B A3B" },
    { id: "qwen3-max", name: "Qwen3 Max" },
    { id: "qwen3-32b", name: "Qwen3 32B" },
    { id: "qwen3-14b", name: "Qwen3 14B" },
    { id: "qwen3-8b", name: "Qwen3 8B" },
    { id: "qwen-max", name: "Qwen Max" },
    { id: "qwen-plus", name: "Qwen Plus" },
    { id: "qwen-turbo", name: "Qwen Turbo" },
    { id: "qwen-flash", name: "Qwen Flash" },
    // DeepSeek via DashScope
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    { id: "deepseek-v3.2", name: "DeepSeek V3.2" },
    // Third-party via DashScope
    { id: "kimi-k2.7-code", name: "Kimi K2.7 Code" },
    { id: "glm-5.2", name: "GLM 5.2" },
    { id: "glm-5.1", name: "GLM 5.1" },
  ],
};
