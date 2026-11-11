import type {
  RenderEngineStats,
  RenderOptions,
  RenderedDiagram,
  ValidationResult,
} from '../shared/types.js';

export interface RenderEnginePort {
  validate(code: string): Promise<ValidationResult>;
  render(code: string, options?: RenderOptions): Promise<RenderedDiagram>;
  getStats?(): RenderEngineStats;
  dispose(): Promise<void>;
}
