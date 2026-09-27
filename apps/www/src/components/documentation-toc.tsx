"use client";

import type {
  ComponentProps,
  CSSProperties,
  MutableRefObject,
  ReactNode,
} from "react";
import { Text } from "lucide-react";
import * as Primitive from "fumadocs-core/toc";
import { TOCScrollArea, useTOCItems } from "fumadocs-ui/components/toc";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "fumadocs-ui/components/ui/collapsible";
import { useEffect, useRef, useState } from "react";

// Adapted from Fumadocs' default TOC: https://github.com/fuma-nama/fumadocs/blob/main/packages/ui/src/components/toc/default.tsx.
type TableOfContentsProps = {
  container?: ComponentProps<"div">;
  footer?: ReactNode;
  header?: ReactNode;
};

type TableOfContentsPopoverProps = TableOfContentsProps & {
  content?: ComponentProps<"div">;
  trigger?: ComponentProps<"button">;
};

type TocPath = {
  content: ReactNode[];
  d: string;
  height: number;
  itemLineLengths: [number, number][];
  positions: [number, number, number][];
  width: number;
};

const classNames = (...values: (string | undefined | false)[]) =>
  values.filter(Boolean).join(" ");

export const tocItemOffset = (depth: number) => 20 + 12 * (depth - 2);

export const tocLineOffset = (depth: number) => 8 + 8 * (depth - 2);

const TocList = ({
  children,
  className,
  thumbBox = true,
  ...props
}: ComponentProps<"div"> & { thumbBox?: boolean }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const items = useTOCItems();
  const [path, setPath] = useState<TocPath | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const printPath = () => setPath(createTocPath(container, items, thumbBox));
    const observer = new ResizeObserver(printPath);
    observer.observe(container);
    printPath();
    return () => observer.unobserve(container);
  }, [items, thumbBox]);

  return (
    <div
      ref={containerRef}
      className={classNames("relative flex flex-col", className)}
      {...props}
    >
      {path && <TocTrack path={path} thumbBox={thumbBox} />}
      {children}
    </div>
  );
};

const createTocPath = (
  container: HTMLDivElement,
  items: ReturnType<typeof useTOCItems>,
  thumbBox: boolean,
): TocPath | null => {
  if (container.clientHeight === 0 || items.length === 0) {
    return null;
  }

  const path = items.reduce(
    (result, item, index) => addTocPathItem({ container, index, item, result }),
    {
      content: [] as ReactNode[],
      d: "",
      height: 0,
      positions: [] as [number, number, number][],
      width: 0,
    },
  );
  const itemLineLengths = thumbBox ? getItemLineLengths(path) : [];

  return { ...path, itemLineLengths };
};

const addTocPathItem = ({
  container,
  index,
  item,
  result,
}: {
  container: HTMLDivElement;
  index: number;
  item: ReturnType<typeof useTOCItems>[number];
  result: Omit<TocPath, "itemLineLengths">;
}) => {
  const element = container.querySelector<HTMLAnchorElement>(
    `a[href="${item.url}"]`,
  );
  if (!element) {
    return result;
  }

  const styles = getComputedStyle(element);
  const x = tocLineOffset(item.depth) + 0.5;
  const top = element.offsetTop + Number.parseFloat(styles.paddingTop);
  const bottom =
    element.offsetTop +
    element.clientHeight -
    Number.parseFloat(styles.paddingBottom);
  const previous = result.positions.at(-1);
  const d = previous
    ? `${result.d} C ${previous[2]} ${top - 4} ${x} ${previous[1] + 4} ${x} ${top} L${x} ${bottom}`
    : `${result.d} M${x} ${top} L${x} ${bottom}`;

  return {
    content:
      item._step === undefined
        ? result.content
        : [
            ...result.content,
            <StepMarker
              key={index}
              step={item._step}
              x={x}
              y={(top + bottom) / 2}
            />,
          ],
    d,
    height: Math.max(result.height, bottom),
    positions: [
      ...result.positions,
      [top, bottom, x] as [number, number, number],
    ],
    width: Math.max(result.width, x + 8),
  };
};

