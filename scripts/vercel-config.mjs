import base from './vercel-base.json' with {type:'json'};
import {backendEnvironment,replaceDeploymentReferences} from './backend-environment.mjs';

export function vercelConfig(env){
  const backend=backendEnvironment(env);
  // A static JSON import is bundled with Vercel's temporary config module.
  // Runtime file reads relative to import.meta.url would point into .vercel/.
  const config=JSON.parse(replaceDeploymentReferences(JSON.stringify(base),backend));
  return {...config,buildCommand:'npm run build:web',outputDirectory:'dist/web'};
}
