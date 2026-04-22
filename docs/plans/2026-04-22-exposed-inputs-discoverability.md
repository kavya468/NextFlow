# Exposed Inputs Discoverability Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Improve the discoverability of the "exposed inputs" feature by making the toggle icon always visible, adding a contextual "Exposed" pill badge, displaying a summary in the node header, and showing a first-time-use tooltip.

**Architecture:** Modifying `components/nodes/GenericNode.tsx` to add visual feedback based on the existing `exposedInputKeys` state. The tooltip uses standard React `useState` and standard `localStorage` to track if it has been seen, avoiding persistent backend state for UI education.

**Tech Stack:** React, Tailwind CSS, Lucide React (Icons), `localStorage`

---

### Task 1: Update Eye Icon Visibility

**Files:**
- Modify: `components/nodes/GenericNode.tsx`

**Step 1: Modify Standard Inputs Icon Opacity**
In the standard input section of `GenericNode.tsx`, locate the `button` element containing the `Eye` icon toggle.
Update the className string to replace `opacity-0` with `opacity-40`, and `group-hover/input:opacity-60` with `group-hover/input:opacity-70`. Keep `hover:!opacity-100`.

**Step 2: Modify Advanced Inputs Icon Opacity**
Do the same for the `Eye` icon toggle button within the advanced inputs mapping.

**Step 3: Verification**
Load the app in the browser, view a template canvas, and visually confirm the eye icons next to inputs are now faintly visible without hovering over the row.

**Step 4: Commit**
```bash
git add components/nodes/GenericNode.tsx
git commit -m "feat: make exposed input eye icon always visible at 40% opacity"
```

---

### Task 2: Implement "Exposed" Pill Badge

**Files:**
- Modify: `components/nodes/GenericNode.tsx`

**Step 1: Add Pill Badge to Standard Inputs**
Inside the standard input rendering block, right before the eye icon button, add the conditional rendering block:
```tsx
{exposedInputKeys.includes(input.key) && (
  <span className="ml-auto mr-1 text-[8px] px-1.5 py-0.5 rounded-md bg-cyan-500/15 text-cyan-400 border border-cyan-500/20 font-medium">
    Exposed
  </span>
)}
```
Adjust the `ml-auto` class on the eye button: it should only have `ml-auto` if the pill is NOT rendered, otherwise it should just be adjacent (e.g., `className={cn("... your new opacity classes ...", exposedInputKeys.includes(input.key) ? "ml-0.5" : "ml-auto")}`).

**Step 2: Add Pill Badge to Advanced Inputs**
Repeat the exact same logic and component structure for the advanced inputs rendering block.

**Step 3: Verification**
Toggle an input to "exposed" using the eye icon. Visually verify that the cyan "Exposed" pill appears smoothly without disrupting layout.

**Step 4: Commit**
```bash
git add components/nodes/GenericNode.tsx
git commit -m "feat: add cyan pill badge for exposed inputs"
```

---

### Task 3: Implement Node Header Summary Badge

**Files:**
- Modify: `components/nodes/GenericNode.tsx`

**Step 1: Add Badge to Node Header**
Locate the node header definition block. Find the section on the right side where icons (like settings or status) might be shown. Add:
```tsx
{exposedInputKeys.length > 0 && (
  <span className="flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-md bg-cyan-500/10 text-cyan-400/80 border border-cyan-500/15 font-medium mr-2">
    <Eye className="w-2.5 h-2.5" />
    {exposedInputKeys.length} exposed
  </span>
)}
```

**Step 2: Verification**
Expose two inputs on a node. Check the node header to see if the "👁 2 exposed" badge renders correctly. Unexpose all inputs and verify it disappears.

**Step 3: Commit**
```bash
git add components/nodes/GenericNode.tsx
git commit -m "feat: add exposed inputs summary badge to node header"
```

---

### Task 4: Implement First-Encounter Tooltip

**Files:**
- Modify: `components/nodes/GenericNode.tsx`

**Step 1: Add State and Effect**
At the top of the `GenericNode` component, add a state to control the tooltip visibility and a ref to prevent repetitive checks.
```tsx
const [showExposedTip, setShowExposedTip] = useState(false);
const tipCheckedRef = useRef(false);

useEffect(() => {
  if (typeof window !== 'undefined') {
    tipCheckedRef.current = localStorage.getItem("nextflow:exposed-tip-seen") === "true";
  }
}, []);
```

**Step 2: Add MouseEnter Handler**
Create a handler function for the eye icon hover.
```tsx
const handleEyeHover = () => {
  if (!tipCheckedRef.current) {
    setShowExposedTip(true);
  }
};
```
Bind `onMouseEnter={handleEyeHover}` to the eye icon buttons in both standard and advanced inputs.

**Step 3: Create Tooltip Component inline**
Near the bottom of the node (or absolutely positioned within the input row), render the tooltip when `showExposedTip` is true. Ensure it is anchored nicely. A simpler approach is to absolute position it from the eye button container.
(For this step, you will position the tooltip logic inside the input loop or globally on the node, taking care with absolute positioning `z-50`).

**Step 4: Verification**
Hover over an eye icon for the first time. Verify the tooltip pops up. Click "Got it". Verify it disappears. Reload the page and hover again. Verify it does NOT pop up again.

**Step 5: Commit**
```bash
git add components/nodes/GenericNode.tsx
git commit -m "feat: add first-encounter tooltip for exposing inputs"
```
