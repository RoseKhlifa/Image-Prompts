import { useCallback } from "react";
import { useSearchParams } from "react-router";

/**
 * Convenience hook over URLSearchParams: read + write a value of type string|null,
 * preserving other params and reset behavior.
 */
export function useUrlParam(name: string): [string | null, (value: string | null) => void] {
  const [params, setParams] = useSearchParams();
  const value = params.get(name);
  const setValue = useCallback(
    (next: string | null) => {
      const updated = new URLSearchParams(params);
      if (next === null || next === "") updated.delete(name);
      else updated.set(name, next);
      setParams(updated, { replace: false });
    },
    [params, setParams, name],
  );
  return [value, setValue];
}
