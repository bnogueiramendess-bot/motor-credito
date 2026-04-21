import { Skeleton } from "@/shared/components/ui/skeleton";

export function AnalysisDetailSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-40" />

      <div className="rounded-[10px] border border-[#e2e5eb] bg-white p-4">
        <div className="flex gap-3">
          <Skeleton className="h-11 w-11 rounded-[8px]" />
          <div className="w-full space-y-2">
            <Skeleton className="h-5 w-64" />
            <Skeleton className="h-4 w-full" />
          </div>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-3">
        <Skeleton className="h-64 w-full rounded-[10px]" />
        <Skeleton className="h-64 w-full rounded-[10px]" />
        <Skeleton className="h-64 w-full rounded-[10px]" />
      </div>

      <Skeleton className="h-80 w-full rounded-[10px]" />
    </div>
  );
}
