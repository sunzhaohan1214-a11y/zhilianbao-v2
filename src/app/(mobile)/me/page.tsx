import Link from "next/link";

export default function MePage() {
  return (
    <section>
      <h2 className="text-2xl font-semibold tracking-tight">我的</h2>
      <div className="mt-6">
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-neutral-500">工作</p>
        <Link href="/presence" className="block rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5">
          <p className="font-medium">来离宝</p>
          <p className="mt-1 text-sm text-neutral-500">填报完整来宝安排、查看当前在宝</p>
        </Link>
      </div>
      <div className="mt-6">
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-neutral-500">个人事务</p>
        <Link href="/help-requests" className="block rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5">
          <p className="font-medium">办事求助</p>
          <p className="mt-1 text-sm text-neutral-500">发起住宿、交通、用餐、工作与生活求助</p>
        </Link>
      </div>
      <Link href="/account/security" className="mt-6 block rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5">
        <p className="font-medium">账号安全</p>
        <p className="mt-1 text-sm text-neutral-500">查看设备、修改密码或退出登录</p>
      </Link>
      <Link href="/me/capability-profile" className="mt-3 block rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5">
        <p className="font-medium">我的能力画像</p>
        <p className="mt-1 text-sm text-neutral-500">维护专业方向、可协调资源与需求偏好</p>
      </Link>
    </section>
  );
}
