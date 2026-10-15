import { describe, expect, it, vi } from "vitest";
import { SaveCoordinator, workflowDocument, type SavedWorkflow, type SaveRequest } from "../save-coordinator";

const doc = (text: string) => workflowDocument("Example", [{ id: "a", type: "text", position: { x: 0, y: 0 }, data: { text } }], []);
const base = (): SavedWorkflow => ({ id: "workflow-a", revision: 1, ...doc("original") });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const saved = (request: SaveRequest, revision: number): SavedWorkflow => ({ ...request.document, id: request.id || "created", revision });

describe("editor save coordination", () => {
  it("serializes writes, coalesces intermediate drafts, and flushes the latest acknowledged revision", async () => {
    const first = deferred<SavedWorkflow>();
    const write = vi.fn<(request: SaveRequest) => Promise<SavedWorkflow>>()
      .mockImplementationOnce(() => first.promise).mockImplementationOnce(async request => saved(request, 3));
    const queue = new SaveCoordinator(doc("original"), base(), write);
    queue.setDraft(doc("first"));
    const result = queue.flush();
    queue.setDraft(doc("second"));
    queue.setDraft(doc("third"));
    expect(queue.flush()).toBe(result);
    expect(write).toHaveBeenCalledTimes(1);
    first.resolve(saved(write.mock.calls[0][0], 2));
    expect(await result).toMatchObject({ revision: 3, nodes: [{ data: { text: "third" } }] });
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[1][0].expectedRevision).toBe(2);
    expect(queue.getSnapshot().status).toBe("saved");
  });

  it("keeps a conflict draft and refuses automatic or explicit overwrite retry", async () => {
    const conflict = { data: { code: "CONFLICT" } };
    const write = vi.fn().mockRejectedValue(conflict);
    const queue = new SaveCoordinator(doc("original"), base(), write);
    queue.setDraft(doc("local"));
    await expect(queue.flush()).rejects.toBe(conflict);
    queue.setDraft(doc("local after conflict"));
    await expect(queue.flush()).rejects.toBe(conflict);
    await expect(queue.retry()).rejects.toBe(conflict);
    expect(write).toHaveBeenCalledTimes(1);
    expect(queue.getDraft().nodes[0].data.text).toBe("local after conflict");
    expect(queue.getSnapshot().status).toBe("conflict");
  });

  it("retries the frozen uncertain write before newer edits, without using a newer base revision", async () => {
    const write = vi.fn<(request: SaveRequest) => Promise<SavedWorkflow>>()
      .mockRejectedValueOnce(new Error("Lost response"))
      .mockImplementationOnce(async request => saved(request, 2))
      .mockImplementationOnce(async request => saved(request, 3));
    const queue = new SaveCoordinator(doc("original"), base(), write);
    queue.setDraft(doc("first"));
    await expect(queue.flush()).rejects.toThrow("Lost response");
    queue.setDraft(doc("newer"));
    await queue.retry();
    expect(write.mock.calls[1][0]).toEqual(write.mock.calls[0][0]);
    expect(write.mock.calls[2][0]).toMatchObject({ expectedRevision: 2, document: doc("newer") });
  });

  it("uses one creation request when autosave and Run flush together", async () => {
    const pending = deferred<SavedWorkflow>();
    const write = vi.fn(() => pending.promise);
    const queue = new SaveCoordinator(doc("new"), undefined, write);
    const a = queue.flush();
    const b = queue.flush();
    expect(a).toBe(b);
    pending.resolve({ id: "created", revision: 0, ...doc("new") });
    expect((await b).id).toBe("created");
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("does not launch queued old-workflow writes or publish late acknowledgments after disposal", async () => {
    const pending = deferred<SavedWorkflow>();
    const write = vi.fn(() => pending.promise);
    const queue = new SaveCoordinator(doc("original"), base(), write);
    const listener = vi.fn();
    queue.subscribe(listener);
    queue.setDraft(doc("first"));
    const result = queue.flush();
    queue.setDraft(doc("second"));
    queue.dispose();
    listener.mockClear();
    pending.resolve({ ...doc("first"), id: "workflow-a", revision: 2 });
    await expect(result).rejects.toThrow("closed");
    expect(write).toHaveBeenCalledTimes(1);
    expect(listener).not.toHaveBeenCalled();
  });


  it("resumes only after an explicit reload replaces the conflicted base", async () => {
    const conflict = { data: { code: "CONFLICT" } };
    const write = vi.fn<(request: SaveRequest) => Promise<SavedWorkflow>>()
      .mockRejectedValueOnce(conflict).mockImplementationOnce(async request => saved(request, 10));
    const queue = new SaveCoordinator(doc("original"), base(), write);
    queue.setDraft(doc("local"));
    await expect(queue.flush()).rejects.toBe(conflict);
    queue.reset({ ...doc("remote"), id: "workflow-a", revision: 9 });
    expect(queue.getDraft()).toEqual(doc("remote"));
    queue.setDraft(doc("after reload"));
    await queue.flush();
    expect(write.mock.calls[1][0].expectedRevision).toBe(9);
  });

  it("adopts canonical labels and ignores selection/measurement-only changes", async () => {
    const write = vi.fn(async () => ({ ...doc("canonical"), id: "workflow-a", revision: 2 }));
    const queue = new SaveCoordinator(doc("original"), base(), write);
    queue.setDraft(workflowDocument("Example", [{ ...doc("original").nodes[0], selected: true, measured: { width: 200 } }], []));
    await queue.flush();
    expect(write).not.toHaveBeenCalled();
    queue.setDraft(doc("local"));
    await queue.flush();
    expect(queue.getDraft().nodes[0].data.text).toBe("canonical");
  });
});
