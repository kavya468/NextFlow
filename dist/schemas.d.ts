import { z } from "zod";
export declare const NodeSchema: z.ZodObject<{
    id: z.ZodString;
    type: z.ZodString;
    position: z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
    }, z.core.$strip>;
    data: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$loose>;
export declare const EdgeSchema: z.ZodObject<{
    id: z.ZodString;
    source: z.ZodString;
    target: z.ZodString;
    sourceHandle: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    targetHandle: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$loose>;
export declare const ExecuteWorkflowSchema: z.ZodObject<{
    nodes: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        type: z.ZodString;
        position: z.ZodObject<{
            x: z.ZodNumber;
            y: z.ZodNumber;
        }, z.core.$strip>;
        data: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, z.core.$loose>>;
    edges: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        source: z.ZodString;
        target: z.ZodString;
        sourceHandle: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        targetHandle: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$loose>>;
    workflowId: z.ZodOptional<z.ZodString>;
    selectedNodeIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
export type ExecuteWorkflowInput = z.infer<typeof ExecuteWorkflowSchema>;
export declare const SaveWorkflowSchema: z.ZodObject<{
    workflowId: z.ZodOptional<z.ZodString>;
    name: z.ZodOptional<z.ZodString>;
    nodes: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        type: z.ZodString;
        position: z.ZodObject<{
            x: z.ZodNumber;
            y: z.ZodNumber;
        }, z.core.$strip>;
        data: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, z.core.$loose>>;
    edges: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        source: z.ZodString;
        target: z.ZodString;
        sourceHandle: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        targetHandle: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$loose>>;
}, z.core.$strip>;
export type SaveWorkflowInput = z.infer<typeof SaveWorkflowSchema>;
export declare const LoadWorkflowQuerySchema: z.ZodObject<{
    id: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const StatusQuerySchema: z.ZodObject<{
    runId: z.ZodString;
}, z.core.$strip>;
