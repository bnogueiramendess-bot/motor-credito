"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { usePathname } from "next/navigation";

import { cn } from "@/shared/lib/utils";

type NavItem = {
  href: string;
  label: string;
};

type NavGroup = {
  id: string;
  label: string;
  activePrefix: string;
  items: NavItem[];
};

const navGroups: NavGroup[] = [
  {
    id: "clientes",
    label: "Clientes",
    activePrefix: "/clientes",
    items: [
      { href: "/clientes/dashboard", label: "Dashboard" },
      { href: "/clientes/carteira", label: "Carteira de Clientes" }
    ]
  },
  {
    id: "motor-credito",
    label: "Motor de Crédito",
    activePrefix: "/motor-credito",
    items: [
      { href: "/motor-credito/dashboard", label: "Dashboard" },
      { href: "/motor-credito/regras", label: "Regras" }
    ]
  }
];

function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function resolveTopbarMeta(pathname: string): { title: string; subtitle: string } {
  if (pathname.startsWith("/clientes/dashboard")) {
    return {
      title: "Clientes · Dashboard",
      subtitle: "Visão de clientes"
    };
  }

  if (pathname.startsWith("/clientes/carteira")) {
    return {
      title: "Clientes · Carteira de Clientes",
      subtitle: "Consulta operacional da carteira"
    };
  }

  if (pathname.startsWith("/motor-credito/dashboard") || pathname.startsWith("/dashboard")) {
    return {
      title: "Motor de Crédito · Dashboard",
      subtitle: "Visão executiva"
    };
  }

  if (pathname.startsWith("/motor-credito/regras") || pathname.startsWith("/regras")) {
    return {
      title: "Motor de Crédito · Regras",
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
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const openGroup = navGroups.find((group) => group.id === openGroupId) ?? null;

  function toggleGroup(groupId: string) {
    setOpenGroupId((current) => (current === groupId ? null : groupId));
  }

  return (
    <header className="sticky top-0 z-30 border-b border-[#334155] bg-[#0B132B] shadow-[0_3px_14px_rgba(2,6,23,0.22)]">
      <div className="mx-auto w-full max-w-[1520px] px-4 sm:px-6 lg:px-8">
        <div className="flex h-[82px] items-center gap-4">
          <div className="min-w-0 shrink-0 pr-1">
            <p className="truncate text-lg font-semibold tracking-[-0.01em] text-[#FFFFFF]">Motor de Crédito</p>
            <p className="truncate text-[11px] font-medium uppercase tracking-[0.08em] text-[#CBD5E1]">{meta.title}</p>
          </div>

          <div className="hidden h-8 w-px bg-[#334155] lg:block" aria-hidden="true" />

          <nav aria-label="Navegação principal" className="hidden min-w-0 flex-1 items-center gap-3 lg:flex">
            {navGroups.map((group) => {
              const menuId = `topbar-submenu-${group.id}`;
              const isOpen = openGroupId === group.id;
              const groupActive = pathname.startsWith(group.activePrefix);

              return (
                <button
                  key={group.id}
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={menuId}
                  onClick={() => toggleGroup(group.id)}
                  className={cn(
                    "inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#93C5FD] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B132B]",
                    groupActive
                      ? "bg-[#1E3A8A] text-white shadow-[0_1px_4px_rgba(30,58,138,0.36)]"
                      : "text-[#E2E8F0] hover:bg-[#334155] hover:text-white"
                  )}
                >
                  {group.label}
                  <span className={cn("text-[10px] transition-transform", isOpen ? "rotate-180" : "rotate-0")} aria-hidden="true">
                    ▾
                  </span>
                </button>
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

        <div
          id={openGroup ? `topbar-submenu-${openGroup.id}` : undefined}
          className={cn(
            "hidden lg:block overflow-hidden border-t border-[#334155]/80 transition-all duration-200",
            openGroup ? "max-h-16 opacity-100 py-2" : "max-h-0 opacity-0 py-0 border-t-transparent"
          )}
        >
          {openGroup ? (
            <nav aria-label={`Submenu ${openGroup.label}`} className="flex items-center gap-2">
              {openGroup.items.map((item) => {
                const active = isActivePath(pathname, item.href);

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "inline-flex h-8 items-center rounded-md px-3 text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#93C5FD] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B132B]",
                      active
                        ? "bg-[#1E3A8A]/70 text-white shadow-[inset_0_0_0_1px_rgba(147,197,253,0.25)]"
                        : "text-[#CBD5E1] hover:bg-[#22345F] hover:text-white"
                    )}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          ) : null}
        </div>
      </div>
    </header>
  );
}
