import Link from "next/link";
import { PresenceForm } from "@/components/presence/presence-form";
import { presencePageContext } from "@/lib/presence/page-context";
import { authorizeActor } from "@/modules/permissions";

export default async function NewPresencePage() {
  const { actor } = await presencePageContext();
  await authorizeActor({ actor, action: "presence.report.self" });
  return <section><Link href="/presence" className="text-sm text-blue-700">‹ 返回来离宝</Link><h1 className="mt-4 text-2xl font-semibold">新增报备</h1><PresenceForm /></section>;
}
