import { prisma } from "./lib/db.ts";

async function main() {
  const workflows = await prisma.workflow.findMany();
  let count = 0;

  for (const wf of workflows) {
    let changed = false;
    const nodes = wf.nodes as any[];

    if (!Array.isArray(nodes)) continue;

    for (const node of nodes) {
      if (node.data && node.data.config && node.data.config.max_tokens === 1024) {
        node.data.config.max_tokens = 512;
        changed = true;
      }
    }

    if (changed) {
      await prisma.workflow.update({
        where: { id: wf.id },
        data: { nodes },
      });
      count++;
    }
  }

  console.log(`Updated ${count} workflows.`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
