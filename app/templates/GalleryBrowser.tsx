"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { TemplateCard } from "@/components/TemplateCard";

const CATEGORIES = [
  { value: "all", label: "All" },
  { value: "image", label: "Image" },
  { value: "video", label: "Video" },
  { value: "audio", label: "Audio" },
  { value: "text", label: "Text" },
] as const;

const SORT_OPTIONS = [
  { value: "popular", label: "Popular" },
  { value: "recent", label: "Recent" },
] as const;

type Category = (typeof CATEGORIES)[number]["value"];
type SortBy = (typeof SORT_OPTIONS)[number]["value"];

interface GalleryBrowserProps {
  initialTemplates: Array<{
    id: string;
    name: string;
    description: string | null;
    thumbnail: string | null;
    category: string | null;
    usageCount: number;
    publishedAt: string | null;
    nodes: any;
    user: { id: string };
  }>;
  initialTotal: number;
}

export function GalleryBrowser({ initialTemplates, initialTotal }: GalleryBrowserProps) {
  const [activeCategory, setActiveCategory] = useState<Category>("all");
  const [sortBy, setSortBy] = useState<SortBy>("popular");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Use tRPC query for filtered results
  const hasActiveFilters = activeCategory !== "all" || sortBy !== "popular" || debouncedSearch !== "";

  const galleryQuery = trpc.workflow.gallery.useQuery(
    {
      category: activeCategory,
      sortBy,
      search: debouncedSearch || undefined,
    },
    {
      enabled: hasActiveFilters,
    }
  );

  const templates = hasActiveFilters
    ? (galleryQuery.data?.templates ?? [])
    : initialTemplates;

  const total = hasActiveFilters
    ? (galleryQuery.data?.total ?? 0)
    : initialTotal;

  // Debounce search input
  const handleSearchChange = (value: string) => {
    setSearch(value);
    const timeout = setTimeout(() => {
      setDebouncedSearch(value);
    }, 300);
    return () => clearTimeout(timeout);
  };

  return (
    <div className="p-6 py-10 xl:px-22">
      {/* Filter Bar */}
      <div className="flex flex-col gap-4 mb-8 sm:flex-row sm:items-center sm:justify-between">
        {/* Category Tabs */}
        <div className="flex items-center gap-1 bg-[#141414] border border-[var(--node-border)] rounded-xl p-1">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.value}
              onClick={() => setActiveCategory(cat.value as Category)}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-lg transition-all duration-200 ${
                activeCategory === cat.value
                  ? "bg-white/10 text-[var(--text-primary)] shadow-sm"
                  : "text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--hover-bg)]"
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          {/* Sort Toggle */}
          <div className="flex items-center gap-1 bg-[#141414] border border-[var(--node-border)] rounded-xl p-1">
            {SORT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setSortBy(opt.value as SortBy)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all duration-200 ${
                  sortBy === opt.value
                    ? "bg-white/10 text-[var(--text-primary)] shadow-sm"
                    : "text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--hover-bg)]"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)]" />
            <input
              type="text"
              placeholder="Search templates…"
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="w-48 bg-[#141414] border border-[var(--node-border)] rounded-xl pl-9 pr-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-placeholder)] focus:outline-none focus:border-zinc-500 transition-colors"
            />
          </div>
        </div>
      </div>

      {/* Loading state */}
      {hasActiveFilters && galleryQuery.isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-[#141414] border border-[var(--node-border)] rounded-xl overflow-hidden animate-pulse">
              <div className="h-44 bg-zinc-800/50" />
              <div className="p-3.5 pt-3 space-y-2">
                <div className="h-4 bg-zinc-800/50 rounded w-3/4" />
                <div className="h-3 bg-zinc-800/30 rounded w-full" />
                <div className="h-3 bg-zinc-800/30 rounded w-2/3" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Template Grid */}
      {(!hasActiveFilters || !galleryQuery.isLoading) && templates.length > 0 && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {templates.map((template) => (
              <TemplateCard key={template.id} template={template as any} />
            ))}
          </div>
          {total > templates.length && (
            <p className="text-center text-xs text-[var(--text-muted)] mt-8">
              Showing {templates.length} of {total} templates
            </p>
          )}
        </>
      )}

      {/* Empty State */}
      {(!hasActiveFilters || !galleryQuery.isLoading) && templates.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-16 h-16 rounded-2xl bg-violet-500/10 flex items-center justify-center mb-5">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-violet-400">
              <rect width="7" height="7" x="3" y="3" rx="1" />
              <rect width="7" height="7" x="14" y="3" rx="1" />
              <rect width="7" height="7" x="14" y="14" rx="1" />
              <rect width="7" height="7" x="3" y="14" rx="1" />
            </svg>
          </div>
          <h3 className="text-base font-medium text-[var(--text-primary)] mb-1.5">
            No templates yet
          </h3>
          <p className="text-sm text-[var(--text-secondary)] max-w-xs">
            {debouncedSearch
              ? `No templates match "${debouncedSearch}". Try a different search.`
              : "Be the first to publish a workflow to the gallery!"}
          </p>
        </div>
      )}
    </div>
  );
}
