import { AppNode, Edge } from "@/lib/store";

// ============================================================================
// Template: Cinematic AI Trailer
// ============================================================================
//
// A fully-wired 9-node DAG that generates a cinematic AI trailer:
//
//   Col 1 (Injectors)     Col 2 (Generation)    Col 3 (Audio/Anim)    Col 4 (Sync/B-Roll)   Col 5 (Final)
//   ─────────────────     ──────────────────     ─────────────────     ───────────────────    ─────────────
//   [topic] ──────────┬── [llm] ─────────────── [tts] ────────────┐
//                      │                                           ├── [lipsync] ──────┐
//                      └── [image] ──────────── [video1] ─────────┘                    ├── [merge]
//   [ar] ──────────┬───── (aspect_ratio)   ──── (aspect_ratio)        [b-roll] ───────┘
//                  └───── (aspect_ratio)   ──────────────────────────── (aspect_ratio)
//
// Handle IDs verified against actual NodeConfig definitions:
//   text.outputs:          text_output
//   openrouter-llm.inputs: user_message, system_prompt  |  outputs: text
//   seedream-4.5.inputs:   prompt, image_url, aspect_ratio  |  outputs: image_url
//   elevenlabs-tts.inputs: text  |  outputs: audio_url
//   seedance-1.5.inputs:   image_url, aspect_ratio, mode  |  outputs: video_url
//   sync-lipsync.inputs:   video_url, audio_url  |  outputs: video_url
//   kling-01.inputs:       prompt, video_url, aspect_ratio, mode  |  outputs: video_url
//   merge-videos.inputs:   video_urls (multi)  |  outputs: merged_video_url
// ============================================================================

export const CINEMATIC_TRAILER_TEMPLATE: { nodes: AppNode[]; edges: Edge[] } = {
  nodes: [
    // ── Column 1: Injectors (x=50) ────────────────────────────────────────
    {
      id: "topic",
      type: "text",
      position: { x: 50, y: 120 },
      data: {
        text: "A wise old cyber-monk explaining the nature of reality.",
      },
    },
    {
      id: "ar",
      type: "text",
      position: { x: 50, y: 550 },
      data: {
        text: "16:9",
      },
    },

    // ── Column 2: Generation Base (x=500) ─────────────────────────────────
    {
      id: "llm",
      type: "openrouter-llm",
      position: { x: 500, y: 60 },
      data: {
        model: "google/gemini-2.5-pro",
        system_prompt:
          "You are a cinematic narrator. Write a short, dramatic voiceover monologue (3–4 sentences) for an AI-generated trailer. Speak as the character described. Be poetic and profound.",
      },
    },
    {
      id: "image",
      type: "seedream-4.5",
      position: { x: 500, y: 450 },
      data: {},
    },

    // ── Column 3: Audio & Animation (x=950) ───────────────────────────────
    {
      id: "tts",
      type: "elevenlabs-tts",
      position: { x: 950, y: 60 },
      data: {
        voice: "Brian",
      },
    },
    {
      id: "video1",
      type: "seedance-1.5",
      position: { x: 950, y: 450 },
      data: {
        mode: "image-to-video",
      },
    },

    // ── Column 4: Sync & B-Roll (x=1400) ─────────────────────────────────
    {
      id: "lipsync",
      type: "sync-lipsync",
      position: { x: 1400, y: 200 },
      data: {},
    },
    {
      id: "b-roll",
      type: "kling-01",
      position: { x: 1400, y: 550 },
      data: {
        mode: "edit",
        prompt:
          "Cinematic drone shot of a neon cyberpunk city, flying through skyscrapers",
      },
    },

    // ── Column 5: Final Cut (x=1850) ──────────────────────────────────────
    {
      id: "merge",
      type: "merge-videos",
      position: { x: 1850, y: 360 },
      data: {},
    },
  ],

  edges: [
    // Column 1 → Column 2
    { id: "ct-e1",  source: "topic", sourceHandle: "text_output", target: "llm",     targetHandle: "user_message" },
    { id: "ct-e2",  source: "topic", sourceHandle: "text_output", target: "image",   targetHandle: "prompt" },
    { id: "ct-e3",  source: "ar",    sourceHandle: "text_output", target: "image",   targetHandle: "aspect_ratio" },

    // Column 2 → Column 3
    { id: "ct-e4",  source: "llm",   sourceHandle: "text",        target: "tts",     targetHandle: "text" },
    { id: "ct-e5",  source: "image", sourceHandle: "image_url",   target: "video1",  targetHandle: "image_url" },
    { id: "ct-e6",  source: "ar",    sourceHandle: "text_output", target: "video1",  targetHandle: "aspect_ratio" },

    // Column 3 → Column 4
    { id: "ct-e7",  source: "video1", sourceHandle: "video_url",  target: "lipsync", targetHandle: "video_url" },
    { id: "ct-e8",  source: "tts",    sourceHandle: "audio_url",  target: "lipsync", targetHandle: "audio_url" },
    { id: "ct-e9",  source: "ar",     sourceHandle: "text_output", target: "b-roll", targetHandle: "aspect_ratio" },
    { id: "ct-e12", source: "video1", sourceHandle: "video_url",  target: "b-roll", targetHandle: "video_url" },

    // Column 4 → Column 5
    { id: "ct-e10", source: "lipsync", sourceHandle: "video_url",  target: "merge",  targetHandle: "video_urls" },
    { id: "ct-e11", source: "b-roll",  sourceHandle: "video_url",  target: "merge",  targetHandle: "video_urls" },
  ],
};
