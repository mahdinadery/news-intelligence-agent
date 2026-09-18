import type { ReactNode } from "react";

type DashboardCardProps = {
  label: string;
  value: ReactNode;
  detail?: string;
  icon: ReactNode;
  accent: "blue" | "violet" | "amber" | "slate";
};

const accentClasses = {
  blue: "bg-blue-50 text-blue-600",
  violet: "bg-violet-50 text-violet-600",
  amber: "bg-amber-50 text-amber-600",
  slate: "bg-slate-100 text-slate-600",
};

export function DashboardCard({ label, value, detail, icon, accent }: DashboardCardProps) {
  return (
    <article className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-200/40">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-slate-500">{label}</p>
          <p className="mt-4 text-2xl font-bold tracking-tight text-slate-950">{value}</p>
          {detail ? <p className="mt-2 text-xs text-slate-400">{detail}</p> : null}
        </div>
        <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${accentClasses[accent]}`}>
          {icon}
        </div>
      </div>
    </article>
  );
}
