// Serves the static site, and sends anyone on the workers.dev address to the custom domain.
// The simulation itself runs entirely in the browser.
const CANONICAL_HOST = 'animal-arena.marcroberts.info';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname.endsWith('.workers.dev')) {
      url.protocol = 'https:';
      url.hostname = CANONICAL_HOST;
      url.port = '';
      return Response.redirect(url.toString(), 301);
    }
    return env.ASSETS.fetch(request);
  },
};
