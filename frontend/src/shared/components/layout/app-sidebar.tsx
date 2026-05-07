"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CircleDot, ClipboardList, Cog, FileClock, Files, LayoutGrid, LucideIcon } from "lucide-react";

import { cn } from "@/shared/lib/utils";

type NavItem = {
  label: string;
  icon: LucideIcon;
  href?: string;
};

type NavSection = {
  label: string;
  items: NavItem[];
};

const navSections: NavSection[] = [
  {
    label: "Principal",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutGrid },
      { href: "/analises", label: "Análise de Crédito", icon: ClipboardList },
      { label: "Fila de Análises", icon: ClipboardList }
    ]
  },
  {
    label: "Configuração",
    items: [
      { label: "Regras de Crédito", icon: Cog },
      { label: "Importação Auto.", icon: Files },
      { href: "/dados-externos", label: "Dados Externos", icon: CircleDot }
    ]
  },
  {
    label: "Auditoria",
    items: [{ label: "Log / Histórico", icon: FileClock }]
  }
];

function NavEntry({ href, label, icon: Icon, isActive }: NavItem & { isActive: boolean }) {
  const className = cn(
    "group flex min-h-8 items-center gap-2 rounded-none border-r-2 px-4 text-xs font-medium transition-colors",
    isActive
      ? "border-r-[#2ecc9b] bg-white/10 text-white"
      : "border-r-transparent text-white/60 hover:bg-white/10 hover:text-white"
  );

  if (!href) {
    return (
      <div className={cn(className, "cursor-default")}>
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span>{label}</span>
      </div>
    );
  }

  return (
    <Link href={href} className={className}>
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span>{label}</span>
    </Link>
  );
}

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-[220px] min-w-[220px] flex-col bg-[#1a2b5e] lg:flex">
      <div className="border-b border-white/10 px-4 pb-4 pt-5">
        <p className="text-base font-medium tracking-[-0.02em] text-white">Gestão de Carteira de Clientes</p>
        <p className="mt-0.5 text-[10px] text-white/45">Adfert · Indorama Corporation</p>
      </div>

      {navSections.map((section) => (
        <section key={section.label} className="py-3">
          <p className="px-4 pb-1.5 text-[10px] font-medium uppercase tracking-[0.05em] text-white/35">{section.label}</p>
          <div className="space-y-0.5">
            {section.items.map((item) => {
              const isActive = item.href ? pathname.startsWith(item.href) : false;
              return <NavEntry key={item.label} {...item} isActive={isActive} />;
            })}
          </div>
        </section>
      ))}
    </aside>
  );
}
