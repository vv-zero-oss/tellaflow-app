const path = require('path');

const MODEL_PATH = path.join(__dirname, '..', 'resources', 'models', 'SmolLM2-135M-Instruct.Q8_0.gguf');

const TEST_SAMPLES = [
  {
    name: 'User report: Chapel Role bodyguard',
    text: "Like when Chapel Role's bodyguard made the eye a total cry because he looked at her.",
  },
  {
    name: 'Dark chocolate transcript (our app output)',
    text: 'Dark chocolate 69% cocoa, sugar, solids 25.5% cocoa butter, soya butter, emulus, emulsifier, soya, lecithin, natural identicular favour substance, iodized salt, water, wheat flour, maida, sugar, hydrated vegetable seeds, cocoa solids, milk solids, fractionated vegetable fat, raising agent, yeast, emulus, fire, soya, lecithin, iodized salt, floor treatment agent, and natural identical flavourings of substance.',
  },
  {
    name: 'Harvard sentences (expected clean)',
    text: 'The birch canoe slid on the smooth planks. Glue the sheet to the dark blue background. Its easy to tell the depth of a well. These days a chicken leg is a rare dish. Rice is often served in round bowls.',
  },
  {
    name: 'Short dictation with errors',
    text: "i went to the stor yesterday and buyed some grocerys. their was alot of people they're.",
  },
  {
    name: 'Misheard words needing coherence fix',
    text: 'The pacific ocean is the largest body of Walter on earth and it contains many diverse species of marine wife.',
  },
];

const SYSTEM_PROMPT =
  'You are a speech-to-text post-processor. ' +
  'You receive raw transcriptions that may contain misheard words, grammar errors, and spelling mistakes. ' +
  'Rewrite the text with correct grammar, spelling, and natural phrasing. ' +
  'Fix words that were clearly misheard by the speech recognizer to make the sentence coherent. ' +
  'IMPORTANT: Reply with ONLY the corrected text. No explanations, no comments, no preamble. ' +
  'Never start with phrases like "Here is" or "The corrected". Just output the clean text directly.';

function stripPreamble(output, originalText) {
  let text = output.trim();

  text = text.replace(/^(?:here(?:'s| is) (?:the )?(?:corrected|clean|fixed|updated|rewritten) (?:version|text)[:\s]*\n*)/i, '');
  text = text.replace(/^(?:the (?:corrected|clean|fixed) (?:version|text) is[:\s]*\n*)/i, '');
  text = text.replace(/^(?:(?:corrected|fixed|clean|output)[:\s]*\n*)/i, '');

  const cutIdx = text.search(/\n\n(?:I (?:changed|corrected|fixed|made|also|added|removed)|(?:Note|Changes|Explanation|Here|The (?:text|changes|corrections|following)))/i);
  if (cutIdx > 0) {
    text = text.substring(0, cutIdx);
  }

  return text.trim() || originalText;
}

async function main() {
  console.log('Loading node-llama-cpp (ESM dynamic import)...');
  const { getLlama, LlamaChatSession } = await import('node-llama-cpp');

  console.log('Initializing llama...');
  const llama = await getLlama();

  console.log(`Loading model: ${MODEL_PATH}`);
  const model = await llama.loadModel({ modelPath: MODEL_PATH });

  for (const sample of TEST_SAMPLES) {
    console.log('\n' + '='.repeat(60));
    console.log(`TEST: ${sample.name}`);
    console.log('='.repeat(60));
    console.log('\nINPUT:');
    console.log(sample.text);

    const context = await model.createContext();
    const session = new LlamaChatSession({
      contextSequence: context.getSequence(),
      systemPrompt: SYSTEM_PROMPT,
    });

    const start = Date.now();
    const rawResult = await session.prompt(
      sample.text,
      {
        maxTokens: Math.max(256, sample.text.split(/\s+/).length * 3),
        temperature: 0,
      }
    );
    const elapsed = Date.now() - start;

    console.log('\nRAW MODEL OUTPUT:');
    console.log(rawResult.trim());

    const cleaned = stripPreamble(rawResult, sample.text);
    console.log('\nCLEANED OUTPUT:');
    console.log(cleaned);
    console.log(`\nTime: ${elapsed}ms`);

    await context.dispose();
  }

  console.log('\n\nDone. All tests complete.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
