import { ReactNode } from "react";

import { AppShell } from "@/shared/components/layout/app-shell";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
