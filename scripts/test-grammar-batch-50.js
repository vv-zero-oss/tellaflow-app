const path = require('path');
const { fork } = require('child_process');

const modelPathArg = process.argv[2];
const defaultModelPath = '/Users/mac/Library/Application Support/tellaflow/models/google_gemma-3-1b-it-Q4_K_M.gguf';
const modelPath = modelPathArg || defaultModelPath;

const TRANSCRIPTS = [
  'lets create a todo list add eggs buy some butter make sure dinner is cooked by 7 and wear some clean clothers',
  'send a follow up email to sarah tomorrow morning and ask if she got the invoice',
  'i think we should move the standup to 930 because 9 is too tight for everyone',
  'book a dentist appointment next week if there is anything after lunch',
  'remind me to call mom at 6 and ask about grandma meds',
  'meeting notes first we shipped the patch second qa found two bugs third we need rollback plan',
  'new paragraph i finished the api today new paragraph tomorrow i start tests',
  'can you add milk bread bananas and paper towels to the shopping list',
  'draft message hey team the deploy is delayed by 30 minutes due to migration',
  'i had coffee this morning and then i forgot my badge at home',
  'set alarm for 545 and another one for 6 just in case',
  'todo one clean desk two wash bottle three charge laptop four sleep early',
  'the quick brown fox jump over the lazy dog near the river bank',
  'please note account number is 4381 92 and the pin is 0044',
  'write this exactly dont auto correct weird casing for iOS and macOS names',
  'i was like um basically trying to explain the bug but it kept crashing',
  'if user clicks save twice we get duplicate entries in the db',
  'i need a summary of todays calls wait no dont summarize just transcribe',
  'add punctuation to this sentence but do not change words at all please',
  'buy 2 tomatoes 3 onions 1 kilo rice and 6 eggs',
  'the color should be bluish gray not pure blue',
  'there was alot of noise in the background and i couldnt hear clearly',
  'please reserve table for 4 at 730 pm friday',
  'send this to legal this is a draft and not final advice',
  'reminder submit taxes by april 20 and pay estimated dues',
  'agenda item one hiring item two onboarding item three training',
  'lets go over action items first fix login second update docs third close sprint',
  'my wifi is unstable maybe router needs restart',
  'replace all occurences of recieve with receive in the document',
  'create bullet list apples oranges grapes mangoes',
  'we need to ship v0.6.7 this friday no excuses',
  'john said he can join after 1130 if traffic is okay',
  'open bracket userId close bracket should stay as spoken',
  'insert newline between each step step one brew coffee step two pour milk',
  'please dont rewrite this sentence even if grammar looks wrong',
  'turn on do not disturb for 45 mins',
  'i will be out of office from may 2 to may 6',
  'note to self cancel unused subscriptions adobe figma notion',
  'final checklist passport charger headphones tickets',
  'we discussed budgets and decided phase one is approved',
  'schedule with devops monday 10 and security tuesday 2',
  'this is a test of comma placement however dont change wording',
  'fix typo in this i definately need this done by tomorow',
  'list tasks review pr run tests merge branch tag release',
  'transcript should keep filler words like um and uh if they are spoken',
  'i saw two errors null pointer and timeout on login',
  'for dinner get pasta olive oil garlic and cheese',
  'dont transform into markdown heading or bold text',
  'keep numbers as spoken 7 not seven and 11 not eleven',
  'thanks thats all for now',
];

function runBatch() {
  return new Promise((resolve, reject) => {
    const workerPath = path.join(__dirname, '..', 'src', 'main', 'grammar-worker.js');
    const child = fork(workerPath, [], { stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });
    const pending = new Map();
    let nextId = 1;
    let idx = 0;

    const stop = (err) => {
      try { child.kill(); } catch (_) {}
      if (err) reject(err);
    };

    child.stdout.on('data', (d) => process.stdout.write(d));
    child.stderr.on('data', (d) => process.stderr.write(d));

    child.on('message', (msg) => {
      if (msg.type === 'init-done') {
        sendNext();
        return;
      }
      if (msg.type === 'result') {
        const resolver = pending.get(msg.id);
        if (!resolver) return;
        pending.delete(msg.id);
        resolver.resolve(msg.text);
        return;
      }
      if (msg.type === 'error') {
        const resolver = pending.get(msg.id);
        if (resolver) {
          pending.delete(msg.id);
          resolver.reject(new Error(msg.error));
        } else {
          stop(new Error(msg.error));
        }
      }
    });

    child.on('exit', (code) => {
      if (code !== 0 && idx < TRANSCRIPTS.length) {
        reject(new Error(`Worker exited early with code ${code}`));
      }
    });

    function correct(text) {
      const id = nextId++;
      return new Promise((resolveOne, rejectOne) => {
        pending.set(id, { resolve: resolveOne, reject: rejectOne });
        child.send({ type: 'correct', id, text });
      });
    }

    async function sendNext() {
      while (idx < TRANSCRIPTS.length) {
        const original = TRANSCRIPTS[idx];
        const number = idx + 1;
        const transformed = await correct(original);
        console.log(`\n#${number}`);
        console.log(`ORIGINAL:    ${original}`);
        console.log(`TRANSFORMED: ${transformed}`);
        idx += 1;
      }
      try { child.kill(); } catch (_) {}
      resolve();
    }

    child.send({ type: 'init', modelPath });
  });
}

async function main() {
  console.log(`Model: ${modelPath}`);
  await runBatch();
}

main().catch((err) => {
  console.error('Batch test failed:', err.message);
  process.exit(1);
});
