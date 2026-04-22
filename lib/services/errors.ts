export class WorkflowNotFoundError extends Error {
  constructor(identifier: string) {
    super(
      `No workflow found matching "${identifier}". Use list_workflows to see available workflows.`
    );
    this.name = "WorkflowNotFoundError";
  }
}

export class InsufficientCreditsError extends Error {
  constructor(needed: number, have: number) {
    super(
      `Insufficient credits. Need ${needed.toLocaleString()}, have ${have.toLocaleString()}. Add credits in the NextFlow dashboard.`
    );
    this.name = "InsufficientCreditsError";
  }
}

export class NodeNotFoundError extends Error {
  constructor(label: string, workflowName: string) {
    super(
      `No node labeled "${label}" in workflow "${workflowName}". Use list_workflows to see node labels.`
    );
    this.name = "NodeNotFoundError";
  }
}

export class EdgeNotFoundError extends Error {
  constructor(edgeId: string, workflowName: string) {
    super(`No edge "${edgeId}" in workflow "${workflowName}".`);
    this.name = "EdgeNotFoundError";
  }
}

export class ExecutionNotFoundError extends Error {
  constructor(identifier: string) {
    super(
      `No execution found matching "${identifier}". Use get_execution_status with a valid execution ID.`
    );
    this.name = "ExecutionNotFoundError";
  }
}

export class ValidationError extends Error {
  constructor(details: string) {
    super(`Validation failed: ${details}`);
    this.name = "ValidationError";
  }
}

export class OwnershipError extends Error {
  constructor() {
    super(`You don't have access to this resource.`);
    this.name = "OwnershipError";
  }
}

export class DuplicateLabelError extends Error {
  /** The labels that collided, for programmatic inspection. */
  readonly duplicateLabels: string[];

  constructor(duplicates: string[]) {
    const list = duplicates.map((d) => `"${d}"`).join(", ");
    super(
      `Duplicate exposed-input labels detected: ${list}. ` +
      `Each passthrough node must have a unique label to prevent silent data corruption during parameterized execution.`
    );
    this.name = "DuplicateLabelError";
    this.duplicateLabels = duplicates;
  }
}
