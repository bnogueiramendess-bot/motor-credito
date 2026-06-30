import { NextRequest, NextResponse } from "next/server";

const ADMIN_RULES: Array<{ prefix: string }> = [
  { prefix: "/admin/company" },
  { prefix: "/company" },
  { prefix: "/admin/empresa" },
  { prefix: "/admin/business-units" },
  { prefix: "/company/business-units" },
  { prefix: "/admin/users" },
  { prefix: "/admin/usuarios" },
  { prefix: "/admin/configuracoes" },
  { prefix: "/admin/profiles" },
  { prefix: "/admin/approval-matrix" },
  { prefix: "/admin/committees" },
  { prefix: "/admin/matriz-aprovacao" }
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

  const isAdministrator = (request.cookies.get("gcc_is_administrator")?.value ?? "false").toLowerCase() === "true";
  if (pathname.startsWith("/admin/profiles")) {
    return NextResponse.redirect(new URL("/admin/users", request.url));
  }
  if (!isAdministrator) {
    return NextResponse.redirect(new URL("/clientes/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
