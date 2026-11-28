"use client";

import { type ReactNode, useId, useLayoutEffect, useMemo, useRef, useState } from "react";

// zitadel/new-website's LabelNotchedCard (app/components/LabelNotchedCard.tsx):
// a card whose top-left corner is cut away into a notch that holds its
// label. The paths are the agency's, unchanged; the colors are the theme's
// (.notch-edge, --color-notch-fill), and the card shows before it is
// measured, as a rounded card with its label, so it reads without script.

type NotchConfig = {
  tabWidth?: number;
  tabHeight?: number;
  cornerRadius?: number;
  largeRadius?: number;
};

const getClipPathDefinition = (width: number, height: number, config: NotchConfig = {}) => {
  const cornerRadius = config.cornerRadius ?? 16;
  const largeRadius = config.largeRadius ?? 44;
  const tabWidth = config.tabWidth ?? 160;
  const tabHeight = config.tabHeight ?? 64;

  const leftInset = cornerRadius;
  const notchInnerY = tabHeight;
  const notchBottomY = notchInnerY + cornerRadius;
  const tabTopRightX = leftInset + tabWidth;
  const tabStartX = tabTopRightX - cornerRadius - largeRadius;
  const tabArcEndX = tabStartX + largeRadius;
  const tabArcEndY = notchInnerY - largeRadius;

  const isTooSmall = width <= tabTopRightX || height <= notchBottomY || tabStartX <= leftInset;

  if (isTooSmall) {
    return `M ${cornerRadius} 0 H ${width - cornerRadius} A ${cornerRadius} ${cornerRadius} 0 0 1 ${width} ${cornerRadius} V ${height - cornerRadius} A ${cornerRadius} ${cornerRadius} 0 0 1 ${width - cornerRadius} ${height} H ${cornerRadius} A ${cornerRadius} ${cornerRadius} 0 0 1 0 ${height - cornerRadius} V ${cornerRadius} A ${cornerRadius} ${cornerRadius} 0 0 1 ${cornerRadius} 0 Z`;
  }

  return `M ${leftInset} 0 H ${width - cornerRadius} A ${cornerRadius} ${cornerRadius} 0 0 1 ${width} ${cornerRadius} V ${height - cornerRadius} A ${cornerRadius} ${cornerRadius} 0 0 1 ${width - cornerRadius} ${height} H ${cornerRadius} A ${cornerRadius} ${cornerRadius} 0 0 1 0 ${height - cornerRadius} V ${notchBottomY} A ${cornerRadius} ${cornerRadius} 0 0 1 ${leftInset} ${notchInnerY} H ${tabStartX} A ${largeRadius} ${largeRadius} 0 0 0 ${tabArcEndX} ${tabArcEndY} V ${cornerRadius} A ${cornerRadius} ${cornerRadius} 0 0 1 ${tabTopRightX} 0 Z`;
};

const getLabelPathDefinition = (width: number, height: number, radius = 6, brRadius = 20) => {
  if (width === 0 || height === 0) return "";
  const r = radius;
  const br = brRadius;
  return `M ${r} 0 H ${width - r} A ${r} ${r} 0 0 1 ${width} ${r} V ${
    height - br
  } A ${br} ${br} 0 0 1 ${width - br} ${height} H ${r} A ${r} ${r} 0 0 1 0 ${
    height - r
  } V ${r} A ${r} ${r} 0 0 1 ${r} 0 Z`;
};

/** The element's size, kept as it changes. */
function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      setSize({ width, height });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
}

/** The label in its own notched frame, the agency's CardLabel. */
function CardLabel({ label }: { label: string }) {
  const [ref, size] = useSize<HTMLDivElement>();
  const maskId = `label-mask-${useId().replace(/:/g, "")}`;
  const outer = useMemo(() => getLabelPathDefinition(size.width, size.height), [size]);
  const inner = useMemo(
    () => getLabelPathDefinition(Math.max(0, size.width - 2), Math.max(0, size.height - 2), 5, 19),
    [size],
  );

  return (
    <div className="relative inline-block p-px" ref={ref}>
      <div className="pointer-events-none px-4 py-2 font-heading text-sm uppercase leading-5 tracking-[0.08em] opacity-0">
        {label}
      </div>
      <svg aria-hidden="true" className="pointer-events-none absolute size-0">
        <defs>
          <mask id={maskId}>
            <rect width="100%" height="100%" fill="black" />
            <path d={outer} fill="white" />
            <path d={inner} fill="black" transform="translate(1, 1)" />
          </mask>
        </defs>
      </svg>
      <div
        className={`notch-edge absolute inset-0 ${outer ? "" : "rounded-md"}`}
        style={
          outer ? { maskImage: `url(#${maskId})`, WebkitMaskImage: `url(#${maskId})` } : undefined
        }
      />
      <div
        className={`absolute inset-px flex items-center justify-center overflow-hidden bg-notch-fill ${inner ? "" : "rounded-md"}`}
        style={inner ? { clipPath: `path('${inner}')` } : undefined}
      >
        <div className="px-4 py-2 font-heading text-sm text-text-primary uppercase leading-5 tracking-[0.08em]">
          {label}
        </div>
      </div>
    </div>
  );
}

/**
 * A card with its label in a notch at the top left; `children` fill it under
 * the notch, at its foot.
 */
export function NotchedCard({
  label,
  className = "",
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const [labelRef, labelSize] = useSize<HTMLDivElement>();
  const [cardRef, cardSize] = useSize<HTMLDivElement>();
  const maskId = `card-mask-${useId().replace(/:/g, "")}`;

  const notch = useMemo(
    () => ({
      tabWidth: labelSize.width > 0 ? labelSize.width + 12 : 160,
      tabHeight: labelSize.height > 0 ? labelSize.height + 12 : 64,
    }),
    [labelSize],
  );
  const outer = useMemo(
    () => (cardSize.width ? getClipPathDefinition(cardSize.width, cardSize.height, notch) : ""),
    [cardSize, notch],
  );
  const inner = useMemo(
    () =>
      cardSize.width
        ? getClipPathDefinition(
            Math.max(0, cardSize.width - 2),
            Math.max(0, cardSize.height - 2),
            notch,
          )
        : "",
    [cardSize, notch],
  );

  return (
    <div className={`relative w-full ${className}`} ref={cardRef}>
      <div className="absolute top-0 left-0 z-20" ref={labelRef}>
        <CardLabel label={label} />
      </div>
      <svg aria-hidden="true" className="pointer-events-none absolute size-0">
        <defs>
          <mask id={maskId}>
            <rect width="100%" height="100%" fill="black" />
            <path d={outer} fill="white" />
            <path d={inner} fill="black" transform="translate(1, 1)" />
          </mask>
        </defs>
      </svg>
      <div
        className={`notch-edge absolute inset-0 ${outer ? "" : "rounded-2xl"}`}
        style={
          outer ? { maskImage: `url(#${maskId})`, WebkitMaskImage: `url(#${maskId})` } : undefined
        }
      />
      <div
        className={`relative isolate m-px flex h-[calc(100%-2px)] flex-col justify-end overflow-hidden bg-notch-fill ${inner ? "" : "rounded-2xl"}`}
        style={inner ? { clipPath: `path('${inner}')` } : undefined}
      >
        <div className="flex flex-1 flex-col justify-end px-6 pt-20 pb-6 md:px-7 md:pb-7">
          {children}
        </div>
      </div>
    </div>
  );
}
