import { NextResponse } from "next/server";

import { BackendError, fetchBackend } from "@/shared/server/backend-client";

type RouteContext = {
  params: Promise<{ userId: string }>;
};

export async function GET(_: Request, context: RouteContext) {
  try {
    const { userId } = await context.params;
    const roles = await fetchBackend(`/admin/users/${userId}/workflow-roles`);
    return NextResponse.json(roles);
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Nao foi possivel carregar os papeis do usuario." }, { status: 500 });
  }
}

export async function PUT(request: Request, context: RouteContext) {
  try {
    const { userId } = await context.params;
    const payload = await request.json();
    const roles = await fetchBackend(`/admin/users/${userId}/workflow-roles`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
    return NextResponse.json(roles);
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Nao foi possivel atualizar os papeis do usuario." }, { status: 500 });
  }
}
