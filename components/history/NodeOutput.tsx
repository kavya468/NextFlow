"use client";

import { useState, useMemo } from "react";
import * as Collapsible from "@radix-ui/react-collapsible";
import { ChevronDown, ExternalLink, Image, Film, Music } from "lucide-react";

const MEDIA_EXT: Record<string, "image" | "video" | "audio"> = {
  ".png": "image", ".jpg": "image", ".jpeg": "image", ".webp": "image",
  ".gif": "image", ".bmp": "image", ".svg": "image",
  ".mp4": "video", ".webm": "video", ".mov": "video", ".avi": "video",
  ".mp3": "audio", ".wav": "audio", ".ogg": "audio", ".aac": "audio",
  ".flac": "audio",
};

function inferMediaType(url: string): "image" | "video" | "audio" | null {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    const ext = pathname.slice(pathname.lastIndexOf("."));
    return MEDIA_EXT[ext] ?? null;
  } catch {
    return null;
  }
}

function isUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function MediaPreview({ url, type, label }: { url: string; type: "image" | "video" | "audio"; label: string }) {
  const [error, setError] = useState(false);

  if (error) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1.5 text-xs text-sky-400 hover:text-sky-300 transition-colors"
      >
        <ExternalLink className="w-3 h-3 shrink-0" />
        <span className="truncate">{label}</span>
      </a>
    );
  }

  if (type === "image") {
    return (
      <div className="mt-1.5">
        {label !== "url" && (
          <span className="text-[10px] text-[var(--text-secondary)] mb-1 block">{label}</span>
        )}
        <img
          src={url}
          alt={label}
          onError={() => setError(true)}
          className="w-full max-h-48 object-contain bg-[var(--badge-bg)] rounded-md border border-[var(--separator)] p-1"
        />
      </div>
    );
  }

  if (type === "video") {
    return (
      <div className="mt-1.5">
        {label !== "url" && (
          <span className="text-[10px] text-[var(--text-secondary)] mb-1 block">{label}</span>
        )}
        <video
          src={url}
          controls
          onError={() => setError(true)}
          className="w-full max-h-32 rounded-md border border-[var(--separator)]"
        />
      </div>
    );
  }

  return (
    <div className="mt-1.5">
      {label !== "url" && (
        <span className="text-[10px] text-[var(--text-secondary)] mb-1 block">{label}</span>
      )}
      <audio
        src={url}
        controls
        onError={() => setError(true)}
        className="w-full h-8 rounded-md"
      />
    </div>
  );
}

function ExpandableText({ label, text }: { label: string; text: string }) {
  const [open, setOpen] = useState(false);
  const preview = text.slice(0, 120);

  return (
    <Collapsible.Root open={open} onOpenChange={setOpen}>
      <div className="flex flex-col gap-1 mb-3">
        <span className="text-[10px] uppercase tracking-wider font-semibold text-[var(--text-muted)]">
          {label.replace(/_/g, ' ')}
        </span>
        <div className="bg-[var(--badge-bg)]/40 border border-[var(--separator)]/50 rounded-md p-2.5 text-xs text-[var(--text-primary)] leading-relaxed overflow-x-auto">
          <Collapsible.Trigger asChild>
            <button className="text-left group w-full">
              <span className="text-[var(--text-primary)] leading-relaxed">
                {open ? text : preview}
                {!open && text.length > 120 && (
                  <span className="text-[var(--text-accent)]/80 ml-1 group-hover:text-[var(--text-accent-hover)] transition-colors inline-flex items-center gap-0.5">
                    Show more
                    <ChevronDown className="w-3 h-3" />
                  </span>
                )}
              </span>
            </button>
          </Collapsible.Trigger>
          {open && (
            <Collapsible.Content forceMount>
              <button
                onClick={() => setOpen(false)}
                className="text-sky-400/80 hover:text-sky-300 transition-colors text-[10px] mt-1 inline-flex items-center gap-0.5"
              >
                Show less
                <ChevronDown className="w-3 h-3 rotate-180" />
              </button>
            </Collapsible.Content>
          )}
        </div>
      </div>
    </Collapsible.Root>
  );
}

