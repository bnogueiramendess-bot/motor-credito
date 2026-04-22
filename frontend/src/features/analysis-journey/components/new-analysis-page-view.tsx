"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";

import { listCustomers, lookupExternalCnpj, submitAnalysisJourney } from "@/features/analysis-journey/api/analysis-journey.api";
import { AnalysisJourneySubmitRequest, UploadFileMetadataInput } from "@/features/analysis-journey/api/contracts";
import {
  formatCnpj,
  formatCurrencyInputBRL,
  sanitizeDigits,
  toNullableNumberInput,
  toNumberInput
} from "@/features/analysis-journey/utils/formatters";
import { formatCurrencyBRL, resolveManualStatus, resolveUploadStatus } from "@/features/analysis-journey/utils/view-models";
import { ErrorState } from "@/shared/components/states/error-state";

const steps = ["Identificação do cliente", "Dados da solicitação", "Informações para análise", "Revisão e envio"];

type PrimarySource = "manual" | "internal" | "external";

function RequiredMark() {
  return <span className="ml-1 text-[#dc2626]">*</span>;
}

function mapFiles(input: FileList | null): UploadFileMetadataInput[] {
  if (!input) return [];
  return Array.from(input).map((file) => ({
    original_filename: file.name,
    mime_type: file.type || "application/octet-stream",
    file_size: file.size
  }));
}

function labelStatus(status: string) {
  if (status === "enviado" || status === "preenchido") return "border-[#bbf7d0] bg-[#f0fdf4] text-[#166534]";
  if (status.includes("não enviado") || status.includes("não preenchido")) return "border-[#fde68a] bg-[#fffbeb] text-[#92400e]";
  return "border-[#e5e7eb] bg-[#f9fafb] text-[#4b5563]";
}

