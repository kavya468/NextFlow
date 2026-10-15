import { describe, expect, it } from "vitest";
import { useStore } from "../store";

const nodes = [{ id: "shared-template-id", type: "text", position: { x: 0, y: 0 }, data: { text: "original" }, selected: true }];
describe("workflow editor isolation", () => {
  it("clears history, clipboard, selection, and runtime state when loading another project", () => {
    const store = useStore.getState();
    store.loadWorkflow("first", nodes, []);
    store.setNodes(nodes);
    store.takeSnapshot();
    store.copySelection();
    store.setRunningNodeIds([nodes[0].id]);
    store.setNodeRunStatuses({ [nodes[0].id]: "RUNNING" });
    store.loadWorkflow("second", nodes, []);
    const second = useStore.getState();
    expect(second).toMatchObject({ workflowScope: "second", past: [], future: [], clipboard: { nodes: [], edges: [] }, runningNodeIds: [], nodeRunStatuses: {} });
    expect(second.nodes[0].selected).toBe(false);
    second.undo();
    expect(useStore.getState().nodes[0].data.text).toBe("original");
    second.clearWorkflow("first");
    expect(useStore.getState().workflowScope).toBe("second");
    second.clearWorkflow("second");
    expect(useStore.getState().nodes).toEqual([]);
  });
});
