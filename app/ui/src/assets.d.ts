// Vite turns an imported asset into its URL.
declare module '*.svg' {
  const url: string;
  export default url;
}

/** D-597: the version label, set at build time (vite.config.ts). */
declare const __TEGG_VERSION__: string;

/** JSON data modules (the icon data chunk, v1-cards §5.5): typed where they are imported. */
declare module '*.json' {
  const data: unknown;
  export default data;
}
