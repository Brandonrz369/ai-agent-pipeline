import { listDeadLetter, inspectDeadLetter, retryFromDeadLetter } from '../anti-loop/dead-letter.js';

export async function deadLetterListCommand() {
  const items = await listDeadLetter();

  if (items.length === 0) {
    console.log('Dead-letter queue is empty.');
    return;
  }

  console.log(`Dead-letter queue: ${items.length} items\n`);
  for (const item of items) {
    console.log(`  ${item.id}`);
    console.log(`    Reason: ${item.reason ?? 'unknown'}`);
    console.log(`    Sent: ${item.sent_at ?? 'unknown'}`);
    if (item.envelope) {
      console.log(`    Hops: ${item.envelope.hops}/${item.envelope.ttl_max}`);
      console.log(`    Mode: ${item.envelope.mode}`);
    }
    console.log('');
  }
}

export async function deadLetterInspectCommand(id: string) {
  const item = await inspectDeadLetter(id);

  if (!item) {
    console.error(`Not found: ${id}`);
    process.exit(1);
  }

  console.log(JSON.stringify(item, null, 2));
}

export async function deadLetterRetryCommand(id: string) {
  const envelope = await retryFromDeadLetter(id);

  if (!envelope) {
    console.error(`Not found: ${id}`);
    process.exit(1);
  }

  console.log(`Retrying: ${id}`);
  console.log(`Reset envelope: TTL ${envelope.ttl_max}, mode ${envelope.mode}`);
  console.log(JSON.stringify(envelope, null, 2));
}
