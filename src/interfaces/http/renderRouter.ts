import { Router, type Request, type Response } from 'express';
import type { StudioService } from '../../application/studioService.js';
import type { CallerSource } from '../../shared/types.js';

export function createRenderRouter(service: StudioService): Router {
  const router = Router();

  router.post('/validate', async (req: Request, res: Response) => {
    try {
      const code = String(req.body?.code ?? '');
      const source = (req.body?.source as CallerSource | undefined) ?? 'web';
      const result = await service.validate(code, source);
      res.json(result);
    } catch (err: unknown) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  router.post('/render', async (req: Request, res: Response) => {
    try {
      const {
        code = '',
        title,
        theme,
        look,
        background,
        scale,
        outputPath,
        includePngBase64 = true,
        source = 'web',
      } = req.body ?? {};

      const rendered = await service.render(String(code), {
        title,
        theme,
        look,
        background,
        scale,
        outputPath,
        source,
      });

      res.json({
        renderId: rendered.renderId,
        title: rendered.title,
        valid: rendered.valid,
        diagramType: rendered.diagramType,
        theme: rendered.theme,
        look: rendered.look,
        background: rendered.background,
        dimensions: rendered.dimensions,
        metrics: rendered.metrics,
        layoutDiagnostics: rendered.layoutDiagnostics,
        warnings: rendered.warnings,
        error: rendered.error,
        durationMs: rendered.durationMs,
        svg: rendered.svg,
        outputPath: rendered.outputPath,
        pngDataUrl:
          includePngBase64 && rendered.pngBytes
            ? `data:image/png;base64,${Buffer.from(rendered.pngBytes).toString('base64')}`
            : null,
      });
    } catch (err: unknown) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  router.post('/export', async (req: Request, res: Response) => {
    try {
      const {
        code = '',
        outputPath = '',
        title,
        format,
        theme,
        look,
        background,
        scale,
        source = 'web',
      } = req.body ?? {};

      if (!outputPath) {
        res.status(400).json({ error: '`outputPath` is required.' });
        return;
      }

      const exported = await service.exportDiagram({
        code: String(code),
        outputPath: String(outputPath),
        title,
        format,
        theme,
        look,
        background,
        scale,
        source,
      });
      res.json(exported);
    } catch (err: unknown) {
      res.status(422).json({ error: errorMessage(err) });
    }
  });

  return router;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
