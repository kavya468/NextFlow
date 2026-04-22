import type { IOType } from "@/lib/nodes/types";
export interface DataTypeTheme {
    /** The handle/accent color — jewel tone, works on dark bg */
    primary: string;
    /** Dimmed version for idle state (primary at ~40% opacity equivalent) */
    muted: string;
    /** CSS variable name (e.g. '--color-dt-image') */
    cssVar: string;
    /** Tailwind class for text (e.g. 'text-violet-400') */
    textClass: string;
    /** Label shown in UI (e.g. 'Image') */
    label: string;
}
export declare const DataTypeColors: Record<IOType, string>;
export declare const DataTypeMutedColors: Record<IOType, string>;
export declare function getDataTypeTheme(type: IOType): DataTypeTheme;
export declare function getCategoryTheme(category: string): string;
/**
 * Resolves an IOType from a source handle key by looking up the node config.
 * Used by edge components to determine stroke color.
 */
export declare function getIOTypeForHandle(nodeType: string, handleKey: string, direction: "input" | "output"): IOType | null;
