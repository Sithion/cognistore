type ChartTooltipContentProps = {
  active?: boolean;
  payload?: ReadonlyArray<{
    name?: string | number;
    value?: unknown;
    color?: string;
    payload?: { fill?: string };
  }>;
  label?: unknown;
  format?: (n: number) => string;
};

export function ChartTooltipContent({
  active,
  payload,
  label,
  format,
}: ChartTooltipContentProps) {
  if (!active || !payload?.length) return null;

  const hasTitle =
    (typeof label === 'string' && label.length > 0) ||
    typeof label === 'number';
  const showName = payload.length !== 1 || !hasTitle;

  return (
    <div role="presentation" className="min-w-32 max-w-64 rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md">
      {hasTitle && (
        <p className="mb-1 font-medium leading-tight">{String(label)}</p>
      )}
      <ul className="space-y-0.5">
        {payload.map((item, index) => {
          const numericValue = Number(item.value);
          const formatted =
            format && Number.isFinite(numericValue)
              ? format(numericValue)
              : String(item.value ?? '');

          return (
            <li key={index} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-[2px]"
                style={{ backgroundColor: item.color ?? item.payload?.fill }}
              />
              {showName && (
                <span className="text-muted-foreground">{String(item.name ?? '')}</span>
              )}
              <span className="ml-auto pl-3 font-mono tabular-nums">{formatted}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function chartTooltipProps(
  kind: 'bar' | 'area' | 'pie',
  format?: (n: number) => string,
) {
  const cursor =
    kind === 'bar'
      ? { fill: 'var(--color-muted)', fillOpacity: 0.5 }
      : kind === 'area'
        ? { stroke: 'var(--color-border)', strokeWidth: 1 }
        : false;

  return {
    content: <ChartTooltipContent format={format} />,
    wrapperStyle: { outline: 'none' },
    isAnimationActive: false,
    cursor,
  };
}
