const crypto = require('crypto');

// Resolves whichever identifier an interaction arrived on to a single
// canonical customer_id - see afromarket-identity-linkage-design.md. Only
// two linking paths exist, both requiring Meta-verified or customer-confirmed
// proof, never inference from name/address/order similarity (a false-positive
// merge would leak one customer's order history/address to a different
// person's identifier, which is worse than staying unlinked):
//   1. Automatic - a single contacts[] webhook entry carrying both a phone
//      (wa_id) and a BSUID (user_id) together means Meta's Portfolio Contact
//      Book has already paired them; call resolve() with both.
//   2. Explicit - a REQUEST_CONTACT_INFO response confirms a phone for a
//      previously BSUID-only customer (not yet implemented - deferred per
//      the design doc's Open Items).
class IdentityResolver {
  constructor({ customerIdentityLinkStore }) {
    if (!customerIdentityLinkStore) throw new Error('IdentityResolver requires customerIdentityLinkStore');

    this.customerIdentityLinkStore = customerIdentityLinkStore;
  }

  // primary: the { type, value } identifier this interaction actually
  // arrived on. pairedWith: an optional second { type, value } identifier
  // Meta itself asserted alongside it - omit unless the caller has actual
  // confirmation, not a guess.
  //
  // Race-safety note: primary's resolution is a single atomic upsert-and-
  // return (CustomerIdentityLinkStore.link), not a check-then-insert - two
  // concurrent resolve() calls for the same brand-new customer (WhatsApp's
  // at-least-once webhook redelivery, or multiple service instances) always
  // converge on whichever customer_id actually won the row, never on two
  // different locally generated UUIDs each caller wrongly trusted.
  async resolve({ primary, pairedWith, linkMethod = 'meta_contact_book' }) {
    if (!primary || !primary.type || !primary.value) {
      throw new Error('IdentityResolver.resolve requires a primary { type, value } identifier');
    }

    // Only looked up to pick a sensible candidate customer_id when primary
    // turns out to be genuinely new - if pairedWith already has a canonical
    // id, a new primary should join it rather than mint its own. This
    // lookup itself has no race-safety requirement: link()'s atomic
    // RETURNING below is what actually decides the outcome for primary.
    const existingForPaired = pairedWith
      ? await this.customerIdentityLinkStore.findByIdentifier({
          identifierType: pairedWith.type,
          identifierValue: pairedWith.value
        })
      : null;

    const candidateCustomerId = existingForPaired || crypto.randomUUID();

    const customerId = await this.customerIdentityLinkStore.link({
      customerId: candidateCustomerId,
      identifierType: primary.type,
      identifierValue: primary.value,
      linkMethod
    });

    if (pairedWith) {
      // Best-effort attach under whatever primary actually resolved to.
      // Return value ignored on purpose: if pairedWith already belongs to a
      // different customer_id, this is a harmless no-op (see
      // CustomerIdentityLinkStore.link's ON CONFLICT comment) and that
      // existing link is left exactly as-is rather than reassigned.
      await this.customerIdentityLinkStore.link({
        customerId,
        identifierType: pairedWith.type,
        identifierValue: pairedWith.value,
        linkMethod
      });
    }

    return customerId;
  }
}

module.exports = { IdentityResolver };
