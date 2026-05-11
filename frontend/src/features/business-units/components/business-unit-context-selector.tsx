"use client";

type BusinessUnitContextSelectorProps = {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  consolidatedLabel: string;
  canViewConsolidated: boolean;
  options: Array<{ code: string; name: string }>;
  compactSingleBu?: boolean;
  compact?: boolean;
};

export function BusinessUnitContextSelector({
  value,
  onChange,
  label = "Contexto",
  consolidatedLabel,
  canViewConsolidated,
  options,
  compactSingleBu = true,
  compact = false
}: BusinessUnitContextSelectorProps) {
  if (options.length <= 1 && !canViewConsolidated) {
    if (!compactSingleBu || options.length === 0) return null;
    return (
      <div className="inline-flex items-center gap-2 rounded-md border border-[#dbe3ef] bg-[#f8fafc] px-2.5 py-1 text-xs text-[#334155]">
        <span className="font-semibold text-[#64748b]">BU</span>
        <span className="font-medium text-[#0f172a]">{options[0].name}</span>
      </div>
    );
  }

  if (compact) {
    return (
      <div className="inline-flex items-center gap-2">
        <label className="text-xs font-semibold text-[#64748b]">{label}:</label>
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-8 min-w-[210px] rounded-md border border-[#dbe3ef] bg-white px-2.5 text-sm text-[#0f172a]"
        >
          {canViewConsolidated ? <option value="consolidated">{consolidatedLabel}</option> : null}
          {options.map((item) => (
            <option key={item.code || item.name} value={item.code || item.name}>
              {item.name}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div className="inline-flex items-center gap-2 rounded-xl border border-[#dbe3ef] bg-white px-3 py-2 shadow-sm">
      <label className="text-xs font-semibold uppercase tracking-[0.08em] text-[#64748b]">{label}</label>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 min-w-[220px] rounded-md border border-[#dbe3ef] bg-white px-2.5 text-sm text-[#0f172a]"
      >
        {canViewConsolidated ? <option value="consolidated">{consolidatedLabel}</option> : null}
        {options.map((item) => (
          <option key={item.code || item.name} value={item.code || item.name}>
            {item.name}
          </option>
        ))}
      </select>
    </div>
  );
}
