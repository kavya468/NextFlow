"use client";

import { useParams } from "next/navigation";
import { BuilderPage } from "@/components/builder/BuilderPage";
import { Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc/client";

export default function WorkflowByIdPage() {
  const params = useParams();
  const id = params.id as string;

  const { data: workflow, isLoading, error } = trpc.workflow.load.useQuery({ id });

  if (isLoading) {
    return (
      <div className="h-screen w-full bg-[#0d0d0d] flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-zinc-500 animate-spin" />
      </div>
    );
  }

  if (error || !workflow) {
    return (
      <div className="h-screen w-full bg-[#0d0d0d] flex flex-col items-center justify-center gap-4 text-zinc-400">
        <p>{error?.message || "Workflow not found"}</p>
        <a href="/dashboard" className="text-blue-400 hover:underline text-sm">← Back to Dashboard</a>
      </div>
    );
  }

  return (
    <BuilderPage
      initialWorkflowId={workflow.id}
      initialName={workflow.name}
      initialNodes={workflow.nodes as any[]}
      initialEdges={workflow.edges as any[]}
    />
  );
}
