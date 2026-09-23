import {
  type ImageGenerationInput,
  type ImageGenerationOutput,
  imageGenerationRouteLabel,
} from '@bazilion/api-types'
import type { ToolHandler } from './types.ts'

/** Never return raw images as tool content: only the existing file egress authorizer may release them. */
export function imageGenerateTool(
  generate: (input: ImageGenerationInput) => Promise<ImageGenerationOutput>,
  sessionId: string,
): ToolHandler {
  return {
    def: {
      name: 'image_generate',
      description:
        'Generate original images from a text prompt using the operator-selected image route/model (API billing or ChatGPT subscription usage). Saved Results are delivered subject to Team Policy. Rework is a new generation, not a pixel edit. Do not automatically retry a failed or uncertain request; it may already have been billed. No social publication.',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'Describe the desired image. Maximum 8 KiB UTF-8.',
          },
          name: {
            type: 'string',
            description: 'Optional display filename, not a path (ASCII, maximum 120 characters).',
          },
        },
        required: ['prompt'],
        additionalProperties: false,
      },
    },
    async invoke(args, context) {
      if (!context?.toolCallId || !sessionId)
        throw new Error('image_generate: missing source operation')
      if (
        typeof args.prompt !== 'string' ||
        (args.name !== undefined && typeof args.name !== 'string') ||
        Object.keys(args).some((key) => !['prompt', 'name'].includes(key))
      ) {
        throw new Error('image_generate: invalid arguments')
      }
      const output = await generate({
        sessionId,
        toolCallId: context.toolCallId,
        prompt: args.prompt,
        ...(args.name === undefined ? {} : { name: args.name }),
      })
      return {
        content: [
          {
            type: 'text',
            text: `Saved ${output.files.length} image(s) via ${imageGenerationRouteLabel(output.model)} (selected: ${output.model}). Delivery is subject to Team Policy. ${output.files.map((file) => `${file.name}: ${file.result.resultId}`).join('; ')}`,
          },
        ],
        results: output.files.map((file) => file.result),
      }
    },
  }
}
