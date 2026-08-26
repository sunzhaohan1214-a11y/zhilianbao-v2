"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function PasswordForm({ mode, forceChange = false }: { mode: "activate" | "change"; forceChange?: boolean }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const payload: Record<string, unknown> = {
      newPassword: form.get("newPassword"),
      confirmPassword: form.get("confirmPassword"),
    };
    if (mode === "activate") payload.confidentialityConfirm = form.get("confidentialityConfirm") === "on";
    if (mode === "change" && !forceChange) payload.oldPassword = form.get("oldPassword");
    try {
      const endpoint = mode === "activate" ? "first-password-change" : "change-password";
      const response = await fetch(`/api/v2/auth/${endpoint}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? "密码修改失败");
      router.replace("/");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "密码修改失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {mode === "change" && !forceChange && (
        <label className="block text-sm font-medium">原密码
          <input name="oldPassword" type="password" autoComplete="current-password" required className="mt-2 w-full rounded-2xl border border-black/10 bg-neutral-50 px-4 py-3.5 outline-none focus:border-blue-500" />
        </label>
      )}
      <label className="block text-sm font-medium">新密码
        <input name="newPassword" type="password" autoComplete="new-password" required minLength={8} maxLength={128} className="mt-2 w-full rounded-2xl border border-black/10 bg-neutral-50 px-4 py-3.5 outline-none focus:border-blue-500" />
      </label>
      <label className="block text-sm font-medium">确认新密码
        <input name="confirmPassword" type="password" autoComplete="new-password" required minLength={8} maxLength={128} className="mt-2 w-full rounded-2xl border border-black/10 bg-neutral-50 px-4 py-3.5 outline-none focus:border-blue-500" />
      </label>
      {mode === "activate" && (
        <label className="flex items-start gap-3 rounded-2xl bg-neutral-50 p-4 text-sm leading-6">
          <input name="confidentialityConfirm" type="checkbox" required className="mt-1 size-4" />
          <span>我确认本系统仅限内部工作使用，并承诺妥善保护其中的人员、企业及业务信息。</span>
        </label>
      )}
      <p className="text-xs leading-5 text-neutral-500">密码至少8位，且不得等于本人手机号后8位。</p>
      {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <button disabled={pending} className="w-full rounded-2xl bg-blue-600 px-4 py-3.5 font-semibold text-white disabled:opacity-60">
        {pending ? "提交中…" : mode === "activate" ? "完成激活" : "修改密码"}
      </button>
    </form>
  );
}
