import {readFileSync} from 'node:fs';
import {backendEnvironment,replaceDeploymentReferences} from './backend-environment.mjs';

export function vercelConfig(env){
  const backend=backendEnvironment(env);
  const base=readFileSync(new URL('./vercel-base.json',import.meta.url),'utf8');
  const config=JSON.parse(replaceDeploymentReferences(base,backend));
  return {...config,buildCommand:'npm run build:web',outputDirectory:'dist/web'};
}
