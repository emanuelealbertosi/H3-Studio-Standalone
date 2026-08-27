export function processingSeconds(
  createdAt: string,
  updatedAt: string,
  terminal: boolean,
) {
  if (!terminal) return null;
  const created = Date.parse(createdAt);
  const updated = Date.parse(updatedAt);
  if (!Number.isFinite(created) || !Number.isFinite(updated)) return null;
  return Math.max(0, (updated - created) / 1_000);
}
