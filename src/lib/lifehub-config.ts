/**
 * Public addresses for the Life Hub connection. These are URLs, not secrets: PALATE is a public
 * OAuth client (PKCE, no client secret) that identifies itself with the metadata document at
 * LIFEHUB_CLIENT_ID, served from this app's own GitHub Pages site (public/lifehub-client.json).
 */
export const LIFEHUB_ORIGIN = "https://life-hub-api.213303.workers.dev";
export const PALATE_APP_URL = "https://kingjnu-sakayume.github.io/food/";
export const LIFEHUB_CLIENT_ID = PALATE_APP_URL + "lifehub-client.json";
export const LIFEHUB_RESOURCE = LIFEHUB_ORIGIN + "/palate";
/** `food:board` lets this app upload its board tiles; connections made before it need one reconnect. */
export const LIFEHUB_SCOPE = "food:inbox food:board";
