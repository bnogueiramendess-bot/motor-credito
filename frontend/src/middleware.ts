import { NextRequest, NextResponse } from "next/server";

const ADMIN_RULES: Array<{ prefix: string; permission: string }> = [
  { prefix: "/admin/company", permission: "company:manage" },
  { prefix: "/company", permission: "company:manage" },
  { prefix: "/admin/empresa", permission: "company:manage" },
  { prefix: "/admin/business-units", permission: "bu:manage" },
  { prefix: "/company/business-units", permission: "bu:manage" },
  { prefix: "/admin/users", permission: "users:manage" },
  { prefix: "/admin/usuarios", permission: "users:manage" },
  { prefix: "/admin/configuracoes", permission: "profiles:view" }
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/login") || pathname.startsWith("/primeiro-acesso") || pathname.startsWith("/api/auth")) {
    return NextResponse.next();
  }

  const token = request.cookies.get("gcc_access_token")?.value;
  if (!token && (pathname.startsWith("/admin") || pathname.startsWith("/clientes") || pathname.startsWith("/motor-credito") || pathname.startsWith("/analises"))) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const rule = ADMIN_RULES.find((item) => pathname.startsWith(item.prefix));
  if (!rule) {
    return NextResponse.next();
  }

  const rawPermissions = request.cookies.get("gcc_permissions")?.value;
  const permissions = rawPermissions ? (JSON.parse(rawPermissions) as string[]) : [];
  if (!permissions.includes(rule.permission)) {
    return NextResponse.redirect(new URL("/clientes/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
