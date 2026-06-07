import { useEffect, useRef } from "react";
import { postView } from "../interactions";

/**
 * Fire-and-forget view recording. Runs once per mounted detail page per
 * promptId; the ref prevents StrictMode's double-mount from double-firing
 * in dev. Failures are swallowed — views are best-effort.
 */
export function useView(promptId: string | undefined) {
  const fired = useRef<string | null>(null);
  useEffect(() => {
    if (!promptId || fired.current === promptId) return;
    fired.current = promptId;
    void postView(promptId).catch(() => {
      /* best-effort; ignore */
    });
  }, [promptId]);
}
