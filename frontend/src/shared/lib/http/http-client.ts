export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function parseError(response: Response) {
  try {
    const data = (await response.json()) as { detail?: string; message?: string };
    return data.detail ?? data.message ?? "Erro inesperado ao processar a requisição.";
  } catch {
    return "Erro inesperado ao processar a requisição.";
  }
}

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    if (response.status === 401 && typeof window !== "undefined") {
      window.location.href = "/login";
    }
    throw new ApiError(await parseError(response), response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const contentLength = response.headers.get("content-length");
  if (contentLength === "0") {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export const apiClient = {
  get: <T>(url: string) => request<T>(url, { method: "GET" }),
  post: <TResponse, TBody>(url: string, body: TBody) =>
    request<TResponse>(url, {
      method: "POST",
      body: JSON.stringify(body)
    }),
  patch: <TResponse, TBody>(url: string, body: TBody) =>
    request<TResponse>(url, {
      method: "PATCH",
      body: JSON.stringify(body)
    }),
  delete: <TResponse = void>(url: string) => request<TResponse>(url, { method: "DELETE" })
};
