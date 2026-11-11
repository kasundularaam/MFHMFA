import fs from 'node:fs';
import path from 'node:path';
import { Router, type Request, type Response } from 'express';
import type { StudioService } from '../../application/studioService.js';
import { toHostVisiblePath } from '../../config/env.js';
import type { CallerSource, MermaidLook, MermaidTheme } from '../../shared/types.js';

export function createChartRouter(service: StudioService): Router {
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
        theme,
        look,
        background,
        scale,
        outputPath,
        includePngBase64 = true,
        source = 'web',
      } = req.body ?? {};

      const rendered = await service.renderPreview(String(code), {
        theme,
        look,
        background,
        scale,
        outputPath,
        source,
      });

      res.json({
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
        pngPath: toHostVisiblePath(rendered.pngPath),
        svgPath: toHostVisiblePath(rendered.svgPath),
        outputPath: rendered.outputPath,
        previewPngUrl: rendered.previewPngUrl,
        pngDataUrl:
          includePngBase64 && rendered.pngBytes
            ? `data:image/png;base64,${Buffer.from(rendered.pngBytes).toString('base64')}`
            : null,
      });
    } catch (err: unknown) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  router.get('/previews/:file', (req: Request, res: Response) => {
    const safeName = path.basename(String(req.params.file));
    const fullPath = path.join(service.repo.previewsDir, safeName);
    if (!fs.existsSync(fullPath)) {
      res.status(404).json({ error: 'Preview not found' });
      return;
    }
    res.setHeader('Content-Type', safeName.endsWith('.svg') ? 'image/svg+xml' : 'image/png');
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(fullPath);
  });

  router.get('/charts', (req: Request, res: Response) => {
    const charts = service.listCharts({
      search: req.query.search ? String(req.query.search) : undefined,
      tag: req.query.tag ? String(req.query.tag) : undefined,
      diagramType: req.query.diagramType ? String(req.query.diagramType) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : 100,
    });
    res.json({ charts });
  });

  router.post('/charts', async (req: Request, res: Response) => {
    try {
      const body = req.body ?? {};
      if (!body.code || typeof body.code !== 'string') {
        res.status(400).json({ error: '`code` (string) is required.' });
        return;
      }

      const created = await service.createChart({
        id: body.id,
        title: body.title || 'Untitled Diagram',
        description: body.description,
        code: body.code,
        theme: body.theme,
        look: body.look,
        background: body.background,
        tags: body.tags,
        author: body.author || 'web',
        scale: body.scale,
        focusInUi: body.focusInUi ?? true,
        source: body.source ?? 'web',
      });

      res.status(201).json({
        chart: created.chart,
        svg: created.svg,
        studioUrl: created.studioUrl,
        pngUrl: created.pngUrl,
        svgUrl: created.svgUrl,
        durationMs: created.durationMs,
      });
    } catch (err: unknown) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  router.get('/charts/:id', async (req: Request, res: Response) => {
    try {
      const version = req.query.version ? Number(req.query.version) : undefined;
      const detail = await service.getChartWithVisuals(String(req.params.id), { version });
      res.json({
        chart: detail.chart,
        selectedVersion: detail.selectedVersion,
        code: detail.code,
        svg: detail.svg,
        versions: detail.versions,
        studioUrl: detail.studioUrl,
        pngUrl: detail.pngUrl,
        svgUrl: detail.svgUrl,
      });
    } catch (err: unknown) {
      res.status(404).json({ error: errorMessage(err) });
    }
  });

  const handleUpdate = async (req: Request, res: Response) => {
    try {
      const body = req.body ?? {};
      const updated = await service.updateChart(String(req.params.id), {
        title: body.title,
        description: body.description,
        code: body.code,
        theme: body.theme,
        look: body.look,
        background: body.background,
        tags: body.tags,
        author: body.author,
        changeNote: body.changeNote,
        scale: body.scale,
        focusInUi: body.focusInUi ?? false,
        source: body.source ?? 'web',
      });

      res.json({
        chart: updated.chart,
        svg: updated.svg,
        studioUrl: updated.studioUrl,
        pngUrl: updated.pngUrl,
        svgUrl: updated.svgUrl,
        durationMs: updated.durationMs,
      });
    } catch (err: unknown) {
      const msg = errorMessage(err);
      res.status(/not found/i.test(msg) ? 404 : 500).json({ error: msg });
    }
  };

  router.put('/charts/:id', handleUpdate);
  router.patch('/charts/:id', handleUpdate);

  router.delete('/charts/:id', (req: Request, res: Response) => {
    const deleted = service.deleteChart(String(req.params.id));
    if (!deleted) {
      res.status(404).json({ error: 'Chart not found' });
      return;
    }
    res.json({ deleted: true, id: req.params.id });
  });

  router.get('/charts/:id/png', async (req: Request, res: Response) => {
    try {
      const version = req.query.version ? Number(req.query.version) : undefined;
      const customScale = req.query.scale ? Number(req.query.scale) : undefined;
      const customTheme = req.query.theme as MermaidTheme | undefined;
      const customLook = req.query.look as MermaidLook | undefined;
      const customBg = req.query.background ? String(req.query.background) : undefined;

      const detail = await service.getChartWithVisuals(String(req.params.id), { version });

      if (customScale || customTheme || customLook || customBg) {
        const rendered = await service.engine.render(detail.code, {
          theme: customTheme ?? detail.chart.theme,
          look: customLook ?? detail.chart.look,
          background: customBg ?? detail.chart.background,
          scale: customScale ?? 2,
        });
        if (!rendered.pngBytes) {
          res.status(422).json({ error: 'Chart contains syntax errors and cannot render PNG.' });
          return;
        }
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'no-cache');
        res.send(Buffer.from(rendered.pngBytes));
        return;
      }

      if (!detail.pngBytes) {
        res.status(422).json({ error: 'Chart contains syntax errors and has no rendered PNG.' });
        return;
      }
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'no-cache');
      res.send(Buffer.from(detail.pngBytes));
    } catch (err: unknown) {
      res.status(404).json({ error: errorMessage(err) });
    }
  });

  router.get('/charts/:id/svg', async (req: Request, res: Response) => {
    try {
      const version = req.query.version ? Number(req.query.version) : undefined;
      const detail = await service.getChartWithVisuals(String(req.params.id), { version });
      if (!detail.svg) {
        res.status(422).json({ error: 'Chart contains syntax errors and has no rendered SVG.' });
        return;
      }
      res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.send(detail.svg);
    } catch (err: unknown) {
      res.status(404).json({ error: errorMessage(err) });
    }
  });

  return router;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
