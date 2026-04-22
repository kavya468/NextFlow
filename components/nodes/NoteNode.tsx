"use client";

import { memo, useCallback, useRef, useEffect } from "react";
import type { NodeProps } from "@xyflow/react";
import { useStore } from "@/lib/store";

function NoteNodeInner({ id, data, selected }: NodeProps) {
  const text = (data as Record<string, unknown>).text as string ?? "";
  const setNodes = useStore((state) => state.setNodes);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      const nodes = useStore.getState().nodes;
      setNodes(
        nodes.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, text: value } } : n
        )
      );
    },
    [id, setNodes]
  );

  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [text]);

  return (
    <div
      className={`
        min-w-[200px] max-w-[320px] rounded-lg shadow-md
        bg-yellow-100 dark:bg-yellow-900/30
        border border-yellow-300 dark:border-yellow-700
        transition-shadow duration-200
        ${selected ? "shadow-yellow-400/40 dark:shadow-yellow-500/20 ring-1 ring-yellow-400 dark:ring-yellow-600" : ""}
      `}
    >
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-yellow-200/60 dark:border-yellow-700/40">
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-yellow-600 dark:text-yellow-400 shrink-0"
        >
          <path d="M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8Z" />
          <path d="M15 3v4a2 2 0 0 0 2 2h4" />
        </svg>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-yellow-700 dark:text-yellow-400">
          Note
        </span>
      </div>
      <textarea
        ref={textareaRef}
        value={text}
        onChange={handleChange}
        placeholder="Type a note…"
        rows={3}
        className="nodrag nowheel w-full bg-transparent text-[12px] leading-relaxed text-yellow-900 dark:text-yellow-100 placeholder:text-yellow-500/50 dark:placeholder:text-yellow-600/50 resize-none outline-none px-3 py-2 min-h-[60px]"
      />
    </div>
  );
}

export const NoteNode = memo(NoteNodeInner);
