
  "openapi": "3.0.4",
  "info": {
    "title": "Queue OpenAPI for fal-ai/bytedance/seedream/v4.5/edit",
    "version": "1.0.0",
    "description": "The OpenAPI schema for the fal-ai/bytedance/seedream/v4.5/edit queue.",
    "x-fal-metadata": {
      "endpointId": "fal-ai/bytedance/seedream/v4.5/edit",
      "category": "image-to-image",
      "thumbnailUrl": "https://v3b.fal.media/files/b/0a84910b/lDvWLqpxcFmzQHdadDA7t_4012f28b4f79444782d90d8927b42c29.jpg",
      "playgroundUrl": "https://fal.ai/models/fal-ai/bytedance/seedream/v4.5/edit",
      "documentationUrl": "https://fal.ai/models/fal-ai/bytedance/seedream/v4.5/edit/api"
    }
  },
  "components": {
    "securitySchemes": {
      "apiKeyAuth": {
        "type": "apiKey",
        "in": "header",
        "name": "Authorization",
        "description": "Fal Key"
      }
    },
    "schemas": {
      "QueueStatus": {
        "type": "object",
        "properties": {
          "status": {
            "type": "string",
            "enum": [
              "IN_QUEUE",
              "IN_PROGRESS",
              "COMPLETED"
            ]
          },
          "request_id": {
            "type": "string",
            "description": "The request id."
          },
          "response_url": {
            "type": "string",
            "description": "The response url."
          },
          "status_url": {
            "type": "string",
            "description": "The status url."
          },
          "cancel_url": {
            "type": "string",
            "description": "The cancel url."
          },
          "logs": {
            "type": "object",
            "description": "The logs.",
            "additionalProperties": true
          },
          "metrics": {
            "type": "object",
            "description": "The metrics.",
            "additionalProperties": true
          },
          "queue_position": {
            "type": "integer",
            "description": "The queue position."
          }
        },
        "required": [
          "status",
          "request_id"
        ]
      },
      "BytedanceSeedreamV45EditInput": {
        "properties": {
          "enable_safety_checker": {
            "description": "If set to true, the safety checker will be enabled.",
            "examples": [true],
            "default": true,
            "type": "boolean",
            "title": "Enable Safety Checker"
          },
          "sync_mode": {
            "description": "If `True`, the media will be returned as a data URI and the output data won't be available in the request history.",
            "default": false,
            "type": "boolean",
            "title": "Sync Mode"
          },
          "prompt": {
            "description": "The text prompt used to edit the image",
            "examples": [
              "Replace the product in Figure 1 with that in Figure 2. For the title copy the text in Figure 3 to the top of the screen, the title should have a clear contrast with the background but not be overly eye-catching."
            ],
            "type": "string",
            "title": "Prompt"
          },
          "image_urls": {
            "description": "List of URLs of input images for editing. Presently, up to 10 image inputs are allowed. If over 10 images are sent, only the last 10 will be used.",
            "items": {
              "type": "string"
            },
            "examples": [
              [
                "https://storage.googleapis.com/falserverless/example_inputs/seedreamv45/seedream_v45_edit_input_1.png",
                "https://storage.googleapis.com/falserverless/example_inputs/seedreamv45/seedream_v45_edit_input_2.png",
                "https://storage.googleapis.com/falserverless/example_inputs/seedreamv45/seedream_v45_edit_input_3.png"
              ]
            ],
            "type": "array",
            "title": "Image URLs"
          },
          "seed": {
            "description": "Random seed to control the stochasticity of image generation.",
            "anyOf": [
              {
                "type": "integer"
              },
              {
                "type": "null"
              }
            ],
            "title": "Seed"
          },
          "max_images": {
            "description": "If set to a number greater than one, enables multi-image generation. The model will potentially return up to `max_images` images every generation, and in total, `num_images` generations will be carried out. In total, the number of images generated will be between `num_images` and `max_images*num_images`. The total number of images (image inputs + image outputs) must not exceed 15",
            "maximum": 6,
            "title": "Max Images",
            "default": 1,
            "type": "integer",
            "minimum": 1
          },
          "image_size": {
            "description": "The size of the generated image. Width and height must be between 1920 and 4096, or total number of pixels must be between 2560*1440 and 4096*4096.",
            "examples": [
              "auto_4K"
            ],
            "default": {
              "width": 2048,
              "height": 2048
            },
            "anyOf": [
              {
                "$ref": "#/components/schemas/ImageSize"
              },
              {
                "enum": [
                  "square_hd",
                  "square",
                  "portrait_4_3",
                  "portrait_16_9",
                  "landscape_4_3",
                  "landscape_16_9",
                  "auto_2K",
                  "auto_4K"
                ],
                "type": "string"
              }
            ],
            "title": "Image Size"
          },
          "num_images": {
            "description": "Number of separate model generations to be run with the prompt.",
            "maximum": 6,
            "title": "Num Images",
            "default": 1,
            "type": "integer",
            "minimum": 1
          }
        },
        "required": [
          "prompt",
          "image_urls"
        ],
        "x-fal-order-properties": [
          "prompt",
          "image_size",
          "num_images",
          "max_images",
          "seed",
          "sync_mode",
          "enable_safety_checker",
          "image_urls"
        ],
        "type": "object",
        "title": "SeedDream45EditInput"
      },
      "BytedanceSeedreamV45EditOutput": {
        "properties": {
          "images": {
            "description": "Generated images",
            "items": {
              "$ref": "#/components/schemas/Image"
            },
            "examples": [
              [
                {
                  "url": "https://storage.googleapis.com/falserverless/example_outputs/seedreamv45/seedream_v45_edit_output.png"
                }
              ]
            ],
            "type": "array",
            "title": "Images"
          }
        },
        "required": [
          "images"
        ],
        "x-fal-order-properties": [
          "images"
        ],
        "type": "object",
        "title": "SeedDream45EditOutput"
      },
      "ImageSize": {
        "properties": {
          "width": {
            "description": "The width of the generated image.",
            "maximum": 14142,
            "exclusiveMinimum": 0,
            "default": 512,
            "type": "integer",
            "title": "Width"
          },
          "height": {
            "description": "The height of the generated image.",
            "maximum": 14142,
            "exclusiveMinimum": 0,
            "default": 512,
            "type": "integer",
            "title": "Height"
          }
        },
        "x-fal-order-properties": [
          "width",
          "height"
        ],
        "type": "object",
        "title": "ImageSize"
      },
      "Image": {
        "description": "Represents an image file.",
        "properties": {
          "url": {
            "description": "The URL where the file can be downloaded from.",
            "type": "string",
            "title": "Url"
          },
          "file_size": {
            "description": "The size of the file in bytes.",
            "examples": [4404019],
            "anyOf": [
              {
                "type": "integer"
              },
              {
                "type": "null"
              }
            ],
            "title": "File Size"
          },
          "width": {
            "description": "The width of the image in pixels.",
            "examples": [1024],
            "anyOf": [
              {
                "type": "integer"
              },
              {
                "type": "null"
              }
            ],
            "title": "Width"
          },
          "content_type": {
            "description": "The mime type of the file.",
            "examples": [
              "image/png"
            ],
            "anyOf": [
              {
                "type": "string"
              },
              {
                "type": "null"
              }
            ],
            "title": "Content Type"
          },
          "height": {
            "description": "The height of the image in pixels.",
            "examples": [1024],
            "anyOf": [
              {
                "type": "integer"
              },
              {
                "type": "null"
              }
            ],
            "title": "Height"
          },
          "file_name": {
            "description": "The name of the file. It will be auto-generated if not provided.",
            "examples": [
              "z9RV14K95DvU.png"
            ],
            "anyOf": [
              {
                "type": "string"
              },
              {
                "type": "null"
              }
            ],
            "title": "File Name"
          }
        },
        "required": [
          "url"
        ],
        "x-fal-order-properties": [
          "url",
          "content_type",
          "file_name",
          "file_size",
          "width",
          "height"
        ],
        "type": "object",
        "title": "Image"
      }
    }
  },
  "paths": {
    "/fal-ai/bytedance/seedream/v4.5/edit/requests/{request_id}/status": {
      "get": {
        "parameters": [
          {
            "name": "request_id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "description": "Request ID"
            }
          },
          {
            "name": "logs",
            "in": "query",
            "required": false,
            "schema": {
              "type": "number",
              "description": "Whether to include logs (`1`) in the response or not (`0`)."
            }
          }
        ],
        "responses": {
          "200": {
            "description": "The request status.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/QueueStatus"
                }
              }
            }
          }
        }
      }
    },
    "/fal-ai/bytedance/seedream/v4.5/edit/requests/{request_id}/cancel": {
      "put": {
        "parameters": [
          {
            "name": "request_id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "description": "Request ID"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "The request was cancelled.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "success": {
                      "type": "boolean",
                      "description": "Whether the request was cancelled successfully."
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/fal-ai/bytedance/seedream/v4.5/edit": {
      "post": {
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/BytedanceSeedreamV45EditInput"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "The request status.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/QueueStatus"
                }
              }
            }
          }
        }
      }
    },
    "/fal-ai/bytedance/seedream/v4.5/edit/requests/{request_id}": {
      "get": {
        "parameters": [
          {
            "name": "request_id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "description": "Request ID"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Result of the request.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/BytedanceSeedreamV45EditOutput"
                }
              }
            }
          }
        }
      }
    }
  },
  "servers": [
    {
      "url": "https://queue.fal.run"
    }
  ],
  "security": [
    {
      "apiKeyAuth": []
    }
  ]
