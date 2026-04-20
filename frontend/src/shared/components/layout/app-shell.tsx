import { ReactNode } from "react";

import { AppSidebar } from "@/shared/components/layout/app-sidebar";
import { AppTopbar } from "@/shared/components/layout/app-topbar";

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_right,_#e2e8f0,_transparent_35%),linear-gradient(180deg,#f8fafc_0%,#f1f5f9_100%)]">
      <div className="mx-auto flex min-h-screen max-w-[1600px]">
        <AppSidebar />
        <div className="flex min-h-screen flex-1 flex-col">
          <AppTopbar />
          <main className="flex-1 p-4 md:p-6">{children}</main>
        </div>
      </div>
    </div>
  );
}
