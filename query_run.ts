import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const run = await prisma.run.findUnique({ where: { id: "44342794-1f41-45f6-abda-b53d9a0d80c5" } })
  console.log(JSON.stringify(run, null, 2))
}
main().catch(console.error).finally(() => prisma.$disconnect())
