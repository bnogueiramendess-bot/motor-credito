"use client";

import Link from "next/link";
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

export function AppTopNavigation() {
  const pathname = usePathname();

  return (
    <nav aria-label="Navegação principal" className="border-t border-[#eef1f6] bg-[#fcfdff] px-4 sm:px-6 lg:px-8">
      <div className="mx-auto flex h-12 w-full max-w-[1520px] items-center gap-2">
        {navItems.map((item) => {
          const active = isActivePath(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "inline-flex h-8 items-center rounded-full px-4 text-sm font-medium transition-colors",
                active ? "bg-[#1a2b5e] text-white" : "text-[#4b5563] hover:bg-[#eef2f9] hover:text-[#111827]"
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
