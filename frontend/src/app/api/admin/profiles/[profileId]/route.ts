import { NextResponse } from "next/server";

import { BackendError, fetchBackend } from "@/shared/server/backend-client";

type RouteContext = {
  params: Promise<{ profileId: string }>;
};

export async function GET(_: Request, context: RouteContext) {
  try {
    const { profileId } = await context.params;
    const profile = await fetchBackend(`/admin/profiles/${profileId}`);
    return NextResponse.json(profile);
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Nao foi possivel carregar o perfil." }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { profileId } = await context.params;
    const payload = await request.json();
    const profile = await fetchBackend(`/admin/profiles/${profileId}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
    return NextResponse.json(profile);
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Nao foi possivel salvar o perfil." }, { status: 500 });
  }
}
