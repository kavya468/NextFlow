"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mergeVideosConfig = void 0;
exports.mergeVideosConfig = {
    id: "merge-videos",
    name: "Merge Videos",
    description: "Concatenate multiple videos into a single output using internal FFmpeg",
    category: "media",
    icon: "Merge",
    version: "1.0.0",
    inputs: [
        {
            key: "video_urls",
            type: "video",
            label: "Video URLs",
            required: true,
            isAdvanced: false,
            multi: true,
            placeholder: "Connect multiple video URLs",
            description: "Multiple source videos to merge in order. Connected values are aggregated into an array.",
        },
    ],
    outputs: [
        {
            key: "merged_video_url",
            type: "video",
            label: "Merged Video",
        },
    ],
    providers: [
        {
            id: "internal",
            name: "Internal FFmpeg",
            timeout: 300000,
            retryCount: 1,
            endpoints: [
                {
                    id: "merge-videos-default",
                    name: "Merge Videos",
                    taskId: "ffmpeg-merge-videos",
                    inputMapping: {
                        video_urls: "video_urls",
                    },
                    outputMapping: {
                        merged_video_url: "merged_video_url",
                    },
                },
            ],
        },
    ],
    credits: {
        estimate: () => 0,
        calculate: () => 0,
    },
    ui: {
        color: "text-emerald-700",
        width: 280,
        showOutputPreview: true,
        previewOutputKey: "merged_video_url",
    },
};
