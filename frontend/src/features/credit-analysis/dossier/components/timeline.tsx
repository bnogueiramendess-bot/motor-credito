type TimelineItem = {
  title: string;
  meta: string;
  tone: "blue" | "green" | "amber";
};

type TimelineProps = {
  items: TimelineItem[];
};

export function Timeline({ items }: TimelineProps) {
  return (
    <div className="flex flex-col">
      {items.map((item, index) => {
        const isLast = index === items.length - 1;

        return (
          <div key={`${item.title}-${item.meta}`} className={isLast ? "relative flex gap-3.5 pb-0" : "relative flex gap-3.5 pb-4"}>
            <div className="flex w-5 shrink-0 flex-col items-center">
              <div
                className={
                  item.tone === "blue"
                    ? "mt-[3px] h-2.5 w-2.5 rounded-full border-2 border-[#75D4EE] bg-[#295B9A]"
                    : item.tone === "green"
                      ? "mt-[3px] h-2.5 w-2.5 rounded-full border-2 border-[#A7DDB8] bg-[#1A7A3A]"
                      : "mt-[3px] h-2.5 w-2.5 rounded-full border-2 border-[#F5D06A] bg-[#D4870A]"
                }
              />
              {isLast ? null : <div className="mb-0 mt-1 h-full w-px bg-[#D7E1EC]" />}
            </div>
            <div className="flex-1">
              <div className="text-xs font-medium text-[#102033]">{item.title}</div>
              <div className="mt-0.5 text-[11px] text-[#4F647A]">{item.meta}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

