import { Skeleton } from "@/shared/components/ui/skeleton";

export function ExternalDataSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-28 w-full rounded-[10px]" />
      <div className="grid gap-3 md:grid-cols-3">
        <Skeleton className="h-24 w-full rounded-[10px]" />
        <Skeleton className="h-24 w-full rounded-[10px]" />
        <Skeleton className="h-24 w-full rounded-[10px]" />
      </div>
      <Skeleton className="h-64 w-full rounded-[10px]" />
      <Skeleton className="h-48 w-full rounded-[10px]" />
      <Skeleton className="h-72 w-full rounded-[10px]" />
    </div>
  );
}
