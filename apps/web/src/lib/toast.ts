import { create } from "zustand";

export type ToastVariant = "info" | "success" | "error";

export type Toast = {
  id: number;
  variant: ToastVariant;
  message: string;
};

type State = {
  toasts: Toast[];
  push: (variant: ToastVariant, message: string) => void;
  dismiss: (id: number) => void;
};

let nextId = 1;
const DEFAULT_TTL_MS = 4000;

export const useToastStore = create<State>((set, get) => ({
  toasts: [],
  push(variant, message) {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts, { id, variant, message }] }));
    setTimeout(() => get().dismiss(id), DEFAULT_TTL_MS);
  },
  dismiss(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

export const toast = {
  info: (msg: string) => useToastStore.getState().push("info", msg),
  success: (msg: string) => useToastStore.getState().push("success", msg),
  error: (msg: string) => useToastStore.getState().push("error", msg),
};
