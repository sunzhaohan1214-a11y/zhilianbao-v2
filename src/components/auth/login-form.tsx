"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, FieldError, FieldLabel, Input } from "@/components/ui";

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
    <form onSubmit={submit} className="space-y-5">
      <Field>
        <FieldLabel htmlFor="login-phone">手机号</FieldLabel>
        <Input id="login-phone" name="phone" inputMode="numeric" autoComplete="username" required placeholder="请输入登录手机号" />
      </Field>
      <Field>
        <FieldLabel htmlFor="login-password">密码</FieldLabel>
        <Input id="login-password" name="password" type="password" autoComplete="current-password" required placeholder="请输入密码" />
      </Field>
      {error && <FieldError>{error}</FieldError>}
      <Button className="w-full" disabled={pending} isLoading={pending} size="lg" type="submit">
        登录
      </Button>
      <p className="text-center text-sm leading-6 text-muted">
        忘记密码？请联系管理员 <a className="inline-flex min-h-11 items-center font-medium text-brand hover:underline" href={`tel:${adminContactPhone}`}>{adminContactPhone}</a>
      </p>
    </form>
  );
}
