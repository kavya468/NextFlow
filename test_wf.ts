import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const wf = await prisma.workflow.findUnique({
    where: { id: "063c32d7-62b7-4279-9fad-a7905ef6c3cd" },
    include: { nodes: true, edges: true }
  });
  console.dir(wf, { depth: null });
}
main().catch(console.error).finally(() => prisma.$disconnect());
