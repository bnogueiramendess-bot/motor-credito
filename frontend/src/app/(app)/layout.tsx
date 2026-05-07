import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ReactNode } from "react";

import { AppShell } from "@/shared/components/layout/app-shell";
import { ACCESS_TOKEN_COOKIE } from "@/shared/server/auth-cookies";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const token = cookies().get(ACCESS_TOKEN_COOKIE)?.value;
  if (!token) {
    redirect("/login");
  }

  return <AppShell>{children}</AppShell>;
}
