import { APP_UI } from "@/lib/ui-config";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import Link from "next/link";
import { redirect } from "next/navigation";
import { WorkflowCard } from "@/components/WorkflowCard";

const TINTS = [
  "from-purple-900/10 via-[#141414] to-[#101010]",
  "from-blue-900/10 via-[#141414] to-[#101010]",
  "from-indigo-900/10 via-[#141414] to-[#101010]",
  "from-cyan-900/10 via-[#141414] to-[#101010]",
  "from-violet-900/10 via-[#141414] to-[#101010]",
  "from-emerald-900/10 via-[#141414] to-[#101010]",
];

export default async function DashboardPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const workflows = await prisma.workflow.findMany({
    where: { userId },
    select: { id: true, revision: true, name: true, updatedAt: true, nodes: true, visibility: true, description: true },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      {/* Workflow studio introduction */}
      <div
        className="relative w-full bg-cover bg-center text-white p-6 lg:p-22"
        style={{
          backgroundImage: `url('/hero-bg.webp')`,
          minHeight: "14rem",
        }}
      >
        <img
          alt=""
          fetchPriority="high"
          className="hero-background pointer-events-none absolute inset-0 z-1 h-full w-full object-cover object-center"
          src="/hero-bg.webp"
        />
        <img
          alt=""
          className="pointer-events-none absolute inset-0 z-0 hidden h-full w-full scale-130 object-cover object-center opacity-15 blur-2xl dark:block"
          src="/hero-bg.webp"
        />

        <div className="relative z-2 flex h-full w-full flex-col justify-between gap-6">
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <img alt="" className="w-9 h-9" src="/node-editor-icon.png" />
              <h1 className="text-3xl font-normal tracking-tight" style={{ fontWeight: 400 }}>
                {APP_UI.dashboard.title}
              </h1>
            </div>
            <p className="font-normal text-base max-w-md" style={{ fontWeight: 400 }}>
              {APP_UI.dashboard.description}
            </p>
          </div>

          <div className="flex flex-col gap-4 xl:flex-row">
            <Link
              href="/workflow/new"
              className="inline-flex items-center gap-2 bg-white text-black font-semibold text-sm w-fit px-6 py-2.5 rounded-full hover:bg-zinc-200 transition-colors shadow-lg"
            >
              New Workflow
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14" /><path d="m12 5 7 7-7 7" />
              </svg>
            </Link>
            <Link
              href="/templates"
              className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm text-white font-medium text-sm w-fit px-6 py-2.5 rounded-full hover:bg-white/20 transition-colors border border-white/10"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="7" height="7" x="3" y="3" rx="1" />
                <rect width="7" height="7" x="14" y="3" rx="1" />
                <rect width="7" height="7" x="14" y="14" rx="1" />
                <rect width="7" height="7" x="3" y="14" rx="1" />
              </svg>
              Browse Templates
            </Link>
            <Link href={APP_UI.demo.href} className="demo-dashboard-link">
              {APP_UI.demo.linkLabel}
            </Link>
          </div>
        </div>
      </div>

      {/* ===== Project Grid ===== */}
      <div className="p-6 py-14 xl:px-22">
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {/* Card 1: New Workflow */}
          <Link href="/workflow/new" className="group block">
            <div className="bg-[#141414] border border-[#1f1f1f] rounded-xl h-44 flex items-center justify-center hover:border-zinc-600 transition-all group-hover:bg-[#1a1a1a]">
              <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center text-white group-hover:bg-white/20 transition-colors">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14" /><path d="M12 5v14" />
                </svg>
              </div>
            </div>
            <p className="text-sm font-medium text-zinc-200 mt-2.5">New Workflow</p>
          </Link>

          {/* Card 2: Template */}
          <Link href="/workflow/new?template=cinematic-trailer" className="group block">
            <div className="bg-[#141414] border border-[#1f1f1f] rounded-xl h-44 flex items-center justify-center overflow-hidden hover:border-zinc-600 transition-all">
              <div className="text-center px-4">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mx-auto text-violet-400 mb-2">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
                <p className="text-xs text-zinc-500">Click to load</p>
              </div>
            </div>
            <p className="text-sm font-medium text-zinc-200 mt-2.5">Cinematic AI Trailer</p>
            <p className="text-xs text-zinc-600">9-Node Video Pipeline Template</p>
          </Link>

          {/* Cards 3+: Saved Workflows */}
          {workflows.map((w) => {
            const hash = w.id.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
            const tint = TINTS[hash % TINTS.length];

            return (
              <WorkflowCard
                key={`${w.id}:${w.revision}`}
                workflow={{
                  id: w.id,
                  revision: w.revision,
                  name: w.name,
                  updatedAt: w.updatedAt.toISOString(),
                  nodes: w.nodes as any[],
                  visibility: w.visibility,
                  description: w.description,
                }}
                tint={tint}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
