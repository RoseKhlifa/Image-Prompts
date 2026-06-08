import { initialFromName, colorForId } from "../lib/avatar";

type Props = {
  id: string | null;
  name: string | null;
  src: string | null;
  size?: number;
  className?: string;
};

/**
 * Shared avatar. Renders the provider image when available; falls back to
 * a deterministic colored circle with the first character of the name.
 */
export default function Avatar({ id, name, src, size = 24, className = "" }: Props) {
  if (src) {
    return (
      <img
        src={src}
        alt={name ?? ""}
        width={size}
        height={size}
        className={`rounded-full object-cover ${className}`}
      />
    );
  }
  const bg = id ? colorForId(id) : "#9ca3af";
  return (
    <span
      aria-hidden={!name}
      style={{ width: size, height: size, backgroundColor: bg }}
      className={`inline-flex items-center justify-center rounded-full text-white font-medium ${className}`}
    >
      <span style={{ fontSize: size * 0.5 }}>{initialFromName(name)}</span>
    </span>
  );
}
