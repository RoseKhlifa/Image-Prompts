type Props = {
  src?: string | null;
  name?: string | null;
  email: string;
  size?: number;
};

function initials(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "?";
  const at = trimmed.indexOf("@");
  const base = at > 0 ? trimmed.slice(0, at) : trimmed;
  return base.slice(0, 1).toUpperCase();
}

export default function AvatarBadge({ src, name, email, size = 28 }: Props) {
  if (src) {
    return (
      <img
        src={src}
        alt={name ?? email}
        width={size}
        height={size}
        className="rounded-full object-cover"
      />
    );
  }
  const ch = initials(name || email);
  return (
    <div
      style={{ width: size, height: size }}
      className="flex items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-white"
      aria-label={name ?? email}
    >
      {ch}
    </div>
  );
}
