"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, LayoutDashboard } from "lucide-react";

import { cn } from "@/shared/lib/utils";

const navItems = [
  {
    href: "/analises",
    label: "Analise de credito",
    icon: LayoutDashboard
  }
];

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-64 border-r border-border/80 bg-white/70 lg:block">
      <div className="flex h-16 items-center gap-2 border-b border-border/80 px-6">
        <div className="rounded-md bg-slate-900 p-1.5 text-white">
          <Building2 className="h-4 w-4" />
        </div>
        <div>
          <p className="text-sm font-semibold">Motor Credito</p>
          <p className="text-xs text-muted-foreground">Painel operacional</p>
        </div>
      </div>
      <nav className="space-y-2 p-3">
        {navItems.map((item) => {
          const isActive = pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              )}
            >
              <item.icon className="h-4 w-4" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
