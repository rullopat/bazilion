import type { ImageGenerationHost } from '../worker/ipc-protocol.ts'
import type { ToolHandler } from './types.ts'

/** The image is saved as a result by the daemon; the tool returns its reference, not its bytes. */
export function imageGenerateTool(host: ImageGenerationHost): ToolHandler {
  return {
    def: {
      name: 'image_generate',
      description:
        'Generate an image from a text prompt with the image model the operator selected. The image is saved to the Team results and shown to the user. Each call is a new paid generation; at most four per turn.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Describe the image. At most 8 KiB.' },
          name: {
            type: 'string',
            description: 'Optional file name without a path (letters, digits, space, _ . -).',
          },
        },
        required: ['prompt'],
        additionalProperties: false,
      },
    },
    async invoke(args, context) {
      if (!context?.toolCallId) throw new Error('image_generate: missing tool call id')
      const output = await host.generate({
        toolCallId: context.toolCallId,
        prompt: String(args.prompt ?? ''),
        ...(typeof args.name === 'string' ? { name: args.name } : {}),
      })
      return {
        content: [
          {
            type: 'text',
            text: `Generated with ${output.model}: saved ${output.files.map((file) => `"${file.name}" as result ${file.result.resultId}`).join(', ')}.`,
          },
        ],
        details: { results: output.files.map((file) => file.result) },
      }
    },
  }
}
