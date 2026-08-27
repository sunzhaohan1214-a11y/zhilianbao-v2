"use client";

import { useState } from "react";

export function AttachmentOpenButton({ id, label }: { id: string; label: string }) {
  const [message, setMessage] = useState("");
  async function open() {
    setMessage("");
    const response = await fetch(`/api/v2/attachments/${id}/access`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "PREVIEW" }) });
    const body = await response.json() as { ok: boolean; data?: { url: string }; error?: { message: string } };
    if (!response.ok || !body.data?.url) { setMessage(body.error?.message ?? "附件暂不可用"); return; }
    window.open(body.data.url, "_blank", "noopener,noreferrer");
  }
  return <span><button type="button" onClick={open} className="text-blue-700 underline underline-offset-2">{label}</button>{message && <span className="ml-2 text-xs text-red-600">{message}</span>}</span>;
}
