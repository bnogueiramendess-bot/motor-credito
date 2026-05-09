import { NextResponse } from "next/server";

import { BackendError, fetchBackend } from "@/shared/server/backend-client";

type RouteContext = {
  params: Promise<{ userId: string }>;
};

export async function POST(_: Request, context: RouteContext) {
  try {
    const { userId } = await context.params;
    const token = await fetchBackend(`/admin/users/${userId}/invite-token`, {
      method: "POST"
    });
    return NextResponse.json(token);
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Nao foi possivel gerar novo token de acesso." }, { status: 500 });
  }
}
