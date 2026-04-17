import { Suspense } from "react";
import Dashboard from "@/components/Dashboard";

export default function Home() {
  return (
    <main className="max-w-6xl mx-auto p-6 space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">
          French Property Sales — DVF+ Explorer
        </h1>
        <p className="text-slate-600 text-sm">
          4.6M residential sales · 2021–2025 · queried in-browser via DuckDB-WASM
        </p>
      </header>

      {/* Suspense required for useSearchParams in Dashboard */}
      <Suspense fallback={<div className="text-slate-400 text-sm py-8">Loading…</div>}>
        <Dashboard />
      </Suspense>

      <footer className="text-xs text-slate-400 pt-4">
        Data: DVF+ from Etalab. Filtered to residential sales (≥1 Maison or
        Appartement, n_rows ≤ 10, price ≥ €1,000, single-commune, type = Vente).
      </footer>
    </main>
  );
}
