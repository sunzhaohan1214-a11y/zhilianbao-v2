"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function AnnouncementActions({ id, needConfirm, read }: { id: string; needConfirm: boolean; read: boolean }) {
  const router = useRouter();
  const [busy,setBusy]=useState(false);
  const run=async(action:"read"|"confirm")=>{setBusy(true);try{const response=await fetch(`/api/v2/announcements/${id}/${action}`,{method:"POST"});if(!response.ok)throw new Error("操作失败");router.refresh();}finally{setBusy(false);}};
  return <div className="mt-5 flex gap-3">{!read&&<button disabled={busy} onClick={()=>run("read")} className="rounded-xl border px-4 py-2 text-sm">标记已读</button>}{needConfirm&&<button disabled={busy} onClick={()=>run("confirm")} className="rounded-xl bg-blue-600 px-4 py-2 text-sm text-white">确认收到</button>}</div>;
}
