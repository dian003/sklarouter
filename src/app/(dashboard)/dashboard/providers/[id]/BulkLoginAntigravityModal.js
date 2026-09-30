"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import { Button, Modal } from "@/shared/components";
import { translate } from "@/i18n/runtime";

const PLACEHOLDER = `email1@yourdomain.com|password123
email2@yourdomain.com|password456`;

export default function BulkLoginAntigravityModal({ isOpen, onClose, onSuccess }) {
  const [text, setText] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState([]);
  const [done, setDone] = useState(null);
  const [error, setError] = useState("");

  const handleClose = () => {
    if (running) return;
    setText("");
    setProgress([]);
    setDone(null);
    setError("");
    onClose();
  };

  const handleSubmit = async () => {
    const trimmed = text.trim();
    if (!trimmed || running) return;
    setRunning(true);
    setError("");
    setProgress([]);
    setDone(null);

    try {
      const res = await fetch("/api/oauth/antigravity/bulk-login", {
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

  const successCount = progress.filter((p) => p.ok).length;
  const failCount = progress.filter((p) => !p.ok).length;

  return (
    <Modal isOpen={isOpen} title={translate("Bulk Login Antigravity Accounts")} onClose={handleClose}>
      <div className="flex flex-col gap-4">
        <p className="text-xs text-text-muted">
          {translate("One account per line, format: email|password. A Chrome window opens on the server to complete Google login automatically.")}
        </p>

        <textarea
          className="w-full rounded border border-accent/30 bg-sidebar p-2 text-sm font-mono resize-y min-h-[180px] focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder={PLACEHOLDER}
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={running}
        />

        {error && <p className="text-xs text-red-500 break-words">{error}</p>}

        {progress.length > 0 && (
          <div className="rounded border border-accent/20 bg-sidebar/50 p-2 text-xs font-mono max-h-48 overflow-y-auto flex flex-col gap-0.5">
            {progress.map((p) => (
              <div key={p.index} className={p.ok ? "text-green-400" : "text-red-400"}>
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
          <Button onClick={handleSubmit} fullWidth disabled={running || !text.trim()}>
            {running ? `${translate("Processing")}… (${successCount}/${progress.length || ""})` : translate("Start Login")}
          </Button>
          <Button onClick={handleClose} variant="ghost" fullWidth disabled={running}>
            {translate("Close")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

BulkLoginAntigravityModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSuccess: PropTypes.func,
};
