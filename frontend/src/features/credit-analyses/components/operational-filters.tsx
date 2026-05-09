import { CreditAnalysisQueueOptionsResponse } from "@/features/credit-analyses/api/contracts";

type FiltersValue = {
  q: string;
  status: string;
  bu: string;
  analysis_type: string;
  requester: string;
  assigned_analyst: string;
  date_from: string;
  date_to: string;
};

type OperationalFiltersProps = {
  value: FiltersValue;
  onChange: (next: FiltersValue) => void;
  options: CreditAnalysisQueueOptionsResponse | null;
  isLoadingOptions: boolean;
  isErrorOptions: boolean;
};

export function OperationalFilters({ value, onChange, options, isLoadingOptions, isErrorOptions }: OperationalFiltersProps) {
  function setField<K extends keyof FiltersValue>(key: K, next: FiltersValue[K]) {
    onChange({ ...value, [key]: next });
  }

  return (
    <div className="rounded-[12px] border border-[#D7E1EC] bg-white p-4">
      {isLoadingOptions ? <p className="mb-3 text-[11px] text-[#4F647A]">Carregando opções de filtros...</p> : null}
      {isErrorOptions ? <p className="mb-3 text-[11px] text-[#B91C1C]">Não foi possível carregar opções de filtros. Você pode continuar com busca textual.</p> : null}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <input value={value.q} onChange={(e) => setField("q", e.target.value)} placeholder="Buscar por cliente/CNPJ/análise" className="h-10 rounded-[8px] border border-[#D7E1EC] px-3 text-[12px]" />
        <select value={value.status} onChange={(e) => setField("status", e.target.value)} className="h-10 rounded-[8px] border border-[#D7E1EC] px-3 text-[12px]">
          <option value="">Status (todos)</option>
          {(options?.statuses ?? []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <select value={value.bu} onChange={(e) => setField("bu", e.target.value)} className="h-10 rounded-[8px] border border-[#D7E1EC] px-3 text-[12px]">
          <option value="">BU (todas)</option>
          {(options?.business_units ?? []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <select value={value.analysis_type} onChange={(e) => setField("analysis_type", e.target.value)} className="h-10 rounded-[8px] border border-[#D7E1EC] px-3 text-[12px]">
          <option value="">Tipo (todos)</option>
          {(options?.analysis_types ?? []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <select value={value.requester} onChange={(e) => setField("requester", e.target.value)} className="h-10 rounded-[8px] border border-[#D7E1EC] px-3 text-[12px]">
          <option value="">Solicitante (todos)</option>
          {(options?.requesters ?? []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <select value={value.assigned_analyst} onChange={(e) => setField("assigned_analyst", e.target.value)} className="h-10 rounded-[8px] border border-[#D7E1EC] px-3 text-[12px]">
          <option value="">Analista (todos)</option>
          {(options?.analysts ?? []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <input type="date" value={value.date_from} onChange={(e) => setField("date_from", e.target.value)} className="h-10 rounded-[8px] border border-[#D7E1EC] px-3 text-[12px]" />
        <input type="date" value={value.date_to} onChange={(e) => setField("date_to", e.target.value)} className="h-10 rounded-[8px] border border-[#D7E1EC] px-3 text-[12px]" />
      </div>
      {options && options.statuses.length === 0 && options.business_units.length === 0 ? <p className="mt-3 text-[11px] text-[#8FA3B4]">Sem opções específicas disponíveis no momento para este escopo.</p> : null}
    </div>
  );
}
