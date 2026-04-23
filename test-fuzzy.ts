import { getExposedInputs } from './lib/nodes/exposed-inputs';
import { nodeRegistry } from './lib/nodes/registry';

// Mock nodes
const nodes = [
  {
    id: "llm_node_1",
    type: "openrouter-llm",
    data: {
      label: "My LLM",
      exposedInputKeys: ["system_prompt"]
    }
  }
];

// Mock API logic
const variables = { "My LLM": "OVERRIDE PROMPT" };

const { inputs: exposedInputs } = getExposedInputs(nodes, nodeRegistry);
const flattenedVariables: Record<string, any> = {};

for (const [label, fields] of Object.entries(variables)) {
  if (typeof fields === "object" && fields !== null) {
    for (const [field, value] of Object.entries(fields as Record<string, any>)) {
      flattenedVariables[`${label}.${field}`] = value;
    }
  } else {
    // Fuzzy match logic
    if (exposedInputs.some((ei) => ei.label === label)) {
      flattenedVariables[label] = fields;
    } else {
      const matchingExposed = exposedInputs.filter((ei) => {
        const nodeLabel = nodes.find((n) => n.id === ei.nodeId)?.data?.label || ei.nodeType;
        return nodeLabel === label;
      });

      if (matchingExposed.length === 1) {
        flattenedVariables[matchingExposed[0].label] = fields;
      } else {
        flattenedVariables[label] = fields;
      }
    }
  }
}

console.log("Flattened:", flattenedVariables);
