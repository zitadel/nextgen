import type { ComponentType, SVGProps } from "react";

/**
 * Icon component shape shared by the sidebar. Lucide icons satisfy this, and
 * the custom Zitadel logo mark below matches it so they drop into the nav
 * interchangeably.
 */
export type NavIcon = ComponentType<{
  size?: number | string;
  className?: string;
  "aria-hidden"?: boolean;
}>;

type IconProps = {
  size?: number | string;
  className?: string;
} & SVGProps<SVGSVGElement>;

/** Zitadel logo mark used at the top of the sidebar (fills with currentColor). */
export function ZitadelMark({ size = 24, className, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 22.31 23.78"
      fill="currentColor"
      className={className}
      {...props}
    >
      <path d="M3.22363 6.71172C3.24542 6.49676 3.42256 6.27254 3.66297 6.15562L14.1415 0.0777808C14.5209 -0.106733 14.8761 0.052579 14.8418 0.391801V7.12373C14.82 7.33869 14.6428 7.56292 14.4024 7.67984L3.92389 13.6347C3.54451 13.8193 3.18925 13.6599 3.22363 13.3207V6.71172Z" />
      <path d="M22.0459 8.26746C22.2211 8.39381 22.3268 8.65932 22.3078 8.92598V20.8737C22.2779 21.2945 21.9623 21.5225 21.6857 21.3231L15.8955 18.0136C15.7202 17.8873 15.6146 17.6218 15.6335 17.3551V5.23555C15.6634 4.81475 15.979 4.58675 16.2556 4.78614L22.0459 8.26746Z" />
      <path d="M11.6052 23.7338C11.4081 23.8224 11.1254 23.7811 10.9039 23.6314L0.288726 17.5315C-0.0607637 17.2953 -0.10042 16.9079 0.210559 16.7681L5.92162 13.4366C6.11869 13.348 6.40145 13.3893 6.62292 13.539L17.161 19.7247C17.5105 19.9609 17.5562 20.3201 17.2392 20.4881L11.6052 23.7338Z" />
    </svg>
  );
}
