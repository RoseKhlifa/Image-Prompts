import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useImageUpload } from "./useImageUpload.ts";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const presignResponse = {
  r2AccountId: "11111111-1111-1111-1111-111111111111",
  r2Key: "submissions/u/abc.jpg",
  uploadUrl: "https://r2.example.com/abc.jpg?sig=xxx",
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("useImageUpload", () => {
  it("starts idle", () => {
    const { result } = renderHook(() => useImageUpload(), { wrapper });
    expect(result.current.state).toBe("idle");
  });

  it("rejects size > 10MB before presigning", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const big = new File([new ArrayBuffer(11 * 1024 * 1024)], "big.jpg", { type: "image/jpeg" });
    const { result } = renderHook(() => useImageUpload(), { wrapper });
    await act(async () => {
      await result.current.upload(big);
    });
    expect(result.current.state).toBe("failed");
    expect(result.current.error).toContain("image_too_large");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects unsupported MIME before presigning", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const gif = new File([new Uint8Array([0])], "x.gif", { type: "image/gif" });
    const { result } = renderHook(() => useImageUpload(), { wrapper });
    await act(async () => {
      await result.current.upload(gif);
    });
    expect(result.current.state).toBe("failed");
    expect(result.current.error).toContain("unsupported_mime");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("calls presign then PUT, transitions idle → presigning → uploading → done", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (url) => {
        if (typeof url === "string" && url.endsWith("/api/submissions/presign")) {
          return new Response(JSON.stringify(presignResponse), { status: 200 });
        }
        // The PUT
        return new Response("", { status: 200 });
      });
    const file = new File([new Uint8Array([1, 2, 3])], "x.jpg", { type: "image/jpeg" });
    const { result } = renderHook(() => useImageUpload(), { wrapper });
    await act(async () => {
      await result.current.upload(file);
    });
    expect(result.current.state).toBe("done");
    expect(result.current.r2Key).toBe(presignResponse.r2Key);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("marks failed when PUT returns 5xx", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (typeof url === "string" && url.endsWith("/api/submissions/presign")) {
        return new Response(JSON.stringify(presignResponse), { status: 200 });
      }
      return new Response("", { status: 502 });
    });
    const file = new File([new Uint8Array([1])], "x.jpg", { type: "image/jpeg" });
    const { result } = renderHook(() => useImageUpload(), { wrapper });
    await act(async () => {
      await result.current.upload(file);
    });
    expect(result.current.state).toBe("failed");
  });

  it("reset() returns to idle", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(presignResponse), { status: 200 }),
    );
    const file = new File([new Uint8Array([1])], "x.jpg", { type: "image/jpeg" });
    const { result } = renderHook(() => useImageUpload(), { wrapper });
    await act(async () => {
      await result.current.upload(file);
    });
    act(() => result.current.reset());
    expect(result.current.state).toBe("idle");
    expect(result.current.r2Key).toBeNull();
  });
});
