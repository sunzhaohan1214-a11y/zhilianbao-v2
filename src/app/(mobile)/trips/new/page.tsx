import Link from "next/link";
import { TripForm } from "@/components/trip/trip-form";
import { tripPageContext } from "@/lib/trip/page-context";

export default async function NewTripPage() {
  const { actor } = await tripPageContext();
  const allowed = actor.capabilities.has("trip.create.self") || actor.capabilities.has("trip.create.shared") || actor.capabilities.has("trip.create.team");
  if (!allowed) return <section className="rounded-2xl bg-white p-6 text-center"><h1 className="text-xl font-semibold">无权创建行程</h1></section>;
  return <section><Link href="/trips" className="text-sm text-blue-700">‹ 返回工作行程</Link><h1 className="mt-4 text-2xl font-semibold">新建工作行程</h1><TripForm /></section>;
}
