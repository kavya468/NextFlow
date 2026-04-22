"use client";

import Link from "next/link";
import { Flame, Users } from "lucide-react";

interface TemplateCardProps {
  template: {
    id: string;
    name: string;
    description: string | null;
    thumbnail: string | null;
    category: string | null;
    usageCount: number;
    publishedAt: Date | string | null;
    nodes: any;
    user: { id: string };
  };
}

const CATEGORY_COLORS: Record<string, string> = {
  image: "bg-violet-500/15 text-violet-400 border-violet-500/20",
  video: "bg-rose-500/15 text-rose-400 border-rose-500/20",
  audio: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  text: "bg-sky-500/15 text-sky-400 border-sky-500/20",
};

const PLACEHOLDER_GRADIENTS = [
  "from-violet-900/30 via-indigo-900/20 to-[#141414]",
  "from-rose-900/30 via-pink-900/20 to-[#141414]",
  "from-amber-900/30 via-orange-900/20 to-[#141414]",
  "from-sky-900/30 via-cyan-900/20 to-[#141414]",
  "from-emerald-900/30 via-teal-900/20 to-[#141414]",
];

function formatUsageCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return count.toString();
}

export function TemplateCard({ template }: TemplateCardProps) {
  const nodeCount = Array.isArray(template.nodes) ? template.nodes.length : 0;
  const hash = template.id.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const gradient = PLACEHOLDER_GRADIENTS[hash % PLACEHOLDER_GRADIENTS.length];
  const categoryStyle = template.category
    ? CATEGORY_COLORS[template.category] ?? CATEGORY_COLORS.text
    : CATEGORY_COLORS.text;

  return (
    <Link href={`/templates/${template.id}`} className="group block">
      <div className="bg-[#141414] border border-[var(--node-border)] rounded-xl overflow-hidden hover:border-zinc-500 transition-all duration-200 group-hover:scale-[1.015] group-hover:shadow-xl group-hover:shadow-black/20">
        {/* Thumbnail Area */}
        <div className="relative h-44 overflow-hidden">
          {template.thumbnail ? (
            <img
              src={template.thumbnail}
              alt={template.name}
              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
          ) : (
            <div className={`w-full h-full bg-gradient-to-br ${gradient}`}>
              {/* Mini node-graph decoration (matching WorkflowCard pattern) */}
              <svg
                className="absolute inset-0 w-full h-full opacity-60"
                viewBox="0 0 200 160"
                fill="none"
              >
                <line x1="40" y1="50" x2="100" y2="75" stroke="rgba(113,113,122,0.25)" strokeWidth="1" />
                <line x1="100" y1="75" x2="155" y2="55" stroke="rgba(113,113,122,0.25)" strokeWidth="1" />
                <line x1="100" y1="75" x2="150" y2="115" stroke="rgba(113,113,122,0.25)" strokeWidth="1" />
                <line x1="40" y1="50" x2="50" y2="110" stroke="rgba(113,113,122,0.15)" strokeWidth="1" />
                <line x1="155" y1="55" x2="150" y2="115" stroke="rgba(113,113,122,0.15)" strokeWidth="1" />
                <circle cx="40" cy="50" r="6" fill="rgba(139,92,246,0.35)" stroke="rgba(139,92,246,0.5)" strokeWidth="1" />
                <circle cx="100" cy="75" r="7" fill="rgba(59,130,246,0.3)" stroke="rgba(59,130,246,0.45)" strokeWidth="1" />
                <circle cx="155" cy="55" r="5" fill="rgba(234,179,8,0.3)" stroke="rgba(234,179,8,0.45)" strokeWidth="1" />
                <circle cx="150" cy="115" r="5.5" fill="rgba(236,72,153,0.3)" stroke="rgba(236,72,153,0.45)" strokeWidth="1" />
                <circle cx="50" cy="110" r="4" fill="rgba(113,113,122,0.3)" stroke="rgba(113,113,122,0.4)" strokeWidth="1" />
                <circle cx="40" cy="50" r="2" fill="rgba(139,92,246,0.6)" />
                <circle cx="100" cy="75" r="2.5" fill="rgba(59,130,246,0.5)" />
                <circle cx="155" cy="55" r="1.8" fill="rgba(234,179,8,0.5)" />
                <circle cx="150" cy="115" r="2" fill="rgba(236,72,153,0.5)" />
              </svg>
            </div>
          )}

          {/* Overlay badges */}
          <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5">
            {template.category && (
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-md border backdrop-blur-sm ${categoryStyle}`}>
                {template.category.charAt(0).toUpperCase() + template.category.slice(1)}
              </span>
            )}
          </div>

          {nodeCount > 0 && (
            <div className="absolute bottom-2.5 right-2.5 bg-[var(--badge-bg)] backdrop-blur-sm text-[var(--badge-text)] text-[10px] font-medium px-2 py-0.5 rounded-md border border-[var(--badge-border)]">
              {nodeCount} Node{nodeCount !== 1 ? "s" : ""}
            </div>
          )}
        </div>

        {/* Content Area */}
        <div className="p-3.5 pt-3">
          <p className="text-sm font-medium text-[var(--text-primary)] truncate">
            {template.name}
          </p>
          {template.description && (
            <p className="text-xs text-[var(--text-secondary)] mt-1 line-clamp-2 leading-relaxed">
              {template.description}
            </p>
          )}

          {/* Footer with stats */}
          <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-[var(--separator)]">
            <div className="flex items-center gap-3">
              {template.usageCount > 0 && (
                <span className="flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
                  <Flame className="w-3 h-3 text-orange-400/70" />
                  {formatUsageCount(template.usageCount)} uses
                </span>
              )}
              <span className="flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
                <Users className="w-3 h-3" />
                {template.user.id.slice(0, 8)}…
              </span>
            </div>
            <span className="text-[10px] font-medium text-violet-400 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
              Use →
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}
