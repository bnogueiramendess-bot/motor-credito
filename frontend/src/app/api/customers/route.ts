import { NextResponse } from "next/server";

import { CustomerDto } from "@/features/credit-analyses/api/contracts";
import { BackendError, fetchBackend } from "@/shared/server/backend-client";

type CustomerCreateRequest = {
  company_name: string;
  document_number: string;
  segment: string;
  region: string;
  relationship_start_date?: string | null;
};

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const customers = await fetchBackend<CustomerDto[]>("/customers");
    return NextResponse.json(customers);
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Falha ao carregar clientes." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let payload: CustomerCreateRequest;

  try {
    payload = (await request.json()) as CustomerCreateRequest;
  } catch {
    return NextResponse.json({ detail: "Payload inválido." }, { status: 400 });
  }

  try {
    const created = await fetchBackend<CustomerDto>("/customers", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Falha ao criar cliente." }, { status: 500 });
  }
}
