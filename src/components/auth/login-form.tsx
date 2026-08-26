"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function LoginForm({ adminContactPhone }: { adminContactPhone: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/v2/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone: form.get("phone"), password: form.get("password") }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? "登录失败");
      const destination = result.data.nextStep === "ACTIVATE"
        ? "/account/activate"
        : result.data.nextStep === "CHANGE_PASSWORD"
          ? "/account/change-password"
          : "/";
      router.replace(destination);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "登录失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block text-sm font-medium">
        手机号
        <input name="phone" inputMode="numeric" autoComplete="username" required className="mt-2 w-full rounded-2xl border border-black/10 bg-neutral-50 px-4 py-3.5 outline-none focus:border-blue-500" />
      </label>
      <label className="block text-sm font-medium">
        密码
        <input name="password" type="password" autoComplete="current-password" required className="mt-2 w-full rounded-2xl border border-black/10 bg-neutral-50 px-4 py-3.5 outline-none focus:border-blue-500" />
      </label>
      {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <button disabled={pending} className="w-full rounded-2xl bg-blue-600 px-4 py-3.5 font-semibold text-white disabled:opacity-60">
        {pending ? "登录中…" : "登录"}
      </button>
      <p className="text-center text-sm text-neutral-500">
        忘记密码？请联系管理员 <a className="font-medium text-blue-600" href={`tel:${adminContactPhone}`}>{adminContactPhone}</a>
      </p>
    </form>
  );
}
