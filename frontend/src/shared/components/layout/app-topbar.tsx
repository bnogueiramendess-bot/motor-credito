"use client";

import { useMemo } from "react";
import { usePathname } from "next/navigation";

function resolveTopbarMeta(pathname: string): { title: string; subtitle: string } {
  if (pathname.startsWith("/dashboard")) {
    return {
      title: "Dashboard",
      subtitle: "Visão operacional e ponto de partida"
    };
  }

  if (pathname.startsWith("/dados-externos")) {
    return {
      title: "Dados Externos",
      subtitle: "Evidências de consulta externa por análise"
    };
  }

  if (pathname.startsWith("/analises/nova")) {
    return {
      title: "Nova Análise de Crédito",
      subtitle: "Cadastro inicial, coleta de insumos e consolidação"
    };
  }

  if (/^\/analises\/\d+$/.test(pathname)) {
    return {
      title: "Análise de Crédito",
      subtitle: "Visão detalhada da decisão do motor"
    };
  }

  return {
    title: "Análises de Crédito",
    subtitle: "Acompanhamento das análises realizadas"
  };
}

export function AppTopbar() {
  const pathname = usePathname();
  const meta = useMemo(() => resolveTopbarMeta(pathname), [pathname]);

  return (
    <header className="sticky top-0 z-20 flex h-[52px] items-center justify-between border-b border-[#e2e5eb] bg-white px-4 lg:px-6">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-[#1a2b5e]">{meta.title}</p>
        <p className="hidden truncate text-[11px] text-[#6b7280] sm:block">{meta.subtitle}</p>
      </div>

      <div className="flex items-center gap-2">
        <div className="hidden text-[11px] text-[#6b7280] md:block">
          Analista: <strong className="font-medium text-[#374151]">Backoffice</strong>
        </div>
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#e8edf7] text-[11px] font-semibold text-[#1a2b5e]">BO</div>
      </div>
    </header>
  );
}
