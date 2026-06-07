import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";
import i18n, { initI18n } from "../../i18n";
import FavoriteButton from "./FavoriteButton";

vi.mock("../../lib/hooks/useSession", () => ({ useSession: vi.fn() }));
import { useSession } from "../../lib/hooks/useSession";

function setup(initial = { favorited: false }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={qc}>
          <FavoriteButton promptId="550e8400-e29b-41d4-a716-446655440000" initial={initial} />
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

describe("FavoriteButton", () => {
  it("opens SignInModal when guest clicks", async () => {
    (useSession as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: null,
      isLoading: false,
    });
    setup();
    fireEvent.click(screen.getByRole("button", { name: /favorite/i }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: /sign in/i })).toBeTruthy());
  });

  it("toggles aria-pressed on successful favorite", async () => {
    (useSession as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        user: { id: "u1", email: "x@y", name: null, image: null, role: "user" },
        expires: "",
      },
      isLoading: false,
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ favorited: true, favorite_count: 3 }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    setup({ favorited: false });
    const btn = screen.getByRole("button", { name: /favorite/i });
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(btn);
    await waitFor(() => expect(btn.getAttribute("aria-pressed")).toBe("true"));
  });
});