const getItemLineLengths = (path: Omit<TocPath, "itemLineLengths">) => {
  const svgPath = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "path",
  );
  svgPath.setAttribute("d", path.d);
  const length = svgPath.getTotalLength();

  return path.positions.reduce<[number, number][]>(
    (lineLengths, [top, bottom], index) => {
      let start =
        index === 0
          ? top
          : lineLengths[index - 1][1] + (top - path.positions[index - 1][1]);
      while (start < length && svgPath.getPointAtLength(start).y < top) {
        start += 1;
      }
      return [...lineLengths, [start, start + bottom - top]];
    },
    [],
  );
};

const StepMarker = ({ step, x, y }: { step: number; x: number; y: number }) => (
  <g transform={`translate(${x}, ${y})`}>
    <circle cx="0" cy="0" r="8" className="fill-fd-primary" />
    <text
      alignmentBaseline="central"
      className="fill-fd-primary-foreground font-mono text-xs font-medium leading-none rtl:-scale-x-100"
      cx="0"
      cy="0"
      dominantBaseline="middle"
      textAnchor="middle"
    >
      {step}
    </text>
  </g>
);

const TocTrack = ({ path, thumbBox }: { path: TocPath; thumbBox: boolean }) => {
  const toc = Primitive.useTOC();
  const previous = useRef<{ end: number; start: number; up: boolean } | null>(
    null,
  );
  const [style, setStyle] = useState<CSSProperties>(() =>
    trackStyle({ items: toc.get(), path, previous, thumbBox }),
  );

  Primitive.useTOCListener((items) =>
    setStyle(trackStyle({ items, path, previous, thumbBox })),
  );

  return (
    <div
      className="absolute top-0 inset-s-0 origin-center rtl:-scale-x-100"
      style={{ height: path.height, width: path.width, ...style }}
    >
      <svg
        className="absolute transition-[clip-path]"
        style={{
          clipPath:
            "polygon(0 var(--track-top,0), 100% var(--track-top,0), 100% var(--track-bottom,0), 0 var(--track-bottom,0))",
          height: path.height,
          width: path.width,
        }}
        viewBox={`0 0 ${path.width} ${path.height}`}
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          className="stroke-fd-primary"
          d={path.d}
          fill="none"
          strokeWidth="1"
        />
        {path.content}
      </svg>
      {thumbBox && (
        <div
          className="absolute left-0 size-1 rounded-full bg-fd-primary opacity-(--opacity,0) transition-[opacity,offset-distance] [offset-distance:var(--offset-distance,0)]"
          style={{ offsetPath: `path("${path.d}")` }}
        />
      )}
    </div>
  );
};

const trackStyle = ({
  items,
  path,
  previous,
  thumbBox,
}: {
  items: ReturnType<ReturnType<typeof Primitive.useTOC>["get"]>;
  path: TocPath;
  previous: MutableRefObject<{
    end: number;
    start: number;
    up: boolean;
  } | null>;
  thumbBox: boolean;
}): CSSProperties => {
  const start = items.findIndex((item) => item.active);
  const end = items.reduce(
    (lastIndex, item, index) => (item.active ? index : lastIndex),
    -1,
  );
  if (start === -1 || end === -1) {
    return {};
  }

  const style: CSSProperties = {
    "--track-bottom": `${path.positions[end][1]}px`,
    "--track-top": `${path.positions[start][0]}px`,
  } as CSSProperties;
  if (!thumbBox) {
    return style;
  }

  const wasUp = previous.current?.up ?? false;
  const up = previous.current
    ? previous.current.start > start ||
      previous.current.end > end ||
      (previous.current.start === start &&
        previous.current.end === end &&
        wasUp)
    : false;
  previous.current = { end, start, up };
  return {
    ...style,
    "--offset-distance": `${path.itemLineLengths[up ? start : end][up ? 0 : 1]}px`,
    "--opacity":
      items[up ? start : end].original._step === undefined ? "1" : "0",
  } as CSSProperties;
};

