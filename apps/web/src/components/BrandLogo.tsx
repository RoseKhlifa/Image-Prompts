/**
 * Image-Prompts brand mark. Single bitmap (1280×1280) at /logo.png, downscaled
 * by the browser. Use the `size` prop to set the rendered square edge; the
 * wordmark next to it is optional.
 */
type Props = {
  /** Rendered square edge in px. */
  size?: number;
  /** Show the "Image-Prompts" wordmark next to the mark. */
  showWordmark?: boolean;
  /** Extra wrapper classes (positioning, gap, etc). */
  className?: string;
};

export default function BrandLogo({ size = 24, showWordmark = false, className }: Props) {
  return (
    <span
      className={["inline-flex items-center gap-2", className ?? ""].join(" ").trim()}
    >
      <img
        src="/logo.png"
        alt="Image-Prompts"
        width={size}
        height={size}
        className="block shrink-0 rounded-md"
        loading="eager"
      />
      {showWordmark && (
        <span className="text-[15px] font-semibold tracking-tight text-ink">Image-Prompts</span>
      )}
    </span>
  );
}
