import { ReactNode } from "react";

import { AppTopbar } from "@/shared/components/layout/app-topbar";

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="min-h-screen bg-[#f4f6fa] text-[#111827]">
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <AppTopbar />
        <main className="flex-1 px-4 pb-8 pt-7 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-[1520px]">{children}</div>
        </main>
      </div>
    </div>
  );
}

