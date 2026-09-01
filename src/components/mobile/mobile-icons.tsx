import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const common = {
  "aria-hidden": true,
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  strokeWidth: 1.8,
  viewBox: "0 0 24 24",
};

export function HomeIcon(props: IconProps) {
  return <svg {...common} {...props}><path d="m3.5 10.7 8.5-7 8.5 7" /><path d="M5.5 9.2v10.3h13V9.2M9.3 19.5v-6.2h5.4v6.2" /></svg>;
}

export function DemandIcon(props: IconProps) {
  return <svg {...common} {...props}><path d="M7 4.5h10M7 9.5h10M7 14.5h6" /><path d="M5 2.8h14a2 2 0 0 1 2 2v14.4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4.8a2 2 0 0 1 2-2Z" /><path d="m15.5 18 1.7 1.7 3.3-3.7" /></svg>;
}

export function ResourceIcon(props: IconProps) {
  return <svg {...common} {...props}><path d="M4 20V7.5L12 3l8 4.5V20" /><path d="M8 20v-5h8v5M8 9h.01M12 9h.01M16 9h.01M8 12h.01M12 12h.01M16 12h.01" /></svg>;
}

export function ProfileIcon(props: IconProps) {
  return <svg {...common} {...props}><circle cx="12" cy="8" r="4" /><path d="M4.5 21a7.5 7.5 0 0 1 15 0" /></svg>;
}
