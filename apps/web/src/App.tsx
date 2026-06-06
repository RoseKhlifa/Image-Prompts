import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/query-client";
import AppRouter from "./routes/index";

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="min-h-dvh bg-canvas text-ink">
        <AppRouter />
      </div>
    </QueryClientProvider>
  );
}