function UrlPreviewOrLink({ url, label }: { url: string; label: string }) {
  const mediaType = useMemo(() => inferMediaType(url), [url]);

  if (mediaType) {
    return <MediaPreview url={url} type={mediaType} label={label} />;
  }

  const MediaIcon = label.includes("image") ? Image
    : label.includes("video") ? Film
    : label.includes("audio") ? Music
    : ExternalLink;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-1.5 text-xs text-sky-400 hover:text-sky-300 transition-colors mt-0.5"
    >
      <MediaIcon className="w-3 h-3 shrink-0" />
      <span className="truncate max-w-[200px]">{url}</span>
    </a>
  );
}

interface NodeOutputProps {
  outputs: Record<string, unknown>;
  nodeType: string;
}

export function NodeOutput({ outputs, nodeType }: NodeOutputProps) {
  const entries = Object.entries(outputs).filter(
    ([, value]) => value !== undefined && value !== null && value !== ""
  );

  if (entries.length === 0) return null;

  return (
    <div className="space-y-1.5 pt-1.5">
      {entries.map(([key, value]) => {
        if (Array.isArray(value)) {
          return (
            <div key={key} className="flex flex-col gap-1 mb-3">
              <span className="text-[10px] uppercase tracking-wider font-semibold text-[var(--text-muted)]">{key.replace(/_/g, ' ')}</span>
              {value.map((item, idx) => {
                if (typeof item === "string" && isUrl(item)) {
                  return (
                    <UrlPreviewOrLink
                      key={`${key}-${idx}`}
                      url={item}
                      label={`${key} ${idx + 1}`}
                    />
                  );
                }
                return (
                  <span key={`${key}-${idx}`} className="text-[var(--text-primary)] font-mono text-xs block truncate w-full">
                    {String(item)}
                  </span>
                );
              })}
            </div>
          );
        }

        if (typeof value === "string" && isUrl(value)) {
          return <UrlPreviewOrLink key={key} url={value} label={key} />;
        }

        if (typeof value === "string" && value.length > 120) {
          return <ExpandableText key={key} label={key} text={value} />;
        }

        if (typeof value === "string") {
          return (
            <div key={key} className="flex flex-col gap-1 mb-3">
              <span className="text-[10px] uppercase tracking-wider font-semibold text-[var(--text-muted)]">
                {key.replace(/_/g, ' ')}
              </span>
              <div className="bg-[var(--badge-bg)]/40 border border-[var(--separator)]/50 rounded-md p-2.5 text-xs text-[var(--text-primary)] leading-relaxed overflow-x-auto">
                {value}
              </div>
            </div>
          );
        }

        if (typeof value === "object") {
          return (
            <div key={key} className="flex flex-col gap-1 mb-3">
              <span className="text-[10px] uppercase tracking-wider font-semibold text-[var(--text-muted)]">
                {key.replace(/_/g, ' ')}
              </span>
              <pre className="text-[var(--text-secondary)] text-[10px] bg-[var(--badge-bg)]/40 border border-[var(--separator)]/50 rounded-md p-2.5 overflow-x-auto max-h-28 leading-relaxed">
                {JSON.stringify(value, null, 2)}
              </pre>
            </div>
          );
        }

        return (
          <div key={key} className="flex flex-col gap-1 mb-3">
            <span className="text-[10px] uppercase tracking-wider font-semibold text-[var(--text-muted)]">
              {key.replace(/_/g, ' ')}
            </span>
            <div className="bg-[var(--badge-bg)]/40 border border-[var(--separator)]/50 rounded-md p-2.5 text-xs font-mono text-[var(--text-primary)] leading-relaxed overflow-x-auto">
              {String(value)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
