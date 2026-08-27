"use client";
import { useRouter } from "next/navigation";
export function MessageActions({id}:{id?:string}){const router=useRouter();const run=async()=>{await fetch(id?`/api/v2/messages/${id}/read`:"/api/v2/messages/read-all",{method:"POST"});router.refresh();};return <button onClick={run} className="rounded-xl border px-3 py-2 text-sm text-blue-700">{id?"标记已读":"全部已读"}</button>}
