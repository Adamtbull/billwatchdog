import { handleHumanRequest } from '../src/app.mjs';
/** New human routes only. Existing routes continue through Pages unchanged. */
export async function onRequest(context) {
  return (await handleHumanRequest(context.request, context.env)) ?? context.next();
}
