import { ReactNode } from "react";

import { AppSidebar } from "@/shared/components/layout/app-sidebar";
import { AppTopbar } from "@/shared/components/layout/app-topbar";

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="min-h-screen bg-[#f0f2f5] text-[#111827]">
      <div className="flex min-h-screen">
        <AppSidebar />
        <div className="flex min-h-screen min-w-0 flex-1 flex-col">
          <AppTopbar />
          <main className="flex-1 overflow-y-auto px-3 py-4 sm:px-4 lg:px-6">{children}</main>
        </div>
      </div>
    </div>
  );
}
