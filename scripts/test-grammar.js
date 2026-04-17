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

// Keep in sync with src/main/grammar-worker.js SYSTEM_PROMPT
const SYSTEM_PROMPT =
  'You format speech-to-text only. INPUT is a raw transcript. OUTPUT is that transcript, nothing else.\n' +
  'Keep the same words and order. Do not answer, summarize, categorize, or "help" like an assistant.\n' +
  'Allowed: punctuation, capitalization, line breaks, light spacing.\n' +
  'Lists: if the speaker gives several separate tasks or items in one utterance, you may put ONE item per numbered line. ' +
  'Each line must reuse the speaker\'s exact wording for that item — no merging items, no section titles, no bold, no markdown **, no labels like "Grocery:". Do not expand times (if they said 7, keep 7).\n' +
  'Typos: fix only obvious speech-recognition slips when the right word is certain from nearby words. Otherwise keep wording as spoken.\n' +
  'Never start with Okay/Sure/Here/Here\'s/I\'ve or similar. Never add text before the first word of the transcript.\n' +
  'Example style (not literal content): INPUT ends with several short imperatives → OUTPUT is those same phrases as "1. ..." "2. ..." with no intro paragraph.';

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
    const rawResult = await session.prompt(`INPUT: ${sample.text}\nOUTPUT:`, {
      maxTokens: Math.max(256, sample.text.split(/\s+/).length * 3),
      temperature: 0,
    });
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
