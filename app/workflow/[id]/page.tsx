"use client";

import type { Node, Edge } from "@xyflow/react";
import { useParams } from "next/navigation";
import { BuilderPage } from "@/components/builder/BuilderPage";
import { Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc/client";

export default function WorkflowByIdPage() {
  const params = useParams();
  const id = params.id as string;

  const { data: workflow, isLoading, isFetching, isFetchedAfterMount, error } = trpc.workflow.load.useQuery({ id }, { refetchOnMount: "always" });

  if (isLoading || (isFetching && !isFetchedAfterMount) || (workflow && workflow.id !== id)) {
    return (
      <div className="h-screen w-full bg-[#0d0d0d] flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-zinc-500 animate-spin" />
      </div>
    );
  }

  // A background refetch error must not unmount an editor with a local draft.
  if (!workflow) {
    return (
      <div className="h-screen w-full bg-[#0d0d0d] flex flex-col items-center justify-center gap-4 text-zinc-400">
        <p>{error?.message || "Workflow not found"}</p>
        <a href="/dashboard" className="text-blue-400 hover:underline text-sm">← Back to Dashboard</a>
      </div>
    );
  }

  return (
    <BuilderPage
      key={workflow.id}
      initialWorkflowId={workflow.id}
      initialRevision={workflow.revision}
      initialName={workflow.name}
      initialNodes={workflow.nodes as unknown as Node[]}
      initialEdges={workflow.edges as unknown as Edge[]}
    />
  );
}
