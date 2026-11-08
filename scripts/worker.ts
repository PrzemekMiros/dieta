import { processOutbox } from '../src/lib/server/email';
let running = true;
process.on('SIGINT', () => {
  running = false;
});
process.on('SIGTERM', () => {
  running = false;
});
while (running) {
  try {
    await processOutbox();
  } catch {
    console.error('Outbox unavailable. Retrying in 15 seconds.');
  }
  if (process.argv.includes('--once')) break;
  await new Promise((resolve) => setTimeout(resolve, 15_000));
}
process.exit(0);
