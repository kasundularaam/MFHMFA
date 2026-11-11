import { createServer as createViteServer } from 'vite';
import { APP_TITLE, DEFAULT_PORT } from './config/env.js';
import { startStudioServer } from './server.js';

async function runDev(): Promise<void> {
  const api = await startStudioServer({ port: DEFAULT_PORT });
  const vite = await createViteServer({
    server: { port: 5173 },
  });
  await vite.listen();

  console.log(`\n${APP_TITLE} (Dev Mode)`);
  console.log(`  Live Hot-Reload UI : http://localhost:5173`);
  console.log(`  API & MCP Server   : ${api.baseUrl}`);
  console.log(`  MCP Streamable HTTP: ${api.baseUrl}/mcp\n`);

  const shutdown = async () => {
    await vite.close();
    await api.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

runDev().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
