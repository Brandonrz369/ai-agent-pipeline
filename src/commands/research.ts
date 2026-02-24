import { AntigravityClient } from '../utils/antigravity-client.js';
import { writeFile } from 'node:fs/promises';
import { logger } from '../utils/logger.js';

export async function researchCommand(prompt: string, opts: { output?: string }) {
  console.log(`Researching: ${prompt}`);
  const client = new AntigravityClient('gemini-3.1-pro-high');

  const response = await client.generateContent(
    `You are a deep research agent. Produce a comprehensive, cited research report on the following topic. Include:
1. Overview and context
2. Key technical details
3. Implementation considerations
4. Risks and mitigations
5. Recommended approach

Topic: ${prompt}

Be thorough. Output 3000-10000 words. Include code examples where applicable.`,
    8192,
  );

  const result = response.text || 'No response from Gemini';

  if (opts.output) {
    await writeFile(opts.output, result);
    console.log(`Research saved to: ${opts.output}`);
  } else {
    console.log(result);
  }
}
