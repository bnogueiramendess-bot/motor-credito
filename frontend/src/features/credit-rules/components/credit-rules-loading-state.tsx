import { Skeleton } from "@/shared/components/ui/skeleton";

export function CreditRulesLoadingState() {
  return (
    <section className="readability-standard space-y-4">
      <div className="rounded-2xl border border-[#e5e9f2] bg-white px-6 py-5 shadow-sm">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="mt-3 h-4 w-[420px]" />
        <Skeleton className="mt-2 h-4 w-[360px]" />
      </div>

      <div className="rounded-2xl border border-[#dfe6f3] bg-[#fbfcff] p-5 shadow-sm">
        <Skeleton className="h-5 w-56" />
        <Skeleton className="mt-2 h-4 w-full max-w-[560px]" />
        <Skeleton className="mt-4 h-10 w-52" />
      </div>

      <div className="rounded-2xl border border-[#e5e9f2] bg-white p-5 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      </div>

      <div className="rounded-2xl border border-[#e5e9f2] bg-white p-5 shadow-sm">
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-12 w-full" />
          ))}
        </div>
      </div>
    </section>
  );
}
