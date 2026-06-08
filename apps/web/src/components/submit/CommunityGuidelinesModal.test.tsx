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
      wrap(
        <CommunityGuidelinesModal
          open={false}
          onCancel={() => {}}
          onAccepted={() => {}}
        />,
      ),
    );
    expect(container.firstChild).toBeNull();
  });

  it("disables the checkbox initially (timer running, not scrolled)", () => {
    render(
      wrap(
        <CommunityGuidelinesModal open onCancel={() => {}} onAccepted={() => {}} />,
      ),
    );
    const checkbox = screen.getByRole("checkbox");
    expect(checkbox).toBeDisabled();
  });

  it("calls onCancel when 'cancel' clicked — and NOT onAccepted", () => {
    const onCancel = vi.fn();
    const onAccepted = vi.fn();
    render(
      wrap(
        <CommunityGuidelinesModal open onCancel={onCancel} onAccepted={onAccepted} />,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: /返回|Cancel/ }));
    expect(onCancel).toHaveBeenCalled();
    expect(onAccepted).not.toHaveBeenCalled();
  });

  it("countdown ticks down from 5 to 0", () => {
    render(
      wrap(
        <CommunityGuidelinesModal open onCancel={() => {}} onAccepted={() => {}} />,
      ),
    );
    // Initially: submit button text mentions "5"
    const initialButtons = screen.getAllByRole("button");
    const initialSubmitBtn = initialButtons.find((b) =>
      /5/.test(b.textContent ?? ""),
    );
    expect(initialSubmitBtn).toBeDefined();
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    // After 5s: countdown reaches 0; submit button text changes from "wait_seconds" template to "submit" label
    const buttons = screen.getAllByRole("button");
    const submitBtn = buttons.find((b) =>
      /我同意|I agree/.test(b.textContent ?? ""),
    );
    expect(submitBtn).toBeDefined();
  });
});
