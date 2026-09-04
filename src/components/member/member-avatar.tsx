"use client";

import { useState } from "react";

export function MemberAvatar({ name, attachmentId, className = "h-14 w-14" }: { name: string; attachmentId: string | null; className?: string }) {
  const [failed, setFailed] = useState(false);
  const initial = name.trim().slice(0, 1) || "员";
  return (
    <span className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-blue-50 font-semibold text-blue-700 ring-1 ring-blue-100 ${className}`}>
      <span aria-hidden="true">{initial}</span>
      {attachmentId && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/v2/attachments/${attachmentId}/content`}
          alt={`${name}头像`}
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : <span className="sr-only">{name}头像占位</span>}
    </span>
  );
}
