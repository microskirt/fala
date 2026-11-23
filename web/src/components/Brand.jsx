/*
 * The bar mark from the favicon, drawn inline so the sidebar and the tab share
 * one shape instead of two that drift apart.
 */
export function BrandMark({ size = 32, className }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
    >
      <rect width="32" height="32" rx="9" fill="#17171b" />
      <g fill="#ffffff">
        <rect x="5.5" y="13" width="2.6" height="6" rx="1.3" opacity="0.55" />
        <rect x="10.1" y="9.5" width="2.6" height="13" rx="1.3" opacity="0.8" />
        <rect x="14.7" y="6.5" width="2.6" height="19" rx="1.3" />
        <rect x="19.3" y="9.5" width="2.6" height="13" rx="1.3" opacity="0.8" />
        <rect x="23.9" y="13" width="2.6" height="6" rx="1.3" opacity="0.55" />
      </g>
    </svg>
  );
}
