const KEY = "submit-draft-v1";

export function saveDraft(values: unknown): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(values));
  } catch {
    // sessionStorage may be unavailable (private mode); silently ignore
  }
}

export function loadDraft<T>(): T | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function clearDraft(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
