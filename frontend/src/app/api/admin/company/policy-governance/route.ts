import { NextResponse } from "next/server";

import { fetchBackend } from "@/shared/server/backend-client";

export async function GET() {
  try {
    const payload = await fetchBackend("/admin/company/policy-governance");
    return NextResponse.json(payload);
  } catch {
    return NextResponse.json({ detail: "Nao foi possivel carregar a governanca de politicas." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const payload = await fetchBackend("/admin/company/policy-governance", {
      method: "PUT",
      body: JSON.stringify(body),
    });
    return NextResponse.json(payload);
  } catch {
    return NextResponse.json({ detail: "Nao foi possivel salvar a governanca de politicas." }, { status: 500 });
  }
}
