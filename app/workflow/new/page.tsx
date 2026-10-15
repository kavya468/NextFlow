"use client";

import { useSearchParams } from "next/navigation";
import { BuilderPage } from "@/components/builder/BuilderPage";
import { Suspense } from "react";

function NewWorkflowInner() {
  const searchParams = useSearchParams();
  const shouldLoadTemplate = searchParams.get("template") === "cinematic-trailer";

  return (
    <BuilderPage key={shouldLoadTemplate ? "cinematic-trailer" : "new"} loadTemplate={shouldLoadTemplate} />
  );
}

export default function NewWorkflowPage() {
  return (
    <Suspense fallback={<div className="h-screen w-full bg-[#0d0d0d] flex items-center justify-center text-zinc-500">Loading...</div>}>
      <NewWorkflowInner />
    </Suspense>
  );
}
