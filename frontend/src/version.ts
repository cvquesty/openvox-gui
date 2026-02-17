/**
 * Application version — single source of truth for the frontend.
 *
 * The value is injected at build time by Vite from package.json "version"
 * (see vite.config.ts `define` block).  Every component that needs to
 * display the version should import this constant rather than hardcoding
 * a string.
 */
export const APP_VERSION: string = __APP_VERSION__;