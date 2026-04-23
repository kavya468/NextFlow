const input = {
  variables: {
    "OpenRouter LLM": {
      "system_prompt": "TESTING API OVERRIDE"
    },
    "TestLabel": "Direct map test"
  }
};

const flattenedOverrides = {};
const flattenedVariables = {};

if (input.variables) {
  for (const [label, fields] of Object.entries(input.variables)) {
    if (typeof fields === "object" && fields !== null) {
      for (const [field, value] of Object.entries(fields)) {
        flattenedVariables[`${label}.${field}`] = value;
      }
    } else {
      flattenedVariables[label] = fields;
    }
  }
}

const inputValues = { ...flattenedOverrides, ...flattenedVariables };
console.log("inputValues:", inputValues);
