import { Skeleton } from "@/shared/components/ui/skeleton";

export function AnalysisListSkeleton() {
  return (
    <section className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="rounded-[8px] border border-[#e2e5eb] bg-white px-3.5 py-3">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-2 h-5 w-14" />
            <Skeleton className="mt-2 h-3 w-24" />
          </div>
        ))}
      </div>

      <div className="rounded-[8px] border border-[#e2e5eb] bg-white px-3 py-2.5">
        <Skeleton className="h-6 w-full" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="rounded-[10px] border border-[#e2e5eb] bg-white p-4">
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
          </div>
        </div>
        <div className="rounded-[10px] border border-[#e2e5eb] bg-white p-4">
          <div className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        </div>
      </div>
    </section>
  );
}
