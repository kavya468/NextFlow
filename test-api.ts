import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function run() {
  const rootKey = process.env.UNKEY_ROOT_KEY;
  if (!rootKey) throw new Error("No UNKEY_ROOT_KEY");
  
  const workflowId = "e90a888c-cd1a-4a5a-96a7-c9e9bc9638b9";
  console.log("Using workflow ID:", workflowId);
  
  const payload = {
    variables: {
      "OpenRouter LLM": {
        "system_prompt": "TESTING API OVERRIDE"
      },
      "TestLabel": "Direct map test"
    }
  };

  console.log("Sending payload:", JSON.stringify(payload, null, 2));

  const res = await fetch(`http://localhost:3000/api/v1/workflows/${workflowId}/execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${rootKey}`
    },
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  console.log("API Response:", res.status, data);
}

run().catch(console.error);
