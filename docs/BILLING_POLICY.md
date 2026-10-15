# Execution reservations and pricing limits

NextFlow uses a maximum credit reservation before dispatch. It is not the expected charge. A successful settlement charges recorded usage up to the reserved amount and releases the unused balance. The reservation is fixed per paid node because model, text, images and quantity controls can all be connected to upstream nodes whose output does not exist at preflight time. Static node values cannot lower the hold.

The policies below were checked against the linked provider documentation on 15 October 2026. They are application tariffs and limits, not a live provider invoice reconciliation system. A pricing or limit change requires a policy review, a node configuration version change and regression tests. The worker rejects snapshots prepared against older node versions.

| Node | Maximum reservation | Admitted limits and settlement |
| --- | ---: | --- |
| Gemini LLM | 1,073,152 | 32,768 user characters, 8,192 system characters, four images, 8,192 output tokens; full 1,048,576-token provider context budget covers image and text tokenization. Recorded usage uses the existing NextFlow tariff of one credit per prompt token and three per output token. |
| OpenRouter LLM | 3,268,608 | Same local limits; allowlisted models only. The reservation includes the largest context and highest supported tariff, even if the model is connected upstream. Existing tariffs are 3/15 credits per input/output token for Claude and 1/3 for the other models. |
| ElevenLabs dialogue | 2,000,000 | Up to 20,000 UTF-8 bytes including connected dialogue lines and at most 100 structured lines. Settlement counts Unicode characters in the final parsed text sent to the provider, not JSON syntax or voice identifiers. |
| Seedream 4.5 | 1,440,000 | Six generations times six possible images per generation. Settlement uses the actual returned image count at 40,000 credits per image, not the requested maximum. |
| Seedance 1.5 | 2,488,320 | Up to 12 seconds, 1080p, supported explicit aspect ratios and 24 fps. The maximum hold includes dimension padding headroom and audio. Without a returned provider cost, settlement applies the published video-token formula to selected duration, resolution and aspect ratio. This is a tariff estimate; it is not verified against decoded output dimensions or a provider invoice. |

The LLM tariffs intentionally preserve the existing application pricing. They are not current provider dollar prices. For example, OpenRouter lists Gemini 2.5 Flash at $0.30/$2.50 per million input/output tokens, while the application tariff is 1/3 credits per token. Claude Sonnet 4.5 is listed at $3/$15 per million. LLM usage metadata is preferred; existing fallback pricing when usage metadata is absent remains approximate. Gemini now forwards its configured output limit to the SDK and returns usage metadata, including reasoning tokens represented in total usage.

The maximum LLM reservations are intentionally larger than typical usage. A future connection-aware preflight and provider token counting can reduce them without allowing connected inputs to bypass funding. A user needs enough balance for the maximum reservation to start a paid node.

The legacy saved OpenRouter value `anthropic/claude-sonnet-4-5` remains accepted and is translated to the provider's canonical `anthropic/claude-sonnet-4.5` at validation/dispatch. New selections use the canonical value; stored graphs are not rewritten. ElevenLabs forwards only its declared numbered dialogue handles, merges them before provider submission, and returns the character count of that same composed text for settlement.

Kling and Lipsync are temporarily blocked before provider admission. Their current task responses do not contain verified billable duration. Kling publishes an approximately ten-second input contract, but charging the actual remote input duration still requires trustworthy metadata; Lipsync also has duration-changing modes. Enable them only after bounded media probing and usage accounting are implemented. Seedance's `auto` aspect ratio is also blocked until its source/output dimensions can be verified. Explicit aspect ratios remain supported. Free passthrough and native FFmpeg nodes keep zero-credit execution.

These bounds cover one admitted provider request. Transport ambiguity, provider-side retries and final invoice reconciliation are separate lifecycle concerns. These accounting paths have local regression coverage; live provider billing has not been verified.

Sources:

- [OpenRouter Gemini 2.5 Flash pricing and context limits](https://openrouter.ai/google/gemini-2.5-flash)
- [OpenRouter Claude Sonnet 4.5 pricing and context limits](https://openrouter.ai/anthropic/claude-sonnet-4.5)
- [OpenRouter Llama 3 8B context limit](https://openrouter.ai/meta-llama/llama-3-8b-instruct)
- [Google Gemini model documentation](https://ai.google.dev/gemini-api/docs/models)
- [ElevenLabs dialogue pricing on fal](https://fal.ai/models/fal-ai/elevenlabs/text-to-dialogue/eleven-v3)
- [Seedream 4.5 pricing](https://fal.ai/models/fal-ai/bytedance/seedream/v4.5/text-to-image) and [generation-count semantics](https://fal.ai/models/fal-ai/bytedance/seedream/v4.5/text-to-image/api)
- [Seedance 1.5 token formula, audio pricing and supported limits](https://fal.ai/models/fal-ai/bytedance/seedance/v1.5/pro/text-to-video)
- [Kling edit duration contract](https://fal.ai/models/fal-ai/kling-video/o1/video-to-video/edit/api)
- [Lipsync duration-dependent pricing](https://fal.ai/models/fal-ai/sync-lipsync)

## Recovery and retry boundary (16 October 2026)

A started paid child reported as FAILED may still have been accepted by its provider. Recovery retains that node's hold and pending descendants unless it can validate a completed child result or definite evidence of no execution. It checks child identity, recovery tag and parent worker relationship before accepting output. Repeated reconciliation cannot charge or refund twice. Local free media task failures may terminate their dependent branches without a paid usage claim.

Gemini retries only explicit 429 rate-limit responses, up to three total calls, with one Trigger task attempt. Server 5xx responses and ambiguous transport failures stop immediately because provider acceptance may already have occurred. The existing reservation covers one admitted request and final charges remain capped at that hold; provider invoice reconciliation and provider-side retry behavior remain separate release concerns.
