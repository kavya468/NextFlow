import { createTRPCRouter } from "./trpc";
import { workflowRouter } from "./routers/workflow";
import { creditsRouter } from "./routers/credits";
import { apiKeysRouter } from "./routers/apiKeys";

export const appRouter = createTRPCRouter({
  workflow: workflowRouter,
  credits: creditsRouter,
  apiKeys: apiKeysRouter,
});

export type AppRouter = typeof appRouter;
