const DEFAULT_GITHUB_URL = 'https://github.com/kasundularaam/MFHMFA';

interface MobileInfoPageProps {
  repoUrl?: string;
}

export function MobileInfoPage({ repoUrl }: MobileInfoPageProps) {
  const githubHref = repoUrl || DEFAULT_GITHUB_URL;

  return (
    <main className="mobile-info-page" data-testid="mobile-info-page">
      <article className="mobile-info-body">
        <p className="mobile-eyebrow">Desktop Workspace</p>
        <h1>MFHMFA</h1>
        <p>
          MFHMFA is an interactive visual learning workspace you use on your computer alongside
          an AI agent. When you ask how a concept, research paper, codebase, bug, or design
          tradeoff works, your agent streams a small interactive diagram to your browser instead
          of a wall of chat text.
        </p>

        <h2>What it does</h2>
        <ul>
          <li>
            <strong>Step through flows:</strong> Move through a diagram one step at a time and
            compare scenarios like normal execution vs. failure.
          </li>
          <li>
            <strong>Click any box:</strong> Read a plain explanation, a concrete example, and
            what breaks when something goes wrong.
          </li>
          <li>
            <strong>Zoom into details:</strong> Keep each view small (4–7 boxes) and open linked
            sub-diagrams only where you want to go deeper.
          </li>
          <li>
            <strong>Saved in your browser:</strong> Nothing is stored on the server. Your
            projects and recent file history stay in your desktop browser.
          </li>
        </ul>

        <h2>Use it on your computer</h2>
        <ol>
          <li>
            Open <code>mfhmfa.kasun.si</code> in a desktop browser.
          </li>
          <li>
            Click <strong>Copy MCP URL</strong> and add it to Claude Code, Pi, Cursor, or
            another MCP client.
          </li>
          <li>Keep the browser tab open and ask your agent to explain something.</li>
        </ol>

        <p className="mobile-footer-note">
          The interactive studio requires a desktop screen. Read the docs and source code on{' '}
          <a href={githubHref} target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
          .
        </p>
      </article>
    </main>
  );
}
