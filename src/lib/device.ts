export function getOrCreateDeviceId(): string {
  const key = "bannerfront.device-id";
  const existing = localStorage.getItem(key);
  if (existing) {
    return existing;
  }

  const next = crypto.randomUUID();
  localStorage.setItem(key, next);
  return next;
}
