"use client";

import Link from "next/link";
import { useMemo } from "react";
import { usePathname } from "next/navigation";

import { cn } from "@/shared/lib/utils";

type NavItem = {
  href: string;
  label: string;
};

const navItems: NavItem[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/regras", label: "Regras" },
  { href: "/relatorios", label: "Relatórios" }
];

function isActivePath(pathname: string, href: string) {
  if (href === "/dashboard") {
    return pathname.startsWith("/dashboard");
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

function resolveTopbarMeta(pathname: string): { title: string; subtitle: string } {
  if (pathname.startsWith("/dashboard")) {
    return {
      title: "Dashboard",
      subtitle: "Visão executiva"
    };
  }

  if (pathname.startsWith("/regras")) {
    return {
      title: "Regras",
      subtitle: "Políticas e critérios"
    };
  }

  if (pathname.startsWith("/relatorios")) {
    return {
      title: "Relatórios",
      subtitle: "Desempenho e histórico"
    };
  }

  if (pathname.startsWith("/dados-externos")) {
    return {
      title: "Dados Externos",
      subtitle: "Evidências da análise"
    };
  }

  if (pathname.startsWith("/analises/nova")) {
    return {
      title: "Nova Análise",
      subtitle: "Cadastro e consolidação"
    };
  }

  if (/^\/analises\/\d+$/.test(pathname)) {
    return {
      title: "Análise de Crédito",
      subtitle: "Detalhamento da decisão"
    };
  }

  return {
    title: "Análises de Crédito",
    subtitle: "Acompanhamento operacional"
  };
}

export function AppTopbar() {
  const pathname = usePathname();
  const meta = useMemo(() => resolveTopbarMeta(pathname), [pathname]);

  return (
    <header className="sticky top-0 z-30 border-b border-[#334155] bg-[#0B132B] shadow-[0_3px_14px_rgba(2,6,23,0.22)]">
      <div className="mx-auto flex h-[82px] w-full max-w-[1520px] items-center gap-4 px-4 sm:px-6 lg:px-8">
        <div className="min-w-0 shrink-0 pr-1">
          <p className="truncate text-lg font-semibold tracking-[-0.01em] text-[#FFFFFF]">Motor de Crédito</p>
          <p className="truncate text-[11px] font-medium uppercase tracking-[0.08em] text-[#CBD5E1]">{meta.title}</p>
        </div>

        <div className="hidden h-8 w-px bg-[#334155] lg:block" aria-hidden="true" />

        <nav aria-label="Navegação principal" className="hidden min-w-0 flex-1 items-center gap-2 lg:flex">
          {navItems.map((item) => {
            const active = isActivePath(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "inline-flex h-9 items-center rounded-full px-4 text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#93C5FD] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B132B]",
                  active
                    ? "bg-[#1E3A8A] text-white shadow-[0_1px_4px_rgba(30,58,138,0.36)]"
                    : "text-[#E2E8F0] hover:bg-[#334155] hover:text-white"
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="hidden h-8 w-px bg-[#334155] xl:block" aria-hidden="true" />

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <Link
            href="/analises/nova"
            className="inline-flex h-11 items-center rounded-xl bg-white px-5 text-sm font-semibold text-[#0B132B] shadow-[0_2px_8px_rgba(2,6,23,0.24)] transition hover:bg-[#F8FAFC]"
          >
            Nova análise
          </Link>
          <Link
            href="/analises"
            className="hidden h-10 items-center rounded-xl border border-[#E2E8F0]/70 bg-white/5 px-4 text-sm font-semibold text-[#E2E8F0] transition hover:bg-white/10 md:inline-flex"
          >
            Localizar análise
          </Link>

          <div className="hidden items-center gap-2 rounded-xl border border-[#E2E8F0]/25 bg-white/5 px-2.5 py-1.5 xl:flex">
            <div className="text-right text-xs text-[#CBD5E1]">
              <p className="font-medium text-[#E2E8F0]">{meta.subtitle}</p>
              <p>Analista Backoffice</p>
            </div>
            <div className="flex h-8 w-8 items-center justify-center rounded-full border border-[#E2E8F0]/35 bg-[#1E3A8A] text-[11px] font-semibold text-white">BO</div>
          </div>

          <div className="flex h-9 w-9 items-center justify-center rounded-full border border-[#E2E8F0]/35 bg-[#1E3A8A] text-xs font-semibold text-white xl:hidden">BO</div>
        </div>
      </div>
    </header>
  );
}