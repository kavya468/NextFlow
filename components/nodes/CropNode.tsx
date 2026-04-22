"use client";

import { Handle, Position, useReactFlow } from "@xyflow/react";
import { Crop, ExternalLink, Copy, Check } from "lucide-react";
import { useStore } from "@/lib/store";
import { useConnectedHandles } from "@/lib/useConnectedHandles";
import { useCallback, useState } from "react";

const handleStyleLeft = { left: -5, top: '50%', transform: 'translateY(-50%)' };
const handleStyleRight = { right: -5, left: 'auto', top: '50%', transform: 'translateY(-50%)' };

export function CropNode({ id, data, selected }: { id: string; data: any; selected?: boolean }) {
  const isRunning = useStore((state) => state.runningNodeIds.includes(id));
  const { setNodes } = useReactFlow();
  const [copied, setCopied] = useState(false);
  const connected = useConnectedHandles(id);

  const updateField = useCallback(
    (field: string, value: number) => {
      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id ? { ...node, data: { ...node.data, [field]: value } } : node
        )
      );
    },
    [id, setNodes]
  );

  const outputUrl = data.result_url || data.output_url;

  const copyUrl = () => {
    if (outputUrl) {
      navigator.clipboard.writeText(outputUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className={`bg-[var(--node-bg)] rounded-2xl w-[280px] pb-4 ${selected ? "border-[1.5px] border-[var(--node-selected-border)]" : "border-[1px] border-[var(--node-border)]"} ${isRunning ? "animate-node-pulse" : ""} shadow-2xl`}>
      {/* Header */}
      <div className="flex justify-between items-center px-4 py-3 border-b border-[var(--node-divider)]">
        <span className="text-[11px] font-medium text-[var(--text-secondary)]">Crop Image</span>
        <Crop className="w-3.5 h-3.5 text-orange-400" />
      </div>

      <div className="flex flex-col gap-4 pt-4">
        {/* Input Handles */}
        <div className="flex flex-col gap-3">
          <div className="relative flex items-center h-6 px-5">
            <Handle type="target" position={Position.Left} id="image_url" style={handleStyleLeft} className="!bg-blue-500 !w-2.5 !h-2.5 !border-[2px] !border-[var(--node-bg)] !ring-[1.5px] !ring-blue-500/40 hover:!ring-blue-500/70 hover:!scale-110 !transition-all" />
            <span className="text-[11px] font-medium text-[var(--text-primary)]">Image URL</span>
            {connected.has("image_url") && <span className="ml-auto text-[9px] text-[var(--text-secondary)] font-medium">● linked</span>}
          </div>
          <div className="relative flex items-center h-6 px-5">
            <Handle type="target" position={Position.Left} id="x_percent" style={handleStyleLeft} className="!bg-yellow-500 !w-2.5 !h-2.5 !border-[2px] !border-[var(--node-bg)] !ring-[1.5px] !ring-yellow-500/40 hover:!ring-yellow-500/70 hover:!scale-110 !transition-all" />
            <span className="text-[11px] font-medium text-[var(--text-primary)]">X %</span>
            {connected.has("x_percent") && <span className="ml-auto text-[9px] text-[var(--text-secondary)] font-medium">● linked</span>}
          </div>
          <div className="relative flex items-center h-6 px-5">
            <Handle type="target" position={Position.Left} id="y_percent" style={handleStyleLeft} className="!bg-yellow-500 !w-2.5 !h-2.5 !border-[2px] !border-[var(--node-bg)] !ring-[1.5px] !ring-yellow-500/40 hover:!ring-yellow-500/70 hover:!scale-110 !transition-all" />
            <span className="text-[11px] font-medium text-[var(--text-primary)]">Y %</span>
            {connected.has("y_percent") && <span className="ml-auto text-[9px] text-[var(--text-secondary)] font-medium">● linked</span>}
          </div>
          <div className="relative flex items-center h-6 px-5">
            <Handle type="target" position={Position.Left} id="width_percent" style={handleStyleLeft} className="!bg-yellow-500 !w-2.5 !h-2.5 !border-[2px] !border-[var(--node-bg)] !ring-[1.5px] !ring-yellow-500/40 hover:!ring-yellow-500/70 hover:!scale-110 !transition-all" />
            <span className="text-[11px] font-medium text-[var(--text-primary)]">Width %</span>
            {connected.has("width_percent") && <span className="ml-auto text-[9px] text-[var(--text-secondary)] font-medium">● linked</span>}
          </div>
          <div className="relative flex items-center h-6 px-5">
            <Handle type="target" position={Position.Left} id="height_percent" style={handleStyleLeft} className="!bg-yellow-500 !w-2.5 !h-2.5 !border-[2px] !border-[var(--node-bg)] !ring-[1.5px] !ring-yellow-500/40 hover:!ring-yellow-500/70 hover:!scale-110 !transition-all" />
            <span className="text-[11px] font-medium text-[var(--text-primary)]">Height %</span>
            {connected.has("height_percent") && <span className="ml-auto text-[9px] text-[var(--text-secondary)] font-medium">● linked</span>}
          </div>
        </div>

        {/* Crop Parameters Override Inputs */}
        <div className="px-4">
          <div className="grid grid-cols-2 gap-1.5">
            {[
              { label: "X", field: "x_percent", defaultVal: 0 },
              { label: "Y", field: "y_percent", defaultVal: 0 },
              { label: "W", field: "width_percent", defaultVal: 100 },
              { label: "H", field: "height_percent", defaultVal: 100 },
            ].map(({ label, field, defaultVal }) => (
              <div key={field} className={`flex bg-[var(--input-bg)] border rounded-lg overflow-hidden ${connected.has(field) ? 'border-[var(--input-border)] opacity-50' : 'border-[var(--input-border)]'}`}>
                <span className="bg-[var(--input-bg)] text-[var(--text-secondary)] text-[10px] px-2 py-1.5 border-r border-[var(--input-border)] w-7 text-center shrink-0">{label}</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={data[field] ?? defaultVal}
                  onChange={(e) => updateField(field, Math.max(0, Math.min(100, Number(e.target.value))))}
                  disabled={connected.has(field)}
                  className="w-full bg-transparent text-[11px] p-1.5 text-[var(--text-primary)] focus:outline-none nodrag text-center disabled:cursor-not-allowed disabled:text-[var(--text-muted)]"
                />
                <span className="text-[var(--text-muted)] text-[9px] pr-1.5 flex items-center">%</span>
              </div>
            ))}
          </div>
        </div>

        <div className="w-full h-[1px] bg-[var(--node-divider)] my-1" />

        {/* Output Handle */}
        <div className="relative flex items-center justify-end h-6 px-5 mb-1">
          <span className="text-[11px] font-medium text-[var(--text-primary)]">Cropped Image</span>
          <Handle type="source" position={Position.Right} id="output" style={handleStyleRight} className="!bg-blue-500 !w-2.5 !h-2.5 !border-[2px] !border-[var(--node-bg)] !ring-[1.5px] !ring-blue-500/40 hover:!ring-blue-500/70 hover:!scale-110 !transition-all" />
        </div>

        {/* Output URL Display */}
        {outputUrl && (
          <div className="px-4">
            <div className="bg-[var(--node-inner-bg)] border border-[var(--status-success-border)] rounded-lg p-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[9px] font-medium text-[var(--status-success)]">✓ Cropped Output</span>
                <div className="flex gap-1">
                  <button onClick={copyUrl} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors" title="Copy URL">
                    {copied ? <Check className="w-3 h-3 text-[var(--status-success)]" /> : <Copy className="w-3 h-3" />}
                  </button>
                  <a href={outputUrl} target="_blank" rel="noopener noreferrer" className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors" title="Open in new tab">
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
              <img src={outputUrl} alt="Cropped result" className="w-full h-20 object-cover rounded" />
              <p className="text-[8px] text-[var(--text-placeholder)] mt-1 truncate font-mono">{outputUrl}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
