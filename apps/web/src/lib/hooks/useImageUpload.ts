import { useCallback, useRef, useState } from "react";
import { apiFetch } from "../api";

type State =
  | "idle"
  | "validating"
  | "presigning"
  | "uploading"
  | "done"
  | "failed";

const MAX_SIZE = 10 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp"] as const;

type PresignResponse = {
  r2AccountId: string;
  r2Key: string;
  uploadUrl: string;
  expiresAt: string;
};

export function useImageUpload() {
  const [state, setState] = useState<State>("idle");
  const [progress, setProgress] = useState(0);
  const [r2AccountId, setR2AccountId] = useState<string | null>(null);
  const [r2Key, setR2Key] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState("idle");
    setProgress(0);
    setR2AccountId(null);
    setR2Key(null);
    setError(null);
  }, []);

  const upload = useCallback(async (file: File) => {
    setError(null);
    setState("validating");
    if (file.size > MAX_SIZE) {
      setError("image_too_large");
      setState("failed");
      return;
    }
    if (!(ALLOWED as readonly string[]).includes(file.type)) {
      setError("unsupported_mime");
      setState("failed");
      return;
    }
    setState("presigning");
    abortRef.current = new AbortController();
    try {
      const ps = await apiFetch<PresignResponse>("/api/submissions/presign", {
        method: "POST",
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type,
          size: file.size,
        }),
        signal: abortRef.current.signal,
      });
      setR2AccountId(ps.r2AccountId);
      setR2Key(ps.r2Key);
      setState("uploading");
      const put = await fetch(ps.uploadUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
        signal: abortRef.current.signal,
      });
      if (!put.ok) {
        setError(`upload_failed:${put.status}`);
        setState("failed");
        return;
      }
      setProgress(100);
      setState("done");
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === "AbortError") {
        // user canceled
        setState("idle");
        return;
      }
      setError(e instanceof Error ? e.message : "unknown_error");
      setState("failed");
    }
  }, []);

  return { state, progress, r2AccountId, r2Key, error, upload, reset };
}
