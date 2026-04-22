// ============================================================================
// lib/nodes/configs/index.ts — Config auto-discovery and registration
// ============================================================================
//
// Import all node config files here. The registry auto-registers them
// on import. When adding a new node, create a config file in this directory
// and add a single import + registration line below.
// ============================================================================

import { nodeRegistry } from "../registry";
import { cropConfig } from "./crop";
import { llmConfig } from "./llm";
import { textConfig } from "./text";
import { imageConfig } from "./image";
import { extractConfig } from "./extract";
import { videoConfig } from "./video";
import { seedreamConfig } from "./seedream.config";
import { extractAudioConfig } from "./extract-audio.config";
import { mergeAudioVideoConfig } from "./merge-audio-video.config";
import { mergeVideosConfig } from "./merge-videos.config";
import { openrouterConfig } from "./openrouter.config";
import { elevenlabsConfig } from "./elevenlabs.config";
import { klingConfig } from "./kling.config";
import { syncLipsyncConfig } from "./sync-lipsync.config";
import { seedanceConfig } from "./seedance.config";

// Register all node configs in a single batch call
nodeRegistry.registerAll([
  // ── Input Nodes (Passthrough) ──
  textConfig,
  imageConfig,

  // ── AI Nodes ──
  llmConfig,
  seedreamConfig,
  openrouterConfig,
  elevenlabsConfig,
  klingConfig,
  seedanceConfig,

  // ── Media Nodes ──
  cropConfig,
  extractConfig,
  extractAudioConfig,
  mergeAudioVideoConfig,
  mergeVideosConfig,
  syncLipsyncConfig,
  videoConfig,
]);

export {
  cropConfig,
  llmConfig,
  textConfig,
  imageConfig,
  extractConfig,
  extractAudioConfig,
  mergeAudioVideoConfig,
  mergeVideosConfig,
  videoConfig,
  openrouterConfig,
  seedreamConfig,
  elevenlabsConfig,
  klingConfig,
  syncLipsyncConfig,
  seedanceConfig,
};
