# Exposed Inputs Discoverability — Design Spec

**Date:** 2026-04-22  
**Scope:** Canvas editor side only — `GenericNode.tsx`  
**Goal:** Make the "expose input for template" feature discoverable, self-explanatory, and give clear feedback.

---

## Problem

The eye icon toggle that marks node inputs as exposed for template execution is:
1. **Invisible** — `opacity-0` by default, only appears on hover over the exact input row
2. **Unexplained** — no education about what "exposing" means or why a user would want it
3. **No feedback** — after toggling, the only change is a tiny icon color flip; no summary of exposed state at the node level

A new user will never discover this feature.

## Solution: "Always-Visible Badge" (Approach 1)

Three changes to `GenericNode.tsx`, all contained within that single file plus a `localStorage` flag.

---

### A. Eye Icon — Always Visible

**File:** `GenericNode.tsx` — standard inputs section (~L1551–1565) and advanced inputs section (~L1640–1654)

**Before:**
```
opacity-0 group-hover/input:opacity-60 hover:!opacity-100
```

**After:**
```
opacity-40 group-hover/input:opacity-70 hover:!opacity-100
```

The icon is always visible at 40% opacity. On row hover it brightens to 70%. On direct hover it's 100%.

When **exposed** (`exposedInputKeys.includes(input.key)`):
- Icon: `Eye` (unchanged)
- Color: `text-cyan-400 opacity-100` (unchanged)
- **New:** An inline "Exposed" pill badge appears between the label and the icon

**Pill badge markup (inserted after the `● linked` span, before the eye button):**
```tsx
{exposedInputKeys.includes(input.key) && (
  <span className="ml-auto mr-1 text-[8px] px-1.5 py-0.5 rounded-md bg-cyan-500/15 text-cyan-400 border border-cyan-500/20 font-medium">
    Exposed
  </span>
)}
```

When the badge is present, it takes `ml-auto` and the eye button loses `ml-auto` (gets `ml-0.5` instead) to keep them adjacent on the right.

When not exposed, the eye button retains `ml-auto`.

---

### B. First-Encounter Tooltip

**File:** `GenericNode.tsx` — new state + tiny popover component

**Mechanism:**
- On component mount, read `localStorage.getItem("nextflow:exposed-tip-seen")`
- Track via a module-level or context-level ref (not per-node state) to avoid re-renders
- On first `onMouseEnter` of any eye icon, if flag is not set, show a floating tooltip

**Tooltip content:**
> "Expose this input so template users can customize it at run time."

**Tooltip UI:**
- Positioned to the right of the eye icon (or above if clipped)
- Dark background (`bg-zinc-900 border border-zinc-700`), `text-[10px]`, max-width 200px
- Small "Got it" text button at the bottom
- On click "Got it": `localStorage.setItem("nextflow:exposed-tip-seen", "true")` → tooltip dismissed permanently

**Implementation:** A small `ExposeTip` component rendered conditionally. Uses `useState` for visibility and a `useRef` for the anchor position. Portal not needed — can be absolute-positioned within the input row's `relative` container.

---

### C. Node Header Summary Badge

**File:** `GenericNode.tsx` — header section (~L1481–1513)

**When** `exposedInputKeys.length > 0`, render a badge in the header's right-side icon group:

```tsx
{exposedInputKeys.length > 0 && (
  <span className="flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-md bg-cyan-500/10 text-cyan-400/80 border border-cyan-500/15 font-medium">
    <Eye className="w-2.5 h-2.5" />
    {exposedInputKeys.length} exposed
  </span>
)}
```

**Placement:** Before the node type icon and run button in the header's right `div`.

---

## Files Changed

| File | Change |
|------|--------|
| `components/nodes/GenericNode.tsx` | All three changes (A, B, C) |

No backend changes. No new dependencies. No new files (the tooltip is a small inline component).

## Non-Goals

- Template consumer side ("Customize Inputs" form) is not modified
- No onboarding tour or multi-step walkthrough
- No persistence of tooltip state beyond `localStorage`
