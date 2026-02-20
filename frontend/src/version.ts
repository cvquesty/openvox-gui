/**
 * Application version — injected at build time from the root VERSION file.
 *
 * The VERSION file at the repository root is the single source of truth.
 * Vite reads it at build time and injects it as the __APP_VERSION__ constant
 * (see vite.config.ts). Every component that needs to display the version
 * should import this constant rather than hardcoding a string.
 */
export const APP_VERSION: string = __APP_VERSION__;