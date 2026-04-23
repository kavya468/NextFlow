import { prisma } from "./lib/db.ts";

async function main() {
  const workflows = await prisma.workflow.findMany();
  for (const wf of workflows) {
    const nodes = wf.nodes as any[];
    if (!Array.isArray(nodes)) continue;
    for (const node of nodes) {
      if (node.type === "openrouter-llm" || node.type === "llm") {
        console.log(`Workflow: ${wf.name}, Node: ${node.id}, max_tokens:`, node.data?.config?.max_tokens, typeof node.data?.config?.max_tokens);
      }
    }
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());