const TocItem = ({
  item,
  ...props
}: { item: ReturnType<typeof useTOCItems>[number] } & ComponentProps<"a">) => {
  const items = useTOCItems();
  const index = items.indexOf(item);
  const previous = items[index - 1];
  const next = items[index + 1];
  const line = tocLineOffset(item.depth);
  const previousLine = tocLineOffset(previous?.depth ?? item.depth);
  const nextLine = tocLineOffset(next?.depth ?? item.depth);
  const isFirst = index === 0;
  const isLast = index === items.length - 1;

  return (
    <Primitive.TOCItem
      href={item.url}
      {...props}
      className={classNames(
        "prose relative py-1.5 text-sm text-fd-muted-foreground transition-colors wrap-anywhere hover:text-fd-accent-foreground data-[active=true]:text-fd-primary",
        isFirst && "pt-0",
        isLast && "pb-0",
        props.className,
      )}
      style={{ paddingInlineStart: tocItemOffset(item.depth), ...props.style }}
    >
      <TocItemLine
        line={line}
        nextLine={nextLine}
        previousLine={previousLine}
        step={item._step}
      />
      {item.title}
    </Primitive.TOCItem>
  );
};

const TocItemLine = ({
  line,
  nextLine,
  previousLine,
  step,
}: {
  line: number;
  nextLine: number;
  previousLine: number;
  step?: number;
}) => (
  <svg
    className={classNames(
      "absolute -top-1.5 inset-s-0 bottom-0 -z-1 h-[calc(100%+--spacing(1.5))] rtl:-scale-x-100",
      line !== nextLine && "bottom-1.5 h-full",
    )}
    style={{ width: Math.max(previousLine, line) + 9 }}
    xmlns="http://www.w3.org/2000/svg"
  >
    {previousLine !== line && (
      <path
        className="stroke-fd-foreground/10"
        d={`M ${previousLine + 0.5} 0 C ${previousLine + 0.5} 8 ${line + 0.5} 4 ${line + 0.5} 12`}
        fill="none"
        stroke="black"
        strokeWidth="1"
      />
    )}
    <line
      className="stroke-fd-foreground/10"
      strokeWidth="1"
      x1={line + 0.5}
      x2={line + 0.5}
      y1={previousLine === line ? "6" : "12"}
      y2="100%"
    />
    {step !== undefined && (
      <StepMarker step={step} x={line + 0.5} y={line === nextLine ? 3 : 6} />
    )}
  </svg>
);

const TocContents = ({ onItemClick }: { onItemClick?: () => void }) => {
  const items = useTOCItems();
  return (
    <TOCScrollArea>
      <TocList>
        {items.map((item) => (
          <TocItem key={item.url} item={item} onClick={onItemClick} />
        ))}
      </TocList>
    </TOCScrollArea>
  );
};

export const DocumentationTableOfContents = ({
  container,
  footer,
  header,
}: TableOfContentsProps) => (
  <div
    id="nd-toc"
    {...container}
    className={classNames(
      "sticky top-(--fd-docs-row-1) flex h-[calc(var(--fd-docs-height)-var(--fd-docs-row-1))] w-(--fd-toc-width) flex-col pt-12 pe-4 pb-2 [grid-area:toc] xl:layout:[--fd-toc-width:268px] max-xl:hidden",
      container?.className,
    )}
  >
    {header}
    <h3
      id="toc-title"
      className="inline-flex items-center gap-1.5 text-sm text-fd-muted-foreground"
    >
      <Text className="size-4" />
      On this page
    </h3>
    <TocContents />
    {footer}
  </div>
);

export const DocumentationTableOfContentsPopover = ({
  container,
  content,
  footer,
  header,
  trigger,
}: TableOfContentsPopoverProps) => {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      data-toc-popover=""
      {...container}
      className={classNames(
        "sticky top-(--fd-docs-row-2) z-10 h-(--fd-toc-popover-height) [grid-area:toc-popover] xl:hidden max-xl:layout:[--fd-toc-popover-height:--spacing(10)]",
        container?.className,
      )}
    >
      <header className="border-b bg-fd-background/80 backdrop-blur-sm">
        <CollapsibleTrigger
          {...trigger}
          className={classNames(
            "flex h-10 w-full items-center px-4 py-2.5 text-start text-sm text-fd-muted-foreground md:px-6",
            trigger?.className,
          )}
          data-toc-popover-trigger=""
        >
          On this page
        </CollapsibleTrigger>
        <CollapsibleContent data-toc-popover-content="" {...content}>
          <div className="flex max-h-[50vh] flex-col px-4 md:px-6">
            {header}
            <TocContents onItemClick={() => setOpen(false)} />
            {footer}
          </div>
        </CollapsibleContent>
      </header>
    </Collapsible>
  );
};
