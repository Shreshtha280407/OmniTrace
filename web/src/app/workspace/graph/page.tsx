import { Suspense } from "react";

import { GraphExplorer } from "@/components/graph/GraphExplorer";

export const metadata = { title: "Evidence graph" };

export default function GraphPage() {
  return (
    <main id="main" className="flex min-h-0 flex-1 flex-col">
      {/* useSearchParams needs a Suspense boundary for the static shell. */}
      <Suspense
        fallback={
          <div className="flex flex-1 items-center justify-center" role="status">
            <span className="sr-only">Loading evidence graph</span>
            <div className="skeleton size-32 rounded-full" aria-hidden />
          </div>
        }
      >
        <GraphExplorer />
      </Suspense>
    </main>
  );
}
