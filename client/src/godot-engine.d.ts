// Ambient types for the Godot 4.7.2 web export loader (`/godot/engine-<ver>/mb.js`).
// The script is injected at runtime by game.ts — never bundled — so it only
// exists as a global. Subset of the official Engine API that game.ts uses.

interface GodotConfig {
  /** Base path of the engine files: `${executable}.js` / `.wasm`. */
  executable: string;
  /** URL of the .pck to load as the main pack. */
  mainPack: string;
  canvas: HTMLCanvasElement;
  /** 0 = none (page owns the canvas size), 1 = project, 2 = adaptive. */
  canvasResizePolicy: 0 | 1 | 2;
  focusCanvas: boolean;
  /** "" disables the PWA service worker. */
  serviceWorker: string;
  /** Exact fetch URL → byte size, for the download progress callback. */
  fileSizes: Record<string, number>;
  args: string[];
  onProgress(current: number, total: number): void;
  onPrint(...args: unknown[]): void;
  onPrintError(...args: unknown[]): void;
  onExit(code: number): void;
}

declare class Engine {
  constructor(cfg: Partial<GodotConfig>);
  static getMissingFeatures(o?: { threads?: boolean }): string[];
  startGame(o?: Partial<GodotConfig>): Promise<void>;
  requestQuit(): void;
}
