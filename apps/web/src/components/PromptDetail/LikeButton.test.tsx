import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";
import i18n, { initI18n } from "../../i18n";
import LikeButton from "./LikeButton";

vi.mock("../../lib/hooks/useSession", () => ({
  useSession: vi.fn(),
}));
import { useSession } from "../../lib/hooks/useSession";

function setup(initial = { liked: false, count: 5 }, variant: "full" | "compact" = "full") {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={qc}>
          <LikeButton
            promptId="550e8400-e29b-41d4-a716-446655440000"
            initial={initial}
            variant={variant}
          />
        </QueryClientProvider>
      </I18nextProvider>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  await initI18n("en");
});
afterEach(() => cleanup());

describe("LikeButton", () => {
  it("opens SignInModal when guest clicks", async () => {
    (useSession as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: null,
      isLoading: false,
    });
    setup();
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByRole("dialog", { name: /sign in/i })).toBeTruthy());
  });

  it("optimistically increments the count when logged in user likes", async () => {
    (useSession as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        user: { id: "u1", email: "x@y", name: null, image: null, role: "user" },
        expires: "",
      },
      isLoading: false,
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ liked: true, like_count: 6 }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    setup({ liked: false, count: 5 });
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByRole("button").textContent).toContain("6"));
  });

  it("rolls back on 5xx error", async () => {
    (useSession as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        user: { id: "u1", email: "x@y", name: null, image: null, role: "user" },
        expires: "",
      },
      isLoading: false,
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "internal_error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    );
    setup({ liked: false, count: 5 });
    fireEvent.click(screen.getByRole("button"));
    // jumps to 6 optimistically, then rolls back to 5
    await waitFor(() => expect(screen.getByRole("button").textContent).toContain("5"));
  });

  it("renders compact variant without separate label", () => {
    (useSession as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: null,
      isLoading: false,
    });
    setup({ liked: false, count: 3 }, "compact");
    expect(screen.getByRole("button").textContent).toContain("3");
  });
});
