import Link from "next/link";
import { ContactResourceIcon, EnterpriseResourceIcon, MemberResourceIcon, PolicyResourceIcon, TalentResourceIcon } from "@/components/resource/resource-icons";
import { PageHeader } from "@/components/ui";

const resources = [
  { label: "企业", href: "/resources/enterprises", description: "企业名录、联系人和纠错申请", icon: EnterpriseResourceIcon },
  { label: "团员", href: "/resources/members", description: "在任与往届团员、专业方向和批次履历", icon: MemberResourceIcon },
  { label: "政策", href: "/resources/policies", description: "政策原文、智能解读与效力状态", icon: PolicyResourceIcon },
  { label: "人才库", href: "/resources/talents", description: "海内外人才名录、推荐申请和镇街对接", icon: TalentResourceIcon },
  { label: "通讯录", href: "/resources/contacts", description: "按组织查看当前在岗人员与联系电话", icon: ContactResourceIcon },
] as const;

export default function ResourcesPage() {
  return (
    <section>
      <PageHeader description="汇聚产业协同所需的企业、团员、政策与人才正式资源。" eyebrow="产业资源" title="资源" />
      <nav aria-label="资源分类" className="mt-6 divide-y divide-separator overflow-hidden rounded-2xl border border-separator bg-surface shadow-sm">
        {resources.map(({ label, href, description, icon: Icon }) => (
          <Link key={label} href={href} className="flex min-h-[76px] items-center gap-4 px-4 py-3 transition-colors hover:bg-surface-secondary">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand"><Icon className="size-6" /></span>
            <span className="min-w-0 flex-1"><strong className="block text-[16px] font-semibold text-foreground">{label}</strong><span className="mt-1 block text-sm leading-5 text-muted">{description}</span></span>
            <span aria-hidden="true" className="text-xl text-tertiary">›</span>
          </Link>
        ))}
      </nav>
    </section>
  );
}
