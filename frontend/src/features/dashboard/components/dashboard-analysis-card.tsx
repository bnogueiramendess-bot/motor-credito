"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { useEffect, useState } from "react";

import { Badge } from "@/shared/components/ui/badge";
import { DashboardAnalysisCardViewModel } from "@/features/dashboard/utils/dashboard-analysis-view-models";
import { getEffectivePermissions, hasPermission } from "@/shared/lib/auth/permissions";

type DashboardAnalysisCardProps = {
  analysis: DashboardAnalysisCardViewModel;
};

function statusVariant(tone: DashboardAnalysisCardViewModel["statusTone"]) {
  if (tone === "success") {
    return "success";
  }
  if (tone === "danger") {
    return "danger";
  }
  return "warning";
}

function scoreAccentClass(scoreBand: DashboardAnalysisCardViewModel["scoreBand"]) {
  if (scoreBand === "A") {
    return "border-emerald-300";
  }
  if (scoreBand === "B") {
    return "border-blue-300";
  }
  if (scoreBand === "C") {
    return "border-amber-300";
  }
  if (scoreBand === "D") {
    return "border-rose-300";
  }
  return "border-slate-300";
}

function scoreToneClass(tone: DashboardAnalysisCardViewModel["scoreTone"]) {
  if (tone === "positive") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (tone === "good") {
    return "border-cyan-200 bg-cyan-50 text-cyan-700";
  }
  if (tone === "warning") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  if (tone === "danger") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }
  return "border-slate-200 bg-slate-50 text-slate-700";
}

export function DashboardAnalysisCard({ analysis }: DashboardAnalysisCardProps) {
  const [permissions, setPermissions] = useState<string[]>([]);

  useEffect(() => {
    setPermissions(getEffectivePermissions());
  }, []);

  const canViewDossier = hasPermission("clients.dossier.view", permissions);

  return (
    <article
      className={`flex h-full min-h-[252px] flex-col rounded-2xl border-2 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${scoreAccentClass(analysis.scoreBand)}`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 truncate text-base font-semibold text-[#111827]">{analysis.companyName}</p>
        <Badge className="px-2.5 py-1 text-[11px] font-semibold" variant={statusVariant(analysis.statusTone)}>
          {analysis.statusLabel}
        </Badge>
      </div>

      <p className="mt-1 text-sm text-[#6b7280]">{analysis.documentNumber}</p>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className={`rounded-xl border px-3 py-3 ${scoreToneClass(analysis.scoreTone)}`}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.05em]">Score</p>
          <p className="mt-1 text-2xl font-bold leading-none">{analysis.scoreLabel}</p>
          <p className="mt-1 text-[11px]">{analysis.scoreBand ? `Faixa ${analysis.scoreBand}` : "Sem faixa"}</p>
        </div>

        <div className="rounded-xl border border-[#dde5f3] bg-[#f7f9fd] px-3 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[#64748b]">Limite recomendado</p>
          <p className="mt-1 text-xl font-bold leading-tight text-[#0f172a] md:text-2xl">{analysis.limitLabel}</p>
        </div>
      </div>

      <div className="mt-auto flex items-center justify-between border-t border-[#eef1f6] pt-4">
        <p className="text-xs font-medium text-[#6b7280]">Análise #{analysis.id}</p>
        {canViewDossier ? (
          <Link
            href={`/analises/${analysis.id}`}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#c9d5ec] bg-[#f4f7ff] px-3 text-sm font-semibold text-[#1a2b5e] transition hover:border-[#b3c5e8] hover:bg-[#ebf1ff]"
          >
            Abrir análise
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        ) : null}
      </div>
    </article>
  );
}
