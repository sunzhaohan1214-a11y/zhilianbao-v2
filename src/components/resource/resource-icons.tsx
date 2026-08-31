import type { SVGProps } from "react";

type Props = SVGProps<SVGSVGElement>;
const base = { "aria-hidden": true, fill: "none", stroke: "currentColor", strokeLinecap: "round" as const, strokeLinejoin: "round" as const, strokeWidth: 1.8, viewBox: "0 0 24 24" };

export function EnterpriseResourceIcon(props: Props) { return <svg {...base} {...props}><path d="M4 21V7l8-4 8 4v14M8 21v-5h8v5M8 9h.01M12 9h.01M16 9h.01M8 12h.01M12 12h.01M16 12h.01" /></svg>; }
export function MemberResourceIcon(props: Props) { return <svg {...base} {...props}><circle cx="9" cy="8" r="3.5" /><path d="M2.8 20a6.2 6.2 0 0 1 12.4 0M15 5.2a3.5 3.5 0 0 1 0 6.6M17 14.5a5.7 5.7 0 0 1 4.2 5.5" /></svg>; }
export function PolicyResourceIcon(props: Props) { return <svg {...base} {...props}><path d="M6 3h9l3 3v15H6zM15 3v4h4M9 11h6M9 15h6M9 19h4" /></svg>; }
export function TalentResourceIcon(props: Props) { return <svg {...base} {...props}><path d="m12 3 2.2 4.6 5 .7-3.6 3.6.9 5.1-4.5-2.4L7.5 17l.9-5.1-3.6-3.6 5-.7z" /></svg>; }
export function ContactResourceIcon(props: Props) { return <svg {...base} {...props}><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 2v3M16 2v3M8 10h8M8 14h8M8 18h5" /></svg>; }
