import { ExternalDataKpi } from "@/features/external-data/utils/external-data-view-models";

type ExternalDataKpisProps = {
  items: ExternalDataKpi[];
};

export function ExternalDataKpis({ items }: ExternalDataKpisProps) {
  return (
    <section className="grid gap-3 md:grid-cols-3">
      {items.map((item) => (
        <article key={item.id} className="rounded-[10px] border border-[#e2e5eb] bg-white p-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-[#6b7280]">{item.label}</p>
          <p className="mt-2 text-[26px] font-medium leading-none text-[#111827]">{item.value}</p>
          <p className="mt-1 text-[11px] text-[#6b7280]">{item.helper}</p>
        </article>
      ))}
    </section>
  );
}