export function NewAnalysisPageView() {
  const router = useRouter();
  const customersQuery = useQuery({ queryKey: ["customers"], queryFn: listCustomers });

  const [step, setStep] = useState(1);
  const [stepError, setStepError] = useState<string | null>(null);
  const [existingCustomerId, setExistingCustomerId] = useState<number | null>(null);
  const [externalLookupMessage, setExternalLookupMessage] = useState<string | null>(null);

  const [customer, setCustomer] = useState({
    companyName: "",
    cnpj: "",
    segment: "",
    region: "",
    relationshipStartDate: "",
    address: "",
    phone: "",
    email: ""
  });

  const [analysis, setAnalysis] = useState({
    requestedLimit: "R$ 0,00",
    currentLimit: "R$ 0,00",
    usedLimit: "R$ 0,00",
    guaranteeLimit: "R$ 0,00",
    assignedAnalystName: "Backoffice",
    comment: ""
  });

  const [primaryInputSource, setPrimaryInputSource] = useState<PrimarySource>("manual");
  const [manual, setManual] = useState({
    negativationsCount: "0",
    negativationsAmount: "R$ 0,00",
    protestsCount: "0",
    protestsAmount: "R$ 0,00",
    activeLawsuits: false,
    observations: "",
    comments: "",
    hasCommercialHistory: false,
    commercialHistoryRevenue: "R$ 0,00",
    contractualAvgTermDays: "",
    effectiveAvgTermDays: ""
  });
  const [ocr, setOcr] = useState({ enabled: false, additionalFields: "", files: [] as UploadFileMetadataInput[] });
  const [internalImport, setInternalImport] = useState({ notes: "", files: [] as UploadFileMetadataInput[] });
  const [externalImport, setExternalImport] = useState({
    sourceType: "serasa" as "agrisk" | "serasa" | "scr" | "other",
    notes: "",
    files: [] as UploadFileMetadataInput[]
  });

  const normalizedCnpj = sanitizeDigits(customer.cnpj);
  const matchedCustomers = useMemo(() => {
    if (!customersQuery.data || normalizedCnpj.length !== 14) return [];
    return customersQuery.data.filter((item) => sanitizeDigits(item.document_number) === normalizedCnpj);
  }, [customersQuery.data, normalizedCnpj]);

  const totalLimitCalculated = useMemo(() => {
    return toNumberInput(analysis.requestedLimit) + toNumberInput(analysis.currentLimit) + toNumberInput(analysis.usedLimit);
  }, [analysis.currentLimit, analysis.requestedLimit, analysis.usedLimit]);
  const exposureCalculated = useMemo(() => {
    return totalLimitCalculated - toNumberInput(analysis.guaranteeLimit);
  }, [analysis.guaranteeLimit, totalLimitCalculated]);
  const currencyFormatter = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  const totalLimitDisplay = currencyFormatter.format(totalLimitCalculated);
  const exposureDisplay = currencyFormatter.format(exposureCalculated);

  const submitMutation = useMutation({
    mutationFn: (payload: AnalysisJourneySubmitRequest) => submitAnalysisJourney(payload),
    onSuccess: (response) => router.push(`/analises/${response.analysis_id}`)
  });

  const lookupMutation = useMutation({
    mutationFn: (cnpj: string) => lookupExternalCnpj(cnpj),
    onSuccess: (response) => {
      if (response.status !== "ok" || !response.data) {
        setExternalLookupMessage(response.message ?? "Não foi possível consultar os dados externos no momento.");
        return;
      }

      const addr = response.data.address;
      const parts = [addr.logradouro, addr.numero, addr.complemento, addr.bairro, addr.municipio, addr.uf].filter(Boolean);
      const address = [parts.join(", "), addr.cep].filter(Boolean).join(" - ");

      setCustomer((prev) => ({
        ...prev,
        companyName: response.data?.razao_social || prev.companyName,
        phone: response.data?.telefone || prev.phone,
        email: response.data?.email || prev.email,
        address: address || prev.address
      }));
      setExternalLookupMessage("Dados cadastrais localizados automaticamente. Você poderá revisar e editar na próxima etapa.");
    },
    onError: () =>
      setExternalLookupMessage("A consulta externa está indisponível no momento. Se necessário, informe os dados manualmente.")
  });

  const manualStatus = resolveManualStatus({ ...manual, enabled: primaryInputSource === "manual" });
  const ocrStatus = resolveUploadStatus(ocr);
  const internalStatus = resolveUploadStatus({ enabled: primaryInputSource === "internal", files: internalImport.files });
  const externalStatus = resolveUploadStatus({ enabled: primaryInputSource === "external", files: externalImport.files });

  function reuseCustomer(customerId: number) {
    const target = customersQuery.data?.find((item) => item.id === customerId);
    if (!target) return;
    setExistingCustomerId(target.id);
    setCustomer((prev) => ({
      ...prev,
      companyName: target.company_name,
      cnpj: formatCnpj(target.document_number),
      segment: target.segment,
      region: target.region,
      relationshipStartDate: target.relationship_start_date ?? ""
    }));
  }

  function handleCnpjBlur() {
    if (existingCustomerId || normalizedCnpj.length !== 14) return;
    setExternalLookupMessage(null);
    lookupMutation.mutate(normalizedCnpj);
  }

  function validateStep(stepNumber: number): string | null {
    if (stepNumber === 1) {
      if (normalizedCnpj.length !== 14) return "Preencha um CNPJ válido para continuar.";
      if (!customer.companyName.trim()) return "Preencha a Razão social para continuar.";
    }

    if (stepNumber === 2) {
      if (toNumberInput(analysis.requestedLimit) <= 0) return "Preencha Limite solicitado com valor maior que zero.";
    }

    return null;
  }

  function navigateToStep(targetStep: number) {
    if (targetStep === step) return;

    if (targetStep < step) {
      setStepError(null);
      setStep(targetStep);
      return;
    }

    for (let s = step; s < targetStep; s += 1) {
      const error = validateStep(s);
      if (error) {
        setStepError(`Não é possível avançar para a etapa ${targetStep}. ${error}`);
        return;
      }
    }

    setStepError(null);
    setStep(targetStep);
  }

  function submit() {
    const payload: AnalysisJourneySubmitRequest = {
      existing_customer_id: existingCustomerId,
      customer: {
        company_name: customer.companyName,
        document_number: sanitizeDigits(customer.cnpj),
        segment: customer.segment,
        region: customer.region,
        relationship_start_date: customer.relationshipStartDate || null,
        address: customer.address,
        phone: customer.phone
      },
      analysis: {
        requested_limit: toNumberInput(analysis.requestedLimit),
        current_limit: toNumberInput(analysis.currentLimit),
        exposure_amount: exposureCalculated,
        annual_revenue_estimated: 0,
        assigned_analyst_name: analysis.assignedAnalystName
      },
      inputs: {
        manual: {
          enabled: primaryInputSource === "manual",
          negativations_count: Number(manual.negativationsCount || 0),
          negativations_amount: toNumberInput(manual.negativationsAmount),
          protests_count: Number(manual.protestsCount || 0),
          protests_amount: toNumberInput(manual.protestsAmount),
          active_lawsuits: manual.activeLawsuits,
          observations: manual.observations,
          comments: manual.comments,
          has_commercial_history: primaryInputSource === "manual" ? manual.hasCommercialHistory : false,
          commercial_history_revenue:
            primaryInputSource === "manual" && manual.hasCommercialHistory ? toNullableNumberInput(manual.commercialHistoryRevenue) : null,
          contractual_avg_term_days:
            primaryInputSource === "manual" && manual.hasCommercialHistory ? toNullableNumberInput(manual.contractualAvgTermDays) : null,
          effective_avg_term_days:
            primaryInputSource === "manual" && manual.hasCommercialHistory ? toNullableNumberInput(manual.effectiveAvgTermDays) : null
        },
        ocr: {
          enabled: ocr.enabled,
          active: null,
          liabilities: null,
          equity: null,
          gross_revenue: null,
          net_revenue: null,
          costs: null,
          expenses: null,
          profit: null,
          additional_fields: ocr.additionalFields,
          files: ocr.files
        },
        internal_import: {
          enabled: primaryInputSource === "internal",
          rows_count: null,
          template_validated: internalImport.files.length > 0,
          notes: internalImport.notes,
          files: internalImport.files
        },
        external_import: {
          enabled: primaryInputSource === "external",
          source_type: externalImport.sourceType,
          source_score: null,
          source_rating: "",
          negativations_count: 0,
          protests_count: 0,
          lawsuits_count: 0,
          has_restrictions: false,
          notes: externalImport.notes,
          files: externalImport.files
        }
      }
    };
    submitMutation.mutate(payload);
  }

  if (customersQuery.isError) {
    return <ErrorState title="Não foi possível carregar clientes" description={customersQuery.error.message} onRetry={() => customersQuery.refetch()} />;
  }

  const canContinue =
    step === 1
      ? normalizedCnpj.length === 14 && Boolean(customer.companyName)
      : step === 2
        ? toNumberInput(analysis.requestedLimit) > 0
        : true;

  return (
    <section className="readability-standard space-y-4">
      <div className="flex items-center justify-between rounded-[10px] border border-[#e2e5eb] bg-white p-4">
        <div>
          <p className="text-[16px] font-medium text-[#111827]">Nova análise de crédito</p>
          <p className="text-[12px] text-[#6b7280]">
            Identifique o cliente, informe os dados da solicitação e reúna as informações necessárias para análise de crédito.
          </p>
          <p className="mt-0.5 text-[11px] text-[#6b7280]">
            A consulta externa é opcional. Se necessário, os dados podem ser informados manualmente.
          </p>
        </div>
        <Link href="/analises" className="rounded-[6px] border border-[#d1d5db] px-3 py-2 text-[12px] text-[#374151] hover:bg-[#f9fafb]">
          Voltar para análises
        </Link>
      </div>

      <div className="grid gap-2 rounded-[10px] border border-[#e2e5eb] bg-white p-3 sm:grid-cols-2 xl:grid-cols-4">
        {steps.map((label, index) => (
          <button
            key={label}
            type="button"
            onClick={() => navigateToStep(index + 1)}
            className={`rounded-[8px] border px-3 py-2 text-left text-[11px] transition ${
              index + 1 === step ? "border-[#1a2b5e] bg-[#eef2ff] text-[#1a2b5e]" : "border-[#e5e7eb] bg-white text-[#6b7280] hover:bg-[#f9fafb]"
            }`}
          >
            {index + 1}. {label}
          </button>
        ))}
      </div>

      {stepError ? <div className="rounded-[8px] border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[12px] text-[#b91c1c]">{stepError}</div> : null}

      {step === 1 ? (
        <article className="space-y-3 rounded-[10px] border border-[#e2e5eb] bg-white p-4">
          <p className="text-[13px] font-medium text-[#111827]">Informe o CNPJ para identificar o cliente</p>
          <label className="block text-[12px] text-[#374151]">
            CNPJ<RequiredMark />
            <input
              value={customer.cnpj}
              onChange={(event) => {
                setExistingCustomerId(null);
                setCustomer((prev) => ({ ...prev, cnpj: formatCnpj(event.target.value) }));
              }}
              onBlur={handleCnpjBlur}
              className="mt-1 h-9 w-full rounded-[6px] border border-[#d1d5db] px-3 text-[12px]"
              placeholder="00.000.000/0000-00"
            />
          </label>
          <p className="text-[12px] text-[#6b7280]">
            {lookupMutation.isPending
              ? "Consultando dados cadastrais..."
              : externalLookupMessage ?? "A consulta externa é opcional. Se necessário, os dados podem ser informados manualmente."}
          </p>

          {matchedCustomers.map((item) => (
            <div key={item.id} className="flex items-center justify-between rounded-[8px] border border-[#bbf7d0] bg-[#f0fdf4] p-3 text-[12px]">
              <span>{item.company_name}</span>
              <button type="button" onClick={() => reuseCustomer(item.id)} className="rounded-[6px] bg-[#166534] px-3 py-1 text-[11px] text-white">
                Reaproveitar cadastro
              </button>
            </div>
          ))}

          <div className="rounded-[8px] border border-[#e2e5eb] bg-[#f9fafb] p-3">
            <p className="mb-2 text-[12px] font-medium text-[#111827]">Dados do cliente</p>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-[11px] text-[#374151]">Razão social<RequiredMark /><input value={customer.companyName} onChange={(event) => setCustomer((prev) => ({ ...prev, companyName: event.target.value }))} className="mt-1 h-9 w-full rounded-[6px] border px-3 text-[12px]" /></label>
              <label className="text-[11px] text-[#374151]">Segmento<input value={customer.segment} onChange={(event) => setCustomer((prev) => ({ ...prev, segment: event.target.value }))} className="mt-1 h-9 w-full rounded-[6px] border px-3 text-[12px]" /></label>
              <label className="text-[11px] text-[#374151]">Região<input value={customer.region} onChange={(event) => setCustomer((prev) => ({ ...prev, region: event.target.value }))} className="mt-1 h-9 w-full rounded-[6px] border px-3 text-[12px]" /></label>
              <label className="text-[11px] text-[#374151]">Data de relacionamento<input type="date" value={customer.relationshipStartDate} onChange={(event) => setCustomer((prev) => ({ ...prev, relationshipStartDate: event.target.value }))} className="mt-1 h-9 w-full rounded-[6px] border px-3 text-[12px]" /></label>
              <label className="text-[11px] text-[#374151]">Endereço<input value={customer.address} onChange={(event) => setCustomer((prev) => ({ ...prev, address: event.target.value }))} className="mt-1 h-9 w-full rounded-[6px] border px-3 text-[12px]" /></label>
              <label className="text-[11px] text-[#374151]">Telefone<input value={customer.phone} onChange={(event) => setCustomer((prev) => ({ ...prev, phone: event.target.value }))} className="mt-1 h-9 w-full rounded-[6px] border px-3 text-[12px]" /></label>
              <label className="text-[11px] text-[#374151] md:col-span-2">E-mail<input value={customer.email} onChange={(event) => setCustomer((prev) => ({ ...prev, email: event.target.value }))} className="mt-1 h-9 w-full rounded-[6px] border px-3 text-[12px]" /></label>
            </div>
          </div>
        </article>
      ) : null}

      {step >= 2 ? (
        <div className="rounded-[10px] border border-[#dbeafe] bg-[#f8fbff] px-4 py-3 text-[12px] text-[#334155]">
          <strong className="text-[#1a2b5e]">Cliente da solicitação:</strong> {customer.companyName || "Não informado"} · {customer.cnpj || "CNPJ não informado"}
        </div>
      ) : null}

      {step === 2 ? (
        <article className="space-y-3 rounded-[10px] border border-[#e2e5eb] bg-white p-4">
          <p className="text-[13px] font-medium text-[#111827]">Dados da solicitação</p>
          <p className="text-[12px] text-[#6b7280]">Informe os dados principais da solicitação de crédito antes de avançar.</p>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <label className="text-[11px] text-[#374151]">Limite solicitado<RequiredMark /><input value={analysis.requestedLimit} onChange={(event) => setAnalysis((prev) => ({ ...prev, requestedLimit: formatCurrencyInputBRL(event.target.value) }))} className="mt-1 h-9 w-full rounded-[6px] border px-3 text-[12px]" /></label>
            <label className="text-[11px] text-[#374151]">Limite atual<input value={analysis.currentLimit} onChange={(event) => setAnalysis((prev) => ({ ...prev, currentLimit: formatCurrencyInputBRL(event.target.value) }))} className="mt-1 h-9 w-full rounded-[6px] border px-3 text-[12px]" /></label>
            <label className="text-[11px] text-[#374151]">Limite utilizado<input value={analysis.usedLimit} onChange={(event) => setAnalysis((prev) => ({ ...prev, usedLimit: formatCurrencyInputBRL(event.target.value) }))} className="mt-1 h-9 w-full rounded-[6px] border px-3 text-[12px]" /></label>
            <label className="text-[11px] text-[#374151]">
              Limite com garantia
              <input value={analysis.guaranteeLimit} onChange={(event) => setAnalysis((prev) => ({ ...prev, guaranteeLimit: formatCurrencyInputBRL(event.target.value) }))} className="mt-1 h-9 w-full rounded-[6px] border px-3 text-[12px]" />
              <span className="mt-1 block text-[10px] text-[#6b7280]">Valor garantido por seguro ou alguma garantia real.</span>
            </label>
            <label className="text-[11px] text-[#374151]">Limite total<input value={totalLimitDisplay} readOnly className="mt-1 h-9 w-full rounded-[6px] border bg-[#f9fafb] px-3 text-[12px] text-[#6b7280]" /></label>
            <label className="text-[11px] text-[#374151]">Exposição<input value={exposureDisplay} readOnly className="mt-1 h-9 w-full rounded-[6px] border bg-[#f9fafb] px-3 text-[12px] text-[#6b7280]" /></label>
            <label className="text-[11px] text-[#374151]">Analista responsável
              <input value={analysis.assignedAnalystName} readOnly className="mt-1 h-9 w-full rounded-[6px] border bg-[#f9fafb] px-3 text-[12px] text-[#6b7280]" />
              <span className="mt-1 block text-[10px] text-[#6b7280]">Será preenchido automaticamente com o usuário logado quando o controle de acesso estiver ativo.</span>
            </label>
            <label className="text-[11px] text-[#374151] md:col-span-2 xl:col-span-3">Comentário
              <textarea value={analysis.comment} onChange={(event) => setAnalysis((prev) => ({ ...prev, comment: event.target.value }))} className="mt-1 min-h-16 w-full rounded-[6px] border px-3 py-2 text-[12px]" />
            </label>
          </div>
        </article>
      ) : null}

      {step === 3 ? (
        <article className="space-y-4 rounded-[10px] border border-[#e2e5eb] bg-white p-4">
          <div>
            <p className="text-[13px] font-medium text-[#111827]">Informações para análise</p>
            <p className="text-[12px] text-[#6b7280]">
              Selecione como deseja informar os dados da análise. Você pode utilizar uma ou mais fontes de informação.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            {([
              ["manual", "Manual", "Informar manualmente negativações, protestos, processos e histórico comercial."],
              ["internal", "Importação interna", "Importar base em Excel com títulos, vencimentos e pagamentos."],
              ["external", "Importação externa", "Enviar relatório ou dossiê de bureau para leitura assistida."]
            ] as [PrimarySource, string, string][]).map(([id, title, description]) => (
              <button key={id} type="button" onClick={() => setPrimaryInputSource(id)} className={`rounded-[8px] border p-3 text-left ${primaryInputSource === id ? "border-[#1a2b5e] bg-[#eef2ff]" : "border-[#e2e5eb] bg-white"}`}>
                <p className="text-[12px] font-medium text-[#111827]">{title}</p>
                <p className="mt-1 text-[11px] text-[#6b7280]">{description}</p>
              </button>
            ))}
          </div>

          <section className="space-y-2 rounded-[8px] border border-[#e2e5eb] bg-[#f9fafb] p-3">
            <div className="flex items-center justify-between">
              <p className="text-[12px] font-medium text-[#111827]">OCR DRE/Balanço (opcional)</p>
              <button type="button" onClick={() => setOcr((prev) => ({ ...prev, enabled: !prev.enabled }))} className={`rounded px-2 py-1 text-[10px] ${ocr.enabled ? "bg-[#1a2b5e] text-white" : "bg-[#e5e7eb] text-[#374151]"}`}>
                {ocr.enabled ? "Selecionado" : "Não selecionado"}
              </button>
            </div>
            <p className="text-[11px] text-[#6b7280]">Enviar demonstrações financeiras para leitura assistida.</p>
          </section>

          {primaryInputSource === "manual" ? (
            <section className="space-y-3 rounded-[8px] border border-[#e2e5eb] bg-[#f9fafb] p-3">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <label className="text-[11px] text-[#374151]">Quantidade de negativações<input type="number" min={0} value={manual.negativationsCount} onChange={(event) => setManual((prev) => ({ ...prev, negativationsCount: event.target.value }))} className="mt-1 h-9 w-full rounded-[6px] border px-3 text-[12px]" /></label>
                <label className="text-[11px] text-[#374151]">Valor total das negativações<input value={manual.negativationsAmount} onChange={(event) => setManual((prev) => ({ ...prev, negativationsAmount: formatCurrencyInputBRL(event.target.value) }))} className="mt-1 h-9 w-full rounded-[6px] border px-3 text-[12px]" /></label>
                <label className="text-[11px] text-[#374151]">Quantidade de protestos<input type="number" min={0} value={manual.protestsCount} onChange={(event) => setManual((prev) => ({ ...prev, protestsCount: event.target.value }))} className="mt-1 h-9 w-full rounded-[6px] border px-3 text-[12px]" /></label>
                <label className="text-[11px] text-[#374151]">Valor total dos protestos<input value={manual.protestsAmount} onChange={(event) => setManual((prev) => ({ ...prev, protestsAmount: formatCurrencyInputBRL(event.target.value) }))} className="mt-1 h-9 w-full rounded-[6px] border px-3 text-[12px]" /></label>
                <label className="text-[11px] text-[#374151]">Existem processos judiciais ativos?<select value={manual.activeLawsuits ? "sim" : "nao"} onChange={(event) => setManual((prev) => ({ ...prev, activeLawsuits: event.target.value === "sim" }))} className="mt-1 h-9 w-full rounded-[6px] border px-3 text-[12px]"><option value="nao">Não</option><option value="sim">Sim</option></select></label>
                <label className="text-[11px] text-[#374151] md:col-span-2 xl:col-span-3">Observações<textarea value={manual.observations} onChange={(event) => setManual((prev) => ({ ...prev, observations: event.target.value }))} className="mt-1 min-h-16 w-full rounded-[6px] border px-3 py-2 text-[12px]" /></label>
                <label className="text-[11px] text-[#374151] md:col-span-2 xl:col-span-3">Comentários<textarea value={manual.comments} onChange={(event) => setManual((prev) => ({ ...prev, comments: event.target.value }))} className="mt-1 min-h-16 w-full rounded-[6px] border px-3 py-2 text-[12px]" /></label>
              </div>
            </section>
          ) : null}

          {primaryInputSource === "internal" ? (
            <section className="space-y-2 rounded-[8px] border border-[#e2e5eb] bg-[#f9fafb] p-3">
              <div className="rounded-[8px] border border-[#dbeafe] bg-[#eff6ff] p-3">
                <p className="text-[12px] font-medium text-[#1e3a8a]">Template de importação interna</p>
                <p className="mt-1 text-[11px] text-[#334155]">Use este arquivo para padronizar a planilha antes do upload.</p>
                <p className="mt-2 text-[11px] text-[#475569]">Campos esperados: CNPJ, Razão Social, NF, Valor, Data de Emissão, Data de Vencimento, Data de Pagamento.</p>
                <div className="mt-3">
                  <Link href="/templates/importacao-interna-template.csv" className="inline-flex h-8 items-center rounded-[6px] bg-[#1a2b5e] px-3 text-[11px] font-medium text-white hover:bg-[#233a7d]">
                    Baixar template .csv
                  </Link>
                </div>
              </div>

              <label className="text-[11px] text-[#374151]">Upload da planilha<input type="file" multiple onChange={(event) => setInternalImport((prev) => ({ ...prev, files: mapFiles(event.target.files) }))} className="mt-1 block text-[12px]" /></label>
              <label className="text-[11px] text-[#374151]">Observações da importação interna<textarea value={internalImport.notes} onChange={(event) => setInternalImport((prev) => ({ ...prev, notes: event.target.value }))} className="mt-1 min-h-16 w-full rounded-[6px] border px-3 py-2 text-[12px]" /></label>
            </section>
          ) : null}

          {primaryInputSource === "external" ? (
            <section className="space-y-2 rounded-[8px] border border-[#e2e5eb] bg-[#f9fafb] p-3">
              <select value={externalImport.sourceType} onChange={(event) => setExternalImport((prev) => ({ ...prev, sourceType: event.target.value as "agrisk" | "serasa" | "scr" | "other" }))} className="h-9 w-full rounded-[6px] border px-3 text-[12px]">
                <option value="serasa">Serasa</option>
                <option value="agrisk">Agrisk</option>
                <option value="scr">SCR</option>
                <option value="other">Outra fonte</option>
              </select>
              <input type="file" multiple onChange={(event) => setExternalImport((prev) => ({ ...prev, files: mapFiles(event.target.files) }))} className="text-[12px]" />
              <textarea value={externalImport.notes} onChange={(event) => setExternalImport((prev) => ({ ...prev, notes: event.target.value }))} className="min-h-16 w-full rounded-[6px] border px-3 py-2 text-[12px]" />
            </section>
          ) : null}

          {ocr.enabled ? (
            <section className="space-y-2 rounded-[8px] border border-[#e2e5eb] bg-[#f9fafb] p-3">
              <input type="file" multiple onChange={(event) => setOcr((prev) => ({ ...prev, files: mapFiles(event.target.files) }))} className="text-[12px]" />
              <textarea value={ocr.additionalFields} onChange={(event) => setOcr((prev) => ({ ...prev, additionalFields: event.target.value }))} className="min-h-16 w-full rounded-[6px] border px-3 py-2 text-[12px]" />
            </section>
          ) : null}
        </article>
      ) : null}

      {step === 4 ? (
        <article className="space-y-4 rounded-[10px] border border-[#e2e5eb] bg-white p-4 text-[12px]">
          <div>
            <p className="text-[13px] font-medium text-[#111827]">Revise as informações antes de enviar para análise</p>
            <p className="text-[12px] text-[#6b7280]">Confira os dados do cliente, da solicitação e das informações complementares antes de seguir.</p>
          </div>

          <section className="rounded-[8px] border border-[#e5e7eb] p-3">
            <p>Razão social: <strong>{customer.companyName || "-"}</strong></p>
            <p>CNPJ: <strong>{customer.cnpj || "-"}</strong></p>
            <p>Endereço: <strong>{customer.address || "-"}</strong></p>
            <p>Telefone: <strong>{customer.phone || "-"}</strong></p>
            <p>E-mail: <strong>{customer.email || "-"}</strong></p>
          </section>

          <section className="rounded-[8px] border border-[#e5e7eb] p-3">
            <p>Limite solicitado: <strong>{formatCurrencyBRL(analysis.requestedLimit)}</strong></p>
            <p>Limite atual: <strong>{formatCurrencyBRL(analysis.currentLimit)}</strong></p>
            <p>Limite utilizado: <strong>{formatCurrencyBRL(analysis.usedLimit)}</strong></p>
            <p>Limite com garantia: <strong>{formatCurrencyBRL(analysis.guaranteeLimit)}</strong></p>
            <p>Limite total: <strong>{totalLimitDisplay}</strong></p>
            <p>Exposição: <strong>{exposureDisplay}</strong></p>
            <p>Analista responsável: <strong>{analysis.assignedAnalystName || "-"}</strong></p>
            <p>Comentário: <strong>{analysis.comment || "-"}</strong></p>
          </section>

          <section className="rounded-[8px] border border-[#e5e7eb] p-3">
            <div className={`rounded-[6px] border px-3 py-2 ${labelStatus(manualStatus)}`}>Manual: {manualStatus}</div>
            <div className={`mt-2 rounded-[6px] border px-3 py-2 ${labelStatus(ocrStatus)}`}>OCR DRE/Balanço: {ocrStatus}</div>
            <div className={`mt-2 rounded-[6px] border px-3 py-2 ${labelStatus(internalStatus)}`}>Importação interna: {internalStatus}</div>
            <div className={`mt-2 rounded-[6px] border px-3 py-2 ${labelStatus(externalStatus)}`}>Importação externa: {externalStatus}</div>
          </section>

          {primaryInputSource === "manual" ? (
            <section className="rounded-[8px] border border-[#e5e7eb] p-3">
              <p>Negativações: <strong>{manual.negativationsCount || "0"}</strong></p>
              <p>Valor total de negativações: <strong>{formatCurrencyBRL(manual.negativationsAmount)}</strong></p>
              <p>Protestos: <strong>{manual.protestsCount || "0"}</strong></p>
              <p>Valor total de protestos: <strong>{formatCurrencyBRL(manual.protestsAmount)}</strong></p>
              <p>Processos judiciais ativos: <strong>{manual.activeLawsuits ? "Sim" : "Não"}</strong></p>
              <p>Histórico comercial: <strong>{manual.hasCommercialHistory ? "Sim" : "Não"}</strong></p>
            </section>
          ) : null}

          {submitMutation.isError ? <p className="text-[#b91c1c]">{submitMutation.error.message}</p> : null}
        </article>
      ) : null}

      <div className="flex items-center justify-between rounded-[10px] border border-[#e2e5eb] bg-white p-3">
        <button type="button" onClick={() => setStep((prev) => Math.max(1, prev - 1))} disabled={step === 1} className="rounded-[6px] border border-[#d1d5db] px-3 py-2 text-[12px] text-[#374151] disabled:opacity-50">
          Voltar
        </button>
        {step < 4 ? (
          <button type="button" onClick={() => navigateToStep(Math.min(4, step + 1))} disabled={!canContinue} className="rounded-[6px] bg-[#1a2b5e] px-3 py-2 text-[12px] font-medium text-white disabled:opacity-50">
            Avançar
          </button>
        ) : (
          <button type="button" onClick={submit} disabled={submitMutation.isPending} className="rounded-[6px] bg-[#059669] px-3 py-2 text-[12px] font-medium text-white disabled:opacity-50">
            {submitMutation.isPending ? "Enviando..." : "Enviar para análise"}
          </button>
        )}
      </div>
    </section>
  );
}
