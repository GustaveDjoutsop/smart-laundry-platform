// Placeholder Worker — see wrangler.jsonc for why this exists. Returns a
// simple status payload; not routed to any domain or production traffic.
export default {
  async fetch() {
    return new Response(
      JSON.stringify({ status: 'ok', service: 'smart-laundry-platform' }),
      { headers: { 'content-type': 'application/json' } }
    );
  },
};
