"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import { Button, Modal } from "@/shared/components";
import { translate } from "@/i18n/runtime";

const PLACEHOLDER = `email1@yourdomain.com:password123
email2@yourdomain.com:password456`;

export default function BulkRegisterCloudflareModal({ isOpen, onClose, onSuccess }) {
  const [mode, setMode] = useState("existing"); // "existing" or "auto"
  const [text, setText] = useState("");
  const [count, setCount] = useState(1);
  const [captchaApiKey, setCaptchaApiKey] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState([]);
  const [done, setDone] = useState(null);
  const [error, setError] = useState("");

  const handleClose = () => {
    if (running) return;
    setMode("existing");
    setText("");
    setCount(1);
    setCaptchaApiKey("");
    setProgress([]);
    setDone(null);
    setError("");
    onClose();
  };

  const handleSubmitExisting = async () => {
    const trimmed = text.trim();
    if (!trimmed || running) return;
    setRunning(true);
    setError("");
    setProgress([]);
    setDone(null);

    try {
      const res = await fetch("/api/cloudflare/bulk-register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmed }),
      });

      if (!res.ok && !res.body) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error || `Request failed: ${res.status}`);
        setRunning(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let anySuccess = false;

      while (true) {
        const { value, done: streamDone } = await reader.read();
        if (streamDone) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          let obj;
          try {
            obj = JSON.parse(line);
          } catch {
            continue;
          }
          if (obj.type === "progress") {
            setProgress((prev) => [...prev, obj]);
            if (obj.ok) anySuccess = true;
          } else if (obj.type === "done") {
            setDone(obj);
          } else if (obj.type === "error") {
            setError(obj.error);
          }
        }
      }

      if (anySuccess && typeof onSuccess === "function") onSuccess();
    } catch (err) {
      setError(err.message || translate("Request failed"));
    } finally {
      setRunning(false);
    }
  };

  const handleSubmitAutoSignup = async () => {
    if (!captchaApiKey.trim() || count < 1 || running) return;
    setRunning(true);
    setError("");
    setProgress([]);
    setDone(null);

    try {
      const res = await fetch("/api/cloudflare/auto-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count, captchaApiKey: captchaApiKey.trim() }),
      });

      if (!res.ok && !res.body) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error || `Request failed: ${res.status}`);
        setRunning(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let anySuccess = false;

      while (true) {
        const { value, done: streamDone } = await reader.read();
        if (streamDone) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          let obj;
          try {
            obj = JSON.parse(line);
          } catch {
            continue;
          }
          if (obj.type === "progress") {
            setProgress((prev) => [...prev, obj]);
            if (obj.ok) anySuccess = true;
          } else if (obj.type === "done") {
            setDone(obj);
          } else if (obj.type === "error") {
            setError(obj.error);
          }
        }
      }

      if (anySuccess && typeof onSuccess === "function") onSuccess();
    } catch (err) {
      setError(err.message || translate("Request failed"));
    } finally {
      setRunning(false);
    }
  };

  const successCount = progress.filter((p) => p.ok).length;
  const failCount = progress.filter((p) => !p.ok).length;

  return (
    <Modal isOpen={isOpen} title={translate("Bulk Register Cloudflare Accounts")} onClose={handleClose}>
      <div className="flex flex-col gap-4">
        {/* Mode tabs */}
        <div className="flex gap-2 border-b border-accent/20 pb-2">
          <button
            onClick={() => setMode("existing")}
            className={`px-3 py-1.5 text-sm rounded transition-colors ${
              mode === "existing"
                ? "bg-primary/10 text-primary font-medium"
                : "text-text-muted hover:text-text-primary"
            }`}
          >
            {translate("Existing Accounts")}
          </button>
          <button
            onClick={() => setMode("auto")}
            className={`px-3 py-1.5 text-sm rounded transition-colors ${
              mode === "auto"
                ? "bg-primary/10 text-primary font-medium"
                : "text-text-muted hover:text-text-primary"
            }`}
          >
            {translate("Auto Signup")}
          </button>
        </div>

        {mode === "existing" ? (
          <>
            <p className="text-xs text-text-muted">
              {translate("One account per line, format: email:password. A Chrome window opens on the server to complete Cloudflare login and create API tokens automatically.")}
            </p>

            <textarea
              className="w-full rounded border border-accent/30 bg-sidebar p-2 text-sm font-mono resize-y min-h-[180px] focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder={PLACEHOLDER}
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={running}
            />
          </>
        ) : (
          <>
            <p className="text-xs text-text-muted">
              {translate("Auto-generate new Cloudflare accounts using temp email and 2captcha. Requires 2captcha API key.")}
            </p>

            <div className="flex flex-col gap-3">
              <div>
                <label className="block text-xs text-text-muted mb-1">{translate("Number of accounts")}</label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  className="w-full rounded border border-accent/30 bg-sidebar p-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  value={count}
                  onChange={(e) => setCount(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
                  disabled={running}
                />
              </div>

              <div>
                <label className="block text-xs text-text-muted mb-1">
                  {translate("2captcha API Key")}
                  <a
                    href="https://2captcha.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-1 text-primary hover:underline"
                  >
                    ({translate("get key")})
                  </a>
                </label>
                <input
                  type="text"
                  className="w-full rounded border border-accent/30 bg-sidebar p-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  value={captchaApiKey}
                  onChange={(e) => setCaptchaApiKey(e.target.value)}
                  disabled={running}
                />
              </div>

              <p className="text-xs text-amber-600 dark:text-amber-400">
                ⚠️ {translate("Each account costs ~$0.003 in 2captcha credits. Takes 2-3 min per account.")}
              </p>
            </div>
          </>
        )}

        {error && <p className="text-xs text-red-500 break-words">{error}</p>}

        {progress.length > 0 && (
          <div className="rounded border border-accent/20 bg-sidebar/50 p-2 text-xs font-mono max-h-48 overflow-y-auto flex flex-col gap-0.5">
            {progress.map((p, idx) => (
              <div key={idx} className={p.ok ? "text-green-400" : "text-red-400"}>
                {p.ok ? "✓" : "✗"} {p.email} {p.ok ? "" : `— ${p.error}`}
              </div>
            ))}
          </div>
        )}

        {done && (
          <div className={`text-sm font-medium ${done.failed > 0 ? "text-yellow-400" : "text-green-400"}`}>
            ✓ {done.success} {translate("added")}
            {done.failed > 0 ? `, ✗ ${done.failed} ${translate("failed")}` : ""}
          </div>
        )}

        <div className="flex gap-2">
          <Button
            onClick={mode === "existing" ? handleSubmitExisting : handleSubmitAutoSignup}
            fullWidth
            disabled={running || (mode === "existing" ? !text.trim() : !captchaApiKey.trim())}
          >
            {running
              ? `${translate("Processing")}… (${successCount}/${progress.length || ""})`
              : mode === "existing"
              ? translate("Start Registration")
              : translate("Start Auto Signup")}
          </Button>
          <Button onClick={handleClose} variant="ghost" fullWidth disabled={running}>
            {translate("Close")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

BulkRegisterCloudflareModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSuccess: PropTypes.func,
};
