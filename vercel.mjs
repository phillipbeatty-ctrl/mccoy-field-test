import {vercelConfig} from './scripts/vercel-config.mjs';

// Vercel evaluates programmatic config before the build, so its CSP and the
// generated browser assets use the same validated deployment environment.
export const config=vercelConfig(process.env);
