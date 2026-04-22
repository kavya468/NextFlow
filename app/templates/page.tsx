import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import Link from "next/link";
import { GalleryBrowser } from "./GalleryBrowser";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Template Gallery | NextFlow",
  description: "Explore AI workflow templates for image, video, audio, and text generation. Run any template with custom inputs.",
};

export default async function TemplatesPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  // Server-side initial fetch of published templates
  const templates = await prisma.workflow.findMany({
    where: { visibility: "published" },
    select: {
      id: true,
      name: true,
      description: true,
      thumbnail: true,
      category: true,
      usageCount: true,
      publishedAt: true,
      nodes: true,
      user: { select: { id: true } },
    },
    orderBy: { usageCount: "desc" },
    take: 20,
  });

  const total = await prisma.workflow.count({
    where: { visibility: "published" },
  });

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      {/* ===== Hero Section ===== */}
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
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-violet-400">
                <rect width="7" height="7" x="3" y="3" rx="1" />
                <rect width="7" height="7" x="14" y="3" rx="1" />
                <rect width="7" height="7" x="14" y="14" rx="1" />
                <rect width="7" height="7" x="3" y="14" rx="1" />
              </svg>
              <h1 className="text-3xl font-normal tracking-tight" style={{ fontWeight: 400 }}>
                Template Gallery
              </h1>
            </div>
            <p className="font-normal text-base max-w-md" style={{ fontWeight: 400 }}>
              Explore templates for every AI creative need. Run any workflow
              with custom inputs — no building required.
            </p>
          </div>

          <div className="flex flex-col gap-4 xl:flex-row">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm text-white font-medium text-sm w-fit px-5 py-2 rounded-full hover:bg-white/20 transition-colors border border-white/10"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="m12 19-7-7 7-7" /><path d="M19 12H5" />
              </svg>
              My Workflows
            </Link>
          </div>
        </div>
      </div>

      {/* ===== Gallery Browser (Client Component) ===== */}
      <GalleryBrowser
        initialTemplates={templates.map((t) => ({
          ...t,
          publishedAt: t.publishedAt?.toISOString() ?? null,
        }))}
        initialTotal={total}
      />
    </div>
  );
}
