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

type FormNotice = {
  tone: "error" | "success";
  text: string;
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
  const [notice, setNotice] = useState<FormNotice | null>(null);
  const [pending, setPending] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);

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
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setNotice(null);
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
        setNotice({ tone: "error", text: payload.error?.message ?? "保存失败，请稍后重试" });
        return;
      }
      window.localStorage.removeItem(draftKey);
      setNotice({ tone: "success", text: "保存成功，正在返回来离宝列表…" });
      window.location.replace("/presence");
    } catch {
      setNotice({ tone: "error", text: "网络异常，已保留当前内容，请检查连接后重试" });
    } finally {
      setPending(false);
    }
  }

  const inputClass = "mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-3 outline-none focus:border-blue-500";
  return (
    <form aria-busy={!draftLoaded || pending} onSubmit={submit} className="mt-6 space-y-5 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5">
      <label className="block text-sm font-medium">到宝时间
        <input aria-label="到宝时间" disabled={!draftLoaded} required type="datetime-local" value={values.arrivalAt} onChange={(e) => field("arrivalAt", e.target.value)} className={inputClass} />
      </label>
      <label className="block text-sm font-medium">预计离宝时间
        <input aria-label="预计离宝时间" disabled={!draftLoaded} required type="datetime-local" value={values.expectedDepartureAt} onChange={(e) => field("expectedDepartureAt", e.target.value)} className={inputClass} />
      </label>
      <label className="block text-sm font-medium">来源地（选填）
        <input disabled={!draftLoaded} value={values.origin} maxLength={200} onChange={(e) => field("origin", e.target.value)} className={inputClass} />
      </label>
      <label className="block text-sm font-medium">交通方式（选填）
        <input disabled={!draftLoaded} value={values.transportMode} maxLength={100} onChange={(e) => field("transportMode", e.target.value)} className={inputClass} />
      </label>
      <label className="block text-sm font-medium">车次/航班（选填）
        <input disabled={!draftLoaded} value={values.trainFlightNo} maxLength={100} onChange={(e) => field("trainFlightNo", e.target.value)} className={inputClass} />
      </label>
      <label className="block text-sm font-medium">备注（选填）
        <textarea disabled={!draftLoaded} value={values.note} maxLength={1000} rows={3} onChange={(e) => field("note", e.target.value)} className={inputClass} />
      </label>
      <p className="text-xs text-neutral-500">按北京时间填写。来离宝不是考勤，不采集位置或轨迹。</p>
      {notice && <p role={notice.tone === "error" ? "alert" : "status"} className={`text-sm ${notice.tone === "error" ? "text-red-600" : "text-emerald-700"}`}>{notice.text}</p>}
      <button disabled={!draftLoaded || pending} className="w-full rounded-xl bg-blue-600 px-4 py-3 font-medium text-white disabled:opacity-50">
        {pending ? "保存中…" : reportId ? "保存修改" : "提交报备"}
      </button>
    </form>
  );
}
