"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type DeviceSession = {
  sessionId: string;
  deviceName: string;
  createdAt: string;
  expiresAt: string;
  isCurrent: boolean;
};

export function SecurityPanel({ initialSessions }: { initialSessions: DeviceSession[] }) {
  const router = useRouter();
  const [sessions, setSessions] = useState<DeviceSession[]>(initialSessions);
  const [error, setError] = useState("");

  async function post(path: string) {
    setError("");
    const response = await fetch(path, { method: "POST" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message ?? "操作失败");
    return result;
  }

  async function logout(path: "logout" | "logout-all") {
    try {
      await post(`/api/v2/auth/${path}`);
      router.replace("/login");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "操作失败");
    }
  }

  async function revoke(session: DeviceSession) {
    try {
      await post(`/api/v2/auth/sessions/${session.sessionId}/revoke`);
      if (session.isCurrent) {
        router.replace("/login");
        router.refresh();
      } else {
        setSessions((current) => current.filter(({ sessionId }) => sessionId !== session.sessionId));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "操作失败");
    }
  }

  return (
    <div className="space-y-5">
      {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
        {sessions.map((session) => (
          <div key={session.sessionId} className="flex items-center justify-between gap-4 border-b border-black/5 p-4 last:border-0">
            <div>
              <p className="font-medium">{session.deviceName} {session.isCurrent && <span className="text-xs text-blue-600">当前设备</span>}</p>
              <p className="mt-1 text-xs text-neutral-500">登录于 {new Date(session.createdAt).toLocaleString("zh-CN")}</p>
            </div>
            <button onClick={() => revoke(session)} className="rounded-xl bg-neutral-100 px-3 py-2 text-sm text-red-600">撤销</button>
          </div>
        ))}
        {sessions.length === 0 && !error && <p className="p-5 text-sm text-neutral-500">当前没有有效设备。</p>}
      </section>
      <div className="space-y-3">
        <button onClick={() => logout("logout")} className="w-full rounded-2xl bg-white px-4 py-3.5 font-medium text-red-600 ring-1 ring-black/5">退出当前设备</button>
        <button onClick={() => logout("logout-all")} className="w-full rounded-2xl bg-red-600 px-4 py-3.5 font-medium text-white">退出全部设备</button>
      </div>
    </div>
  );
}
