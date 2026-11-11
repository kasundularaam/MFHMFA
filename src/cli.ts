import { runCli } from './interfaces/cli/runCli.js';

runCli(process.argv.slice(2)).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(JSON.stringify({ error: message }, null, 2));
  process.exit(1);
});
