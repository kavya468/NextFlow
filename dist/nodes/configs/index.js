"use strict";
// ============================================================================
// lib/nodes/configs/index.ts — Config auto-discovery and registration
// ============================================================================
//
// Import all node config files here. The registry auto-registers them
// on import. When adding a new node, create a config file in this directory
// and add a single import + registration line below.
// ============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.seedanceConfig = exports.syncLipsyncConfig = exports.klingConfig = exports.elevenlabsConfig = exports.seedreamConfig = exports.openrouterConfig = exports.videoConfig = exports.mergeVideosConfig = exports.mergeAudioVideoConfig = exports.extractAudioConfig = exports.extractConfig = exports.imageConfig = exports.textConfig = exports.llmConfig = exports.cropConfig = void 0;
const registry_1 = require("../registry");
const crop_1 = require("./crop");
Object.defineProperty(exports, "cropConfig", { enumerable: true, get: function () { return crop_1.cropConfig; } });
const llm_1 = require("./llm");
Object.defineProperty(exports, "llmConfig", { enumerable: true, get: function () { return llm_1.llmConfig; } });
const text_1 = require("./text");
Object.defineProperty(exports, "textConfig", { enumerable: true, get: function () { return text_1.textConfig; } });
const image_1 = require("./image");
Object.defineProperty(exports, "imageConfig", { enumerable: true, get: function () { return image_1.imageConfig; } });
const extract_1 = require("./extract");
Object.defineProperty(exports, "extractConfig", { enumerable: true, get: function () { return extract_1.extractConfig; } });
const video_1 = require("./video");
Object.defineProperty(exports, "videoConfig", { enumerable: true, get: function () { return video_1.videoConfig; } });
const seedream_config_1 = require("./seedream.config");
Object.defineProperty(exports, "seedreamConfig", { enumerable: true, get: function () { return seedream_config_1.seedreamConfig; } });
const extract_audio_config_1 = require("./extract-audio.config");
Object.defineProperty(exports, "extractAudioConfig", { enumerable: true, get: function () { return extract_audio_config_1.extractAudioConfig; } });
const merge_audio_video_config_1 = require("./merge-audio-video.config");
Object.defineProperty(exports, "mergeAudioVideoConfig", { enumerable: true, get: function () { return merge_audio_video_config_1.mergeAudioVideoConfig; } });
const merge_videos_config_1 = require("./merge-videos.config");
Object.defineProperty(exports, "mergeVideosConfig", { enumerable: true, get: function () { return merge_videos_config_1.mergeVideosConfig; } });
const openrouter_config_1 = require("./openrouter.config");
Object.defineProperty(exports, "openrouterConfig", { enumerable: true, get: function () { return openrouter_config_1.openrouterConfig; } });
const elevenlabs_config_1 = require("./elevenlabs.config");
Object.defineProperty(exports, "elevenlabsConfig", { enumerable: true, get: function () { return elevenlabs_config_1.elevenlabsConfig; } });
const kling_config_1 = require("./kling.config");
Object.defineProperty(exports, "klingConfig", { enumerable: true, get: function () { return kling_config_1.klingConfig; } });
const sync_lipsync_config_1 = require("./sync-lipsync.config");
Object.defineProperty(exports, "syncLipsyncConfig", { enumerable: true, get: function () { return sync_lipsync_config_1.syncLipsyncConfig; } });
const seedance_config_1 = require("./seedance.config");
Object.defineProperty(exports, "seedanceConfig", { enumerable: true, get: function () { return seedance_config_1.seedanceConfig; } });
// Register all node configs in a single batch call
registry_1.nodeRegistry.registerAll([
    // ── Input Nodes (Passthrough) ──
    text_1.textConfig,
    image_1.imageConfig,
    // ── AI Nodes ──
    llm_1.llmConfig,
    seedream_config_1.seedreamConfig,
    openrouter_config_1.openrouterConfig,
    elevenlabs_config_1.elevenlabsConfig,
    kling_config_1.klingConfig,
    seedance_config_1.seedanceConfig,
    // ── Media Nodes ──
    crop_1.cropConfig,
    extract_1.extractConfig,
    extract_audio_config_1.extractAudioConfig,
    merge_audio_video_config_1.mergeAudioVideoConfig,
    merge_videos_config_1.mergeVideosConfig,
    sync_lipsync_config_1.syncLipsyncConfig,
    video_1.videoConfig,
]);
