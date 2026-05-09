import { NextResponse } from "next/server";

import { BackendError, fetchBackend } from "@/shared/server/backend-client";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const invited = await fetchBackend("/admin/users/invite", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    return NextResponse.json(invited);
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Nao foi possivel incluir o usuario." }, { status: 500 });
  }
}
