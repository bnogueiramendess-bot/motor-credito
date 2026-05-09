import { NextResponse } from "next/server";

import { BackendError, fetchBackend } from "@/shared/server/backend-client";

type RouteContext = {
  params: Promise<{ userId: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { userId } = await context.params;
    const payload = await request.json();
    const user = await fetchBackend(`/admin/users/${userId}/status`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
    return NextResponse.json(user);
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Nao foi possivel atualizar o status do usuario." }, { status: 500 });
  }
}
