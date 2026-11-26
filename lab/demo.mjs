import { scenario } from './scenario.mjs';

await scenario({ trials: 1, progress: console.log });
