import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { Unkey } from "@unkey/api";

async function run() {
  const unkey = new Unkey({ rootKey: process.env.UNKEY_ROOT_KEY! });
  const created = await unkey.keys.create({
    apiId: process.env.UNKEY_API_ID!,
    externalId: "user_2lV83Y8D2Kz4lX8nJ1gA8H1G2lH", // Use my Clerk ID if needed, or any string
    expiresIn: 3600
  });
  console.log("Created key:", created.result?.key);
}
run().catch(console.error);
