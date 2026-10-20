// Vite turns an imported asset into its URL.
declare module '*.svg' {
  const url: string;
  export default url;
}

/** D-597: the version label, set at build time (vite.config.ts). */
declare const __TEGG_VERSION__: string;
