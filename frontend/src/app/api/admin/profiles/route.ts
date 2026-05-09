import { NextResponse } from "next/server";

import { BackendError, fetchBackend } from "@/shared/server/backend-client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const profiles = await fetchBackend("/admin/profiles");
    return NextResponse.json(profiles);
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Nao foi possivel carregar os perfis." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const profile = await fetchBackend("/admin/profiles", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    return NextResponse.json(profile, { status: 201 });
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Nao foi possivel salvar o perfil." }, { status: 500 });
  }
}
