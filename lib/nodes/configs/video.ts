// ============================================================================
// lib/nodes/configs/video.ts — Video Upload (Passthrough) Node Configuration
// ============================================================================
//
// Pure SOURCE node — no incoming connections, no input handles.
// The user uploads a video via GenericNode's MediaSourceArea, which stores
// the CDN URL in node.data.url. The orchestrator reads via
// passthroughMapping: { url → video_url }.
// ============================================================================

import type { NodeConfig } from "../types";

export const videoConfig: NodeConfig = {
  id: "video",
  name: "Video",
  description: "Upload and passthrough a video URL",
  category: "media",
  icon: "Video",
  version: "1.0.0",

  // No inputs — pure source node. URL stored in node.data.url by upload UI.
  inputs: [],

  outputs: [
    { key: "video_url", type: "video", label: "Video URL" },
  ],

  isPassthrough: true,
  passthroughMapping: {
    url: "video_url",
  },
  providers: [],
  credits: {
    estimate: () => 0,
    calculate: () => 0,
  },
  ui: {
    color: "text-pink-400",
    width: 260,
    showOutputPreview: false,
  },
};
