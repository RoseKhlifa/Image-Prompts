import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";
import i18n, { initI18n } from "../../i18n";
import SendToStudioButton from "./SendToStudioButton";

vi.mock("../../lib/hooks/useSession", () => {
  return {
    useSession: vi.fn(),
  };
});

import { useSession } from "../../lib/hooks/useSession";

function renderButton(props: { detailId?: string } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={qc}>
          <SendToStudioButton
            promptId={props.detailId ?? "550e8400-e29b-41d4-a716-446655440000"}
            payload={{ prompt: { en: "test prompt" } }}
          />
        </QueryClientProvider>
      </I18nextProvider>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  await initI18n("en");
  Object.defineProperty(window, "location", {
    writable: true,
    value: { ...window.location, href: "http://localhost/" },
  });
});

afterEach(() => {
  cleanup();
});

describe("SendToStudioButton", () => {
  it("shows disabled state with tooltip when guest", () => {
    (useSession as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: null,
      isLoading: false,
    });
    renderButton();
    const btn = screen.getByRole("button", { name: /send to image-studio/i });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("title");
  });

  it("is enabled when logged in", () => {
    (useSession as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        user: { id: "u1", email: "x@y", name: null, image: null, role: "user" },
        expires: "",
      },
      isLoading: false,
    });
    renderButton();
    expect(screen.getByRole("button", { name: /send to image-studio/i })).not.toBeDisabled();
  });

  it("calls POST on click and redirects to scheme on success", async () => {
    (useSession as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        user: { id: "u1", email: "x@y", name: null, image: null, role: "user" },
        expires: "",
      },
      isLoading: false,
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ token: "Ab3Cd4Ef", expires_at: new Date().toISOString() }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: /send to image-studio/i }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    await waitFor(() => expect(window.location.href).toBe("image-studio://import?token=Ab3Cd4Ef"));
  });

  it("opens fallback modal when page is still visible after 1500ms", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      (useSession as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        data: {
          user: { id: "u1", email: "x@y", name: null, image: null, role: "user" },
          expires: "",
        },
        isLoading: false,
      });
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ token: "Ab3Cd4Ef", expires_at: new Date().toISOString() }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      );
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      renderButton();
      fireEvent.click(screen.getByRole("button", { name: /send to image-studio/i }));
      await waitFor(() => expect(window.location.href).toContain("image-studio://"));
      await vi.advanceTimersByTimeAsync(1500);
      await waitFor(() =>
        expect(screen.getByRole("dialog", { name: /image-studio not detected/i })).toBeTruthy(),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
