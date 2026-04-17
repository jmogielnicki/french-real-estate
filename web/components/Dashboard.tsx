"use client";

import { useState } from "react";
import FiltersPanel from "@/components/Filters";
import TrendChart from "@/components/TrendChart";
import {
  DEFAULT_FILTERS,
  type Filters,
  type Granularity,
  type SplitBy,
} from "@/lib/filters";

export default function Dashboard() {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [granularity, setGranularity] = useState<Granularity>("year");
  const [splitBy, setSplitBy] = useState<SplitBy>("none");

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
      <FiltersPanel
        filters={filters}
        granularity={granularity}
        splitBy={splitBy}
        onChange={setFilters}
        onGranularityChange={setGranularity}
        onSplitByChange={setSplitBy}
      />
      <section className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm">
        <TrendChart filters={filters} granularity={granularity} splitBy={splitBy} />
      </section>
    </div>
  );
}
