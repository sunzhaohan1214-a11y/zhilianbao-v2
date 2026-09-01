import Link from "next/link";
import type { HomeOverview } from "@/modules/home";
import { TRIP_STATUS_LABEL } from "@/modules/trip";
import { BrandLogo } from "./brand-logo";
import { MascotAvatar } from "./mascot-avatar";

function initials(name: string) {
  return [...name.trim()].slice(-2).join("") || "我";
}

function messageBadge(count: number) {
  return count > 99 ? "99+" : String(count);
}

function formatTime(value: Date) {
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hour12: false }).format(value);
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric" }).format(value);
}

const todoModuleLabel: Record<string, string> = { ANNOUNCEMENT: "公告", DEMAND: "需求", HELP: "办事求助", TRIP: "行程", REIMBURSEMENT: "报销" };

function SectionTitle({ id, title, href, linkLabel = "查看全部" }: { id: string; title: string; href?: string; linkLabel?: string }) {
  return <div className="flex items-center justify-between gap-4"><h2 id={id} className="text-[17px] font-semibold tracking-tight text-foreground">{title}</h2>{href && <Link href={href} className="min-h-11 content-center text-sm font-medium text-brand">{linkLabel}</Link>}</div>;
}

export function HomeView({ data }: { data: HomeOverview }) {
  return (
    <div className="space-y-7 pb-2">
      <header className="flex min-h-11 items-center justify-between gap-3" aria-label="首页顶部栏">
        <div className="flex min-w-0 items-center gap-2.5">
          <BrandLogo />
          <div className="min-w-0"><h1 aria-label="首页" className="truncate text-xl font-semibold tracking-tight">智链宝</h1><p className="truncate text-[11px] font-medium tracking-wide text-water">电力装备产业协同</p></div>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/messages" aria-label={data.header.unreadMessageCount > 0 ? `消息，${data.header.unreadMessageCount} 条未读` : "消息"} className="relative grid size-11 place-items-center rounded-full bg-surface shadow-sm ring-1 ring-separator">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-none stroke-current" strokeWidth="1.8"><path d="M5 8.5a7 7 0 0 1 14 0v4.2l1.3 2.6a1 1 0 0 1-.9 1.5H4.6a1 1 0 0 1-.9-1.5L5 12.7V8.5Z"/><path d="M9.5 19a3 3 0 0 0 5 0"/></svg>
            {data.header.unreadMessageCount > 0 && <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-danger px-1 text-center text-[10px] font-semibold leading-5 text-white">{messageBadge(data.header.unreadMessageCount)}</span>}
          </Link>
          <Link href="/me" aria-label={`我的，${data.header.displayName}`} className="grid size-11 place-items-center rounded-full bg-neutral-800 text-xs font-semibold text-white">{initials(data.header.displayName)}</Link>
        </div>
      </header>

      <section aria-labelledby="haobao-title" className="rounded-[22px] border border-separator bg-surface p-4 shadow-sm">
        <div className="flex items-center gap-3"><MascotAvatar /><div><p className="text-xs font-medium text-brand">荷宝 AI</p><h2 id="haobao-title" className="mt-0.5 text-[17px] font-semibold">问政策、查企业、找团员</h2></div></div>
        <p className="mt-3 text-sm leading-6 text-muted">安全查询正式数据；无语义服务时自动降级到结构化检索。</p>
        <nav aria-label="荷宝结构化检索" className="mt-3 grid grid-cols-3 gap-2">
          <Link href="/ai" className="min-h-11 rounded-xl bg-surface-secondary px-2 py-2.5 text-center text-sm font-medium">问荷宝</Link>
          <Link href="/resources/enterprises" className="min-h-11 rounded-xl bg-surface-secondary px-2 py-2.5 text-center text-sm font-medium">查企业</Link>
          <Link href="/resources/members" className="min-h-11 rounded-xl bg-surface-secondary px-2 py-2.5 text-center text-sm font-medium">找团员</Link>
        </nav>
      </section>

      {data.announcement && <section aria-labelledby="announcement-title">
        <SectionTitle id="announcement-title" title="公告" href="/announcements" />
        <Link href={`/announcements/${data.announcement.id}`} className="mt-3 flex min-h-16 items-center justify-between gap-4 rounded-2xl border border-separator bg-surface p-4 shadow-sm">
          <div className="min-w-0"><p className="truncate font-medium">{data.announcement.title}</p><p className="mt-1 text-xs text-muted">{data.announcement.pendingConfirm ? "重要公告 · 待确认" : data.announcement.isImportant ? "重要公告" : "最新公告"}</p></div><span aria-hidden="true" className="text-tertiary">›</span>
        </Link>
      </section>}

      {data.teamOverview && <section aria-labelledby="team-title">
        <SectionTitle id="team-title" title="全团概览" href="/team/overview" />
        <div className="mt-1 flex gap-1 text-xs text-muted">{data.teamOverview.roleLabels.map((label) => <span key={label}>{label}</span>)}</div>
        <Link href="/team/overview" className="mt-3 grid grid-cols-4 divide-x divide-separator rounded-2xl border border-separator bg-surface py-4 text-center shadow-sm">
          {[['待对接', data.teamOverview.pendingClaim], ['对接中', data.teamOverview.inProgress], ['久未更新', data.teamOverview.stale], ['待办结审核', data.teamOverview.pendingCloseReview]].map(([label, value]) => <div key={String(label)} className="px-1"><strong className="block text-xl font-semibold">{value}</strong><span className="mt-1 block text-[11px] leading-4 text-muted">{label}</span></div>)}
        </Link>
      </section>}

      <section aria-labelledby="presence-title">
        <SectionTitle id="presence-title" title="当前在宝" href="/presence/current" />
        <Link href="/presence/current" className="mt-3 block rounded-2xl border border-separator bg-surface p-4 shadow-sm">
          <div className="flex items-end justify-between"><div><strong className="text-3xl font-semibold">{data.presence.total}</strong><span className="ml-1 text-sm text-muted">人</span></div><span className="text-xs text-muted">在任 {data.presence.currentCount} · 往届 {data.presence.alumniCount}</span></div>
          {data.presence.people.length > 0 ? <div className="mt-4 flex items-center -space-x-1">{data.presence.people.map((person) => <span key={person.id} title={`${person.name}·${person.memberType === 'CURRENT' ? '在任' : '往届'}`} className="grid size-10 place-items-center rounded-full border-2 border-white bg-surface-secondary text-xs font-medium">{initials(person.name)}</span>)}{data.presence.remainingCount > 0 && <span className="grid size-10 place-items-center rounded-full border-2 border-white bg-foreground text-xs font-medium text-white">+{data.presence.remainingCount}</span>}</div> : <p className="mt-3 text-sm text-muted">当前暂无在宝人员</p>}
        </Link>
      </section>

      <section aria-labelledby="trips-title">
        <SectionTitle id="trips-title" title="今日行程" href="/trips" />
        <div className="mt-3 space-y-2">{data.trips.map((trip) => <Link key={trip.id} href={`/trips/${trip.id}`} className="flex min-h-16 gap-3 rounded-2xl border border-separator bg-surface p-4 shadow-sm"><time className="w-12 shrink-0 text-sm font-semibold" dateTime={trip.startAt.toISOString()}>{formatTime(trip.startAt)}</time><div className="min-w-0"><p className="truncate font-medium">{trip.summary}</p><p className="mt-1 truncate text-xs text-muted">{trip.participantNames.join('、') || '参与人待完善'} · {TRIP_STATUS_LABEL[trip.status]}</p></div></Link>)}{data.trips.length === 0 && <p className="rounded-2xl border border-separator bg-surface p-4 text-sm text-muted shadow-sm">今日暂无行程</p>}</div>
      </section>

      {data.todos.length > 0 && <section aria-labelledby="todos-title">
        <SectionTitle id="todos-title" title="我的待办" href="/todos" />
        <div className="mt-3 divide-y divide-separator rounded-2xl border border-separator bg-surface px-4 shadow-sm">{data.todos.map((todo) => <Link key={todo.id} href={todo.actionUrl} className="flex min-h-16 items-center justify-between gap-4 py-3"><div className="min-w-0"><p className="truncate font-medium">{todo.label}</p><p className="mt-1 text-xs text-muted">{todo.priority === 'HIGH' ? '紧急' : todoModuleLabel[todo.module] ?? '业务事项'}{todo.dueAt ? ` · ${formatDate(todo.dueAt)}截止` : ''}</p></div><span aria-hidden="true" className="text-tertiary">›</span></Link>)}</div>
      </section>}

      <section aria-labelledby="demands-title">
        <SectionTitle id="demands-title" title="最新需求" href="/demands?status=PENDING_CLAIM" linkLabel={data.latestDemands.remainingCount > 0 ? `还有 ${data.latestDemands.remainingCount} 条` : "查看全部"} />
        <div className="mt-3 space-y-2">{data.latestDemands.items.map((demand) => <Link key={demand.id} href={`/demands/${demand.id}`} className="block rounded-2xl border border-separator bg-surface p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><p className="font-medium leading-6">{demand.title}</p>{demand.attentionLabel && <span className="shrink-0 rounded-full bg-brand-soft px-2 py-1 text-[11px] font-medium text-brand">{demand.attentionLabel}</span>}</div><p className="mt-2 text-sm text-muted">{demand.enterpriseName} · {demand.responsibleAreaName}</p><p className="mt-1 text-xs text-tertiary">{demand.businessNo} · 待对接</p></Link>)}{data.latestDemands.items.length === 0 && <p className="rounded-2xl border border-separator bg-surface p-4 text-sm text-muted shadow-sm">暂无待对接需求</p>}</div>
      </section>
    </div>
  );
}
