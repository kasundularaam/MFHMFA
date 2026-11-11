import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_ROOT } from '../../config/env.js';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter((p): p is string => Boolean(p));

export function resolveChromePath(): string {
  for (const candidate of CHROME_CANDIDATES) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    `Could not locate Chrome/Chromium executable. Set CHROME_PATH env variable. Checked: ${CHROME_CANDIDATES.join(', ')}`
  );
}

export function resolveMermaidBundlePath(): string {
  const candidates = [
    path.join(PROJECT_ROOT, 'node_modules/mermaid/dist/mermaid.min.js'),
    path.join(PROJECT_ROOT, 'node_modules/mermaid/dist/mermaid.js'),
    path.resolve(process.cwd(), 'node_modules/mermaid/dist/mermaid.min.js'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error('Could not find node_modules/mermaid/dist/mermaid.min.js');
}

export const RENDER_HARNESS_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      background: transparent;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "DejaVu Sans", Arial, sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    #capture-stage {
      display: inline-block;
      padding: 24px;
      min-width: 80px;
      min-height: 60px;
    }
    #capture-stage svg {
      display: block;
      max-width: none !important;
      height: auto;
    }
  </style>
</head>
<body>
  <div id="capture-stage"></div>
</body>
</html>`;
