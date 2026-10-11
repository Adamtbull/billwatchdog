import { handleHumanRequest } from '../src/app.mjs';
/** Merge into the existing Pages Function entrypoint; do not overwrite that file. */
export async function onRequest(context) {
  const response = await handleHumanRequest(context.request, context.env);
  return response ?? context.next();
}
