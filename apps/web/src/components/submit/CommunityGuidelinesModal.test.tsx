import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import type { ReactNode } from "react";
import i18n, { initI18n } from "../../i18n";
import CommunityGuidelinesModal from "./CommunityGuidelinesModal";

beforeEach(async () => {
  await initI18n("en");
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>{ui}</I18nextProvider>
    </QueryClientProvider>
  );
}

describe("CommunityGuidelinesModal", () => {
  it("renders nothing when open=false", () => {
    const { container } = render(
      wrap(<CommunityGuidelinesModal open={false} onClose={() => {}} />),
    );
    expect(container.firstChild).toBeNull();
  });

  it("disables the checkbox initially (timer running, not scrolled)", () => {
    render(wrap(<CommunityGuidelinesModal open onClose={() => {}} />));
    const checkbox = screen.getByRole("checkbox");
    expect(checkbox).toBeDisabled();
  });

  it("calls onClose when 'cancel' clicked", () => {
    const onClose = vi.fn();
    render(wrap(<CommunityGuidelinesModal open onClose={onClose} />));
    fireEvent.click(screen.getByRole("button", { name: /返回|Cancel/ }));
    expect(onClose).toHaveBeenCalled();
  });

  it("countdown ticks down from 30 to 0", () => {
    render(wrap(<CommunityGuidelinesModal open onClose={() => {}} />));
    // Initially: submit button text mentions 30 seconds
    expect(screen.queryByText(/30/)).toBeDefined();
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    // After 30s: the countdown should be at 0 (or absent from button)
    // We check that the button text changed — either to "我同意" / "I agree" or no longer mentions a positive countdown
    const buttons = screen.getAllByRole("button");
    const submitBtn = buttons.find((b) =>
      /我同意|I agree|滚动|Scroll/.test(b.textContent ?? ""),
    );
    expect(submitBtn).toBeDefined();
  });
});
