import { HomeView } from "@/components/mobile/home-view";
import { homePageContext } from "@/lib/home/page-context";

export default async function HomePage() {
  const now = new Date();
  const { actor, service } = await homePageContext(now);
  return <HomeView data={await service.overview({ actor, now })} />;
}
