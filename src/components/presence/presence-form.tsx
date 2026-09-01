"use client";

import { useEffect, useState, type FormEvent } from "react";

type FormValues = {
  arrivalAt: string;
  expectedDepartureAt: string;
  origin: string;
  transportMode: string;
  trainFlightNo: string;
  note: string;
};

const emptyValues: FormValues = {
  arrivalAt: "",
  expectedDepartureAt: "",
  origin: "",
  transportMode: "",
  trainFlightNo: "",
  note: "",
};

function toShanghaiIso(value: string) {
  return `${value.length === 16 ? `${value}:00` : value}+08:00`;
}

export function PresenceForm({
  reportId,
  initialValues = emptyValues,
}: {
  reportId?: string;
  initialValues?: FormValues;
}) {
  const draftKey = reportId ? `presence-edit-${reportId}` : "presence-new-draft";
  const [values, setValues] = useState(initialValues);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [retryAvailable, setRetryAvailable] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = window.localStorage.getItem(draftKey);
      if (saved) {
        try { setValues(JSON.parse(saved) as FormValues); } catch { window.localStorage.removeItem(draftKey); }
      }
      setDraftLoaded(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [draftKey]);

  useEffect(() => {
    if (draftLoaded) window.localStorage.setItem(draftKey, JSON.stringify(values));
  }, [draftKey, draftLoaded, values]);

  function field(name: keyof FormValues, value: string) {
    setValues((current) => ({ ...current, [name]: value }));
    setRetryAvailable(false);
    setMessage("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setRetryAvailable(false);
    setMessage("");
    try { window.localStorage.setItem(draftKey, JSON.stringify(values)); } catch { /* Current form state still preserves the draft. */ }
    try {
      const response = await fetch(reportId ? `/api/v2/presence/${reportId}/update` : "/api/v2/presence", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...values,
          arrivalAt: toShanghaiIso(values.arrivalAt),
          expectedDepartureAt: toShanghaiIso(values.expectedDepartureAt),
        }),
      });
      const payload = await response.json() as { ok: boolean; error?: { message?: string } };
      if (!response.ok) {
        setMessage(payload.error?.message ?? "保存失败，请稍后重试");
        setRetryAvailable(true);
        return;
      }
      window.localStorage.removeItem(draftKey);
      // Replace the submitted form in history while retaining the full navigation that avoids the post-submit RSC race.
      window.location.replace("/presence");
    } catch {
      setMessage("网络连接中断，报备内容已保留。请检查网络后重新提交；若服务端已保存，重试不会重复创建记录。");
      setRetryAvailable(true);
    } finally {
      setPending(false);
    }
  }

  const inputClass = "mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-3 outline-none focus:border-blue-500";
  return (
    <form aria-busy={!draftLoaded || pending} onSubmit={submit} className="mt-6 space-y-5 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5">
      <label className="block text-sm font-medium">到宝时间
        <input aria-label="到宝时间" disabled={!draftLoaded || pending} required type="datetime-local" value={values.arrivalAt} onChange={(e) => field("arrivalAt", e.target.value)} className={inputClass} />
      </label>
      <label className="block text-sm font-medium">预计离宝时间
        <input aria-label="预计离宝时间" disabled={!draftLoaded || pending} required type="datetime-local" value={values.expectedDepartureAt} onChange={(e) => field("expectedDepartureAt", e.target.value)} className={inputClass} />
      </label>
      <label className="block text-sm font-medium">来源地（选填）
        <input disabled={!draftLoaded || pending} value={values.origin} maxLength={200} onChange={(e) => field("origin", e.target.value)} className={inputClass} />
      </label>
      <label className="block text-sm font-medium">交通方式（选填）
        <input disabled={!draftLoaded || pending} value={values.transportMode} maxLength={100} onChange={(e) => field("transportMode", e.target.value)} className={inputClass} />
      </label>
      <label className="block text-sm font-medium">车次/航班（选填）
        <input disabled={!draftLoaded || pending} value={values.trainFlightNo} maxLength={100} onChange={(e) => field("trainFlightNo", e.target.value)} className={inputClass} />
      </label>
      <label className="block text-sm font-medium">备注（选填）
        <textarea disabled={!draftLoaded || pending} value={values.note} maxLength={1000} rows={3} onChange={(e) => field("note", e.target.value)} className={inputClass} />
      </label>
      <p className="text-xs text-neutral-500">按北京时间填写。来离宝不是考勤，不采集位置或轨迹。</p>
      {message && <p role="alert" className="text-sm text-red-600">{message}</p>}
      <button disabled={!draftLoaded || pending} className="w-full rounded-xl bg-blue-600 px-4 py-3 font-medium text-white disabled:opacity-50">
        {pending ? "保存中…" : retryAvailable ? "重新提交" : reportId ? "保存修改" : "提交报备"}
      </button>
    </form>
  );
}
