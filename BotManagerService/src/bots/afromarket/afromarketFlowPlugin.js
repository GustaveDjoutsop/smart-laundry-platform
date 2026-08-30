const crypto = require('crypto');
const { FlowPlugin } = require('../../core/flows/flowPlugin');
const { getPaymentService } = require('../../core/payments/paymentService');
const { CustomerProfileStore } = require('../../core/customers/customerProfileStore');
const { logger } = require('../../utils/logger');

function formatEuro(amount) {
  const value = Number(amount) || 0;
  return `€${value.toFixed(2)}`;
}

function findProduct(botConfig, productId) {
  const products = Array.isArray(botConfig.products) ? botConfig.products : [];
  return products.find((p) => p && p.id === productId) || null;
}

// Shared by findCurrentPromoProduct and _handleAddDiscounted below - a
// product's salePriceEur is only trustworthy as a live discount when it's a
// positive number strictly less than priceEur (same rule
// submitCatalogBatch.js's validation already enforces before Meta ever sees
// it, checked again here since bot.json and the catalog sync are two
// independently-read copies of the same file, not one shared value).
function hasValidSalePrice(product) {
  if (!product) return false;
  const salePrice = Number(product.salePriceEur);
  const price = Number(product.priceEur);
  return Number.isFinite(salePrice) && salePrice > 0 && Number.isFinite(price) && salePrice < price;
}

// The "Current promo" menu option and the catalog's own sale_price display
// (see submitCatalogBatch.js's salePriceEur -> sale_price mapping) must never
// drift apart - the bug this exists to fix was exactly that mismatch (a
// hardcoded promo blurb unrelated to whatever the catalog actually showed on
// sale). salePriceEur on a product config entry is the single source of
// truth for both; this just finds whichever product currently has one set.
// Picks the first match - AfroMarket runs one active promo at a time today,
// and afromarket_promo_v1 (a single-product template) can only feature one
// product per send regardless.
function findCurrentPromoProduct(botConfig) {
  const products = Array.isArray(botConfig.products) ? botConfig.products : [];
  return products.find(hasValidSalePrice) || null;
}

// Derives the whole-number percent-off the promo template displays directly
// from priceEur/salePriceEur - never a separately hand-maintained number -
// so the template's headline percentage and the discounted cart price
// _handleAddDiscounted computes from the same payload always agree with the
// catalog's own sale_price. Rounds rather than truncates for the same reason
// scripts/sendPromoTemplate.js rejects a non-integer CLI argument: WhatsApp
// template variables are plain text, so this must already be the exact
// number to display, not something Meta or the client will further round.
function computePercentOff(product) {
  const price = Number(product.priceEur);
  const salePrice = Number(product.salePriceEur);
  return Math.round((1 - salePrice / price) * 100);
}

// Ships disabled by default (per afromarket-catalog-cart-migration-todo.md's
// rollout strategy) - deliberately its own flag rather than reusing
// isProductionEnv()/hideInProd from flowEngine.js, since that helper's
// *unset* default is "not production" (dev), which is the opposite polarity
// of "off unless explicitly turned on". Read fresh per call (not cached at
// require-time) so it's tunable per Railway environment without a code
// change, matching the CAROUSEL_FOOTER_DELAY_MS/LAUDRY_OPEN_HOUR convention.
function isNativeCatalogEnabled() {
  return String(process.env.AFROMARKET_NATIVE_CATALOG_ENABLED || '').trim().toLowerCase() === 'true';
}

// Single source of truth for which provider AfroMarket checkout uses. Deliberately
// one enum-valued flag rather than two independent booleans (STRIPE_ENABLED /
// PAYPAL_ENABLED) - two booleans can both end up true or both false, which has no
// sane meaning here; one flag makes "exactly one active provider" true by
// construction. Defaults to paypal per the production launch decision. Read fresh
// per call (not cached at require-time), matching isNativeCatalogEnabled's
// convention above, so it's tunable per Railway environment without a redeploy.
function getActivePaymentProvider() {
  const raw = String(process.env.AFROMARKET_PAYMENT_PROVIDER || 'paypal').trim().toLowerCase();
  if (raw !== 'stripe' && raw !== 'paypal') {
    logger.warn(`AFROMARKET_PAYMENT_PROVIDER="${raw}" is not "stripe" or "paypal" - defaulting to paypal`);
    return 'paypal';
  }
  return raw;
}

// Mirrors the section titles already used in afromarket.bot.json's
// "groceries_categories" list state - kept as a small local map rather than
// read back out of the JSON config, since it's just the two category labels
// for this one bot. Update alongside bot.json if categories ever change.
const CATEGORY_TITLES = {
  beans_nuts: '🫘 Beans & Nuts',
  leaves: '🌿 Dried Leaves',
  snack_breakfast: '🥣 Snack & Breakfast'
};

function buildNativeCatalogSections(botConfig) {
  const products = Array.isArray(botConfig.products) ? botConfig.products : [];
  const sectionsByCategory = new Map();

  for (const product of products) {
    if (!product || !product.id || !product.category) continue;
    const title = CATEGORY_TITLES[product.category] || product.category;
    if (!sectionsByCategory.has(title)) sectionsByCategory.set(title, []);
    sectionsByCategory.get(title).push(product.id);
  }

  return Array.from(sectionsByCategory.entries()).map(([title, productRetailerIds]) => ({ title, productRetailerIds }));
}

// unitPriceOverride (promo/discounted adds - see _handleAddDiscounted) is
// folded into the existing-line match itself rather than handled as a
// special case: matching on productId+unitPrice together means a
// promo-priced unit merges with an existing line only if that line is at
// the same price, and otherwise starts its own line - a discounted tap
// never silently merges into (or overwrites) an already-cart'd full-price
// unit. Every pre-existing call site omits the override, so unitPrice is
// always product.priceEur there and this match behaves exactly as before.
function addProductToCart(cart, product, { unitPriceOverride } = {}) {
  const unitPrice = unitPriceOverride != null ? Number(unitPriceOverride) || 0 : Number(product.priceEur) || 0;
  const existing = cart.find((line) => line.productId === product.id && line.unitPrice === unitPrice);
  if (existing) {
    existing.qty += 1;
    return;
  }
  cart.push({
    productId: product.id,
    name: product.name,
    unitPrice,
    unit: product.unit,
    qty: 1
  });
}

function buildCartSummaryText(cart) {
  if (!cart.length) {
    return '🛒 Your cart is empty.\n\nBrowse groceries to add items!';
  }

  const lines = cart.map((line) => {
    const lineTotal = line.unitPrice * line.qty;
    return `• ${line.qty}x ${line.name} — ${formatEuro(lineTotal)}`;
  });

  const grandTotal = cart.reduce((sum, line) => sum + line.unitPrice * line.qty, 0);

  return `🛒 *Your Cart*\n\n${lines.join('\n')}\n\n*Total: ${formatEuro(grandTotal)}*`;
}

function generateOrderNumber() {
  const randomPart = Math.random().toString(36).slice(2, 7).toUpperCase();
  const timePart = Date.now().toString(36).slice(-4).toUpperCase();
  return `AM-${randomPart}${timePart}`;
}

const DELIVERY_WINDOW_DAYS = 3;

function estimatedDeliveryDate() {
  const deliveryDate = new Date(Date.now() + DELIVERY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return deliveryDate.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function buildOrderConfirmationText({ orderNumber, cart, name, address, phone }) {
  const grandTotal = cart.reduce((sum, line) => sum + line.unitPrice * line.qty, 0);
  const itemLines = cart.map((line) => `• ${line.qty}x ${line.name}`).join('\n');

  return (
    `✅ *Order confirmed*\n\n` +
    `Hi ${name},\n\n` +
    `Thank you for your purchase! Your order number is *${orderNumber}*.\n\n` +
    `${itemLines}\n\n` +
    `Total: *${formatEuro(grandTotal)}*\n` +
    `Delivering to: ${address}\n` +
    `Contact: ${phone}\n\n` +
    `We'll start getting your fresh African groceries ready to ship.\n` +
    `We deliver within ${DELIVERY_WINDOW_DAYS} days - estimated arrival: ${estimatedDeliveryDate()}.\n\n` +
    `We will let you know when your order ships.`
  );
}

// AfroMarketFlowPlugin adds the two pieces of behavior that a pure JSON config
// cannot express: a stateful shopping cart (with per-line totals) and order
// checkout. Everything else (menus, recipes, product photos, static info
// cards) stays plain configuration in afromarket.bot.json.
class AfroMarketFlowPlugin extends FlowPlugin {
  constructor({ botConfig, customerProfileStore } = {}) {
    super();
    this.botConfig = botConfig;
    // No constructor args needed - CustomerProfileStore shares the module-level
    // Postgres pool (see getPool() in pgClient.js), so a fresh instance here is
    // cheap. Accepting an override keeps this testable without a real DB.
    this.customerProfileStore = customerProfileStore || new CustomerProfileStore();
  }

  async beforeState(ctx) {
    const flow = (this.botConfig.flows || {})[ctx.flowId];
    if (!flow) return;
    const stateDefinition = flow.states.find((s) => s.id === ctx.stateId);
    if (!stateDefinition) return;

    if (stateDefinition.id === 'cart_view') {
      const cart = ctx.get('cart') || [];
      ctx.set('cartSummaryText', buildCartSummaryText(cart));
      // Reaching cart_view means either a fresh look at the cart before
      // checking out, or landing here via cancel_checkout - either way, any
      // idempotency key/order number from a prior attempt is done with and
      // must not leak into a later, unrelated checkout.
      ctx.set('checkoutIdempotencyKey', null);
      ctx.set('checkoutOrderNumber', null);
      return;
    }

    if (stateDefinition.id === 'checkout_review') {
      const cart = ctx.get('cart') || [];
      ctx.set('cartSummaryText', buildCartSummaryText(cart));
      // Generated once per checkout attempt and reused across the review ->
      // email-required -> confirm loop, so a double-tap on "Confirm Order"
      // (or a redelivered inbound message) can't mint a second order/payment
      // session - see PaymentGateway.initiatePayment's idempotency lookup.
      if (!ctx.get('checkoutIdempotencyKey')) {
        ctx.set('checkoutIdempotencyKey', crypto.randomUUID());
      }
      if (!ctx.get('checkoutOrderNumber')) {
        ctx.set('checkoutOrderNumber', generateOrderNumber());
      }
      return;
    }

    if (stateDefinition.id === 'recipe_actions') {
      const cart = ctx.get('cart') || [];
      ctx.set(
        'recipeActionButtons',
        cart.length
          ? [
              { id: 'view_cart', title: '👀 View Cart' },
              { id: 'more_recipes', title: '🍲 More recipes' },
              { id: 'menu', title: '🏠 Main menu' }
            ]
          : [
              { id: 'buy_ingredients', title: '🛒 Buy ingredients' },
              { id: 'more_recipes', title: '🍲 More recipes' },
              { id: 'menu', title: '🏠 Main menu' }
            ]
      );
      return;
    }

    if (stateDefinition.productId) {
      ctx.set('currentProductId', stateDefinition.productId);
      ctx.set('currentCategoryBackStateId', stateDefinition.categoryStateId || 'groceries_categories');
      ctx.set('cartAddedText', '');
      return;
    }

    if (stateDefinition.recipeId) {
      ctx.set('currentRecipeId', stateDefinition.recipeId);
      ctx.set('currentRecipeName', stateDefinition.recipeName || stateDefinition.recipeId);
      ctx.set('recipeCartAddedText', '');
    }
  }

  async handleAction(ctx, { action }) {
    if (action === 'shop.enter') {
      return this._handleShopEntry(ctx);
    }

    if (action === 'shop.landing') {
      return this._handleShopLanding(ctx);
    }

    if (action === 'products.route') {
      return this._handleProductAction(ctx);
    }

    if (action === 'products.addDiscounted') {
      return this._handleAddDiscounted(ctx);
    }

    if (action === 'promo.sendCurrent') {
      return this._handleSendCurrentPromo(ctx);
    }

    if (action === 'promo.landing') {
      return this._handleCurrentPromoLanding(ctx);
    }

    if (action === 'recipes.route') {
      return this._handleRecipeAction(ctx);
    }

    if (action === 'cart.checkout') {
      return this._handleCheckout(ctx);
    }

    if (action === 'checkout.start') {
      return this._handleCheckoutStart(ctx);
    }

    if (action === 'checkout.finishDetails') {
      return this._handleFinishCheckoutDetails(ctx);
    }

    return false;
  }

  // Gate between the legacy manual "Choose Category"/"Choose Item" flow and
  // Meta's native product_list (MPM) message - see
  // afromarket-catalog-cart-migration-todo.md Phase 2. Every "browse
  // groceries" entry point in bot.json routes to this state now instead of
  // straight to groceries_categories, so flipping the flag changes behavior
  // everywhere at once rather than per-entry-point.
  async _handleShopEntry(ctx) {
    if (!isNativeCatalogEnabled()) {
      ctx.goto('groceries_categories');
      return true;
    }

    const catalogId = String(process.env.AFROMARKET_CATALOG_ID || '').trim();
    if (!catalogId) {
      logger.warn('AfroMarket: AFROMARKET_NATIVE_CATALOG_ENABLED is true but AFROMARKET_CATALOG_ID is not set - falling back to legacy shop flow');
      ctx.goto('groceries_categories');
      return true;
    }

    const sections = buildNativeCatalogSections(this.botConfig);
    if (!sections.length) {
      logger.warn('AfroMarket: no products with a category found for native catalog sections - falling back to legacy shop flow');
      ctx.goto('groceries_categories');
      return true;
    }

    try {
      await ctx.send({
        type: 'product_list',
        to: ctx.from,
        catalogId,
        header: '🛒 Shop Online',
        body: 'Browse our African grocery categories - tap a product to see details, or add it straight to your cart!',
        footer: 'Tap the cart icon when you’re ready to check out.',
        sections
      });
    } catch (err) {
      // No PII here on purpose (no ctx.from/name/address) - just enough to
      // spot a broken catalogId or a Meta API outage from the logs alone,
      // since a throw here also means the conversation state below never
      // gets persisted (see ConfigBot.handleMessage) - the customer silently
      // stays wherever they were before tapping "Shop online".
      logger.error('AfroMarket: failed to send native product_list from shop_entry', {
        catalogId,
        sectionsCount: sections.length,
        error: err && err.message ? err.message : String(err)
      });
      throw err;
    }

    logger.info('AfroMarket: shop_entry sent native product_list', {
      catalogId,
      sectionsCount: sections.length
    });

    // Land on 'shop_landing' instead of 'welcome' directly - but note that
    // ctx.goto() alone does NOT end this engine turn: flowEngine.js's step()
    // loop only halts on an action state that neither goto's nor has a
    // `next` (see its `if (!flowContext._didGoto && !stateDefinition.next)
    // break;`). A plain goto('shop_landing') would still chain straight
    // through shop_landing's own handler in this same turn, landing right
    // back on 'welcome' and rendering its list message behind the
    // product_list above - the exact two-messages-in-one-turn bug this is
    // fixing (confirmed by a failing test before this flag was added).
    // 'shopLandingArmed' is what actually breaks that chain: on this first,
    // synchronous pass through shop_landing (armed), _handleShopLanding
    // below deliberately does NOT goto anywhere, which - combined with
    // shop_landing having no `next` in bot.json - is what makes the loop
    // stop here for real, with only the product_list sent. The customer's
    // next genuine inbound message re-enters shop_landing fresh (armed
    // cleared), and *that* call goto's 'welcome' - see _handleShopLanding's
    // comment for exactly what that does and doesn't guarantee. Their real
    // next move - browsing/adding to cart - happens entirely in WhatsApp's
    // own UI; a submitted order arrives as an inbound `type: "order"`
    // message that AfroMarketBot.handleMessage intercepts before flow
    // dispatch (Phase 3), not anything reachable from here.
    ctx.set('shopLandingArmed', true);
    ctx.goto('shop_landing');
    return true;
  }

  // See the long comment in _handleShopEntry for why this needs the
  // 'shopLandingArmed' flag rather than just always redirecting: this
  // handler runs twice per catalog browse - once synchronously right after
  // shop_entry (armed - stay silent, end the turn), and once on the
  // customer's actual next message (not armed).
  //
  // The unarmed goto('welcome') is NOT a guaranteed re-render of the welcome
  // menu - verified by tracing flowEngine.js's step() loop and confirmed
  // with a live repro during review. 'welcome' is a `list`-type state, and
  // the engine only renders a list when it hasn't already consumed this
  // turn's inbound text as an answer (`hasConsumedInboundText`); reaching
  // 'welcome' via goto() from an action state never sets that flag, so the
  // engine treats the customer's fresh message as if it WERE their answer
  // to welcome's list and routes it through `main_route` immediately:
  //   - text matching a main_route option (e.g. a customer re-tapping a
  //     stale "🛒 Shop online"/"🍲 Get recipe ideas" button still visible
  //     from an earlier message - WhatsApp lets that happen at any time)
  //     goes straight to that destination in one hop, welcome never renders.
  //   - anything else falls through main_route's `default: "welcome"` and
  //     welcome renders on that second internal hop, same turn.
  // Either way exactly one message is sent this turn - this does NOT
  // reintroduce the double-message bug the armed flag exists to fix - and a
  // stale tap always lands wherever that tap's own label says it goes. This
  // is deliberate opportunistic routing, not a bug: forcing an unconditional
  // welcome re-render here would make direct, unambiguous stale-tap intent
  // worse UX, not better. See the regression test covering this exact case.
  _handleShopLanding(ctx) {
    if (ctx.get('shopLandingArmed')) {
      ctx.set('shopLandingArmed', false);
      logger.info('AfroMarket: shop_landing armed - ending turn silently after product_list');
      return true;
    }

    logger.info('AfroMarket: shop_landing unarmed - handing off to main_route via welcome');
    ctx.goto('welcome');
    return true;
  }

  _handleProductAction(ctx) {
    const choice = String(ctx.get('productActionChoice') || '').trim();
    const cart = ctx.get('cart') || [];

    if (choice === 'cart_add') {
      const product = findProduct(this.botConfig, ctx.get('currentProductId'));
      if (product) {
        // Regression fix: this is the SAME "Add to Cart" button shown on
        // product_actions regardless of how the customer got there - after
        // a discounted promo add (_handleAddDiscounted), or just browsing a
        // product normally. It used to always charge product.priceEur, so a
        // customer who tapped "Shop Now" on a promo (correctly charged the
        // sale price), then tapped "Add to Cart" again on the very next
        // screen, saw the discount silently vanish for that unit - flagged
        // live by the business owner as a real billing concern ("which is
        // going to be charged"). Now charges the catalog's live salePriceEur
        // whenever the product still has one, exactly like
        // _handleAddDiscounted already does - so "Add to Cart" always
        // reflects the price actually on sale, consistent with every other
        // add path for this product, not a separate "explicit repeat add"
        // concept.
        const usesCatalogSalePrice = hasValidSalePrice(product);
        const unitPrice = usesCatalogSalePrice ? Number(product.salePriceEur) : Number(product.priceEur);
        addProductToCart(cart, product, { unitPriceOverride: unitPrice });
        ctx.set('cart', cart);
        ctx.set('cartAddedText', `✅ Added *${product.name}* (${formatEuro(unitPrice)}) to your cart!\n\n`);
      }
      ctx.goto('product_actions');
      return true;
    }

    if (choice === 'view_cart') {
      ctx.goto('cart_view');
      return true;
    }

    if (choice === 'back_category') {
      ctx.goto(ctx.get('currentCategoryBackStateId') || 'groceries_categories');
      return true;
    }

    ctx.goto('welcome');
    return true;
  }

  // Lands here via a payloadTriggers entry (see flowEngine.js/bot.json),
  // not a saveAs context value - a promo-blast quick-reply tap is a cold
  // start, possibly days after the customer's last real conversation turn,
  // so there's no prior state to have captured anything. Payload shape:
  // "promo_add:<productId>:<percentOff>", produced by
  // scripts/submitPromoTemplate.js's Variant A quick-reply button.
  _handleAddDiscounted(ctx) {
    const raw = String(ctx.inbound?.text || '');
    const match = /^promo_add:([a-z0-9_]+):(\d{1,3})$/i.exec(raw);
    if (!match) {
      ctx.goto('welcome');
      return true;
    }

    const [, productId, percentOffRaw] = match;
    const percentOff = Math.min(100, Math.max(0, parseInt(percentOffRaw, 10)));

    // Never trust a price/percentage implied by the tapped template alone -
    // recompute from the current products config, the same "never trust
    // stale client-side data" discipline already enforced for native cart
    // orders (see AfroMarketBot._handleNativeOrder).
    const product = findProduct(this.botConfig, productId);
    if (!product) {
      ctx.goto('welcome');
      return true;
    }

    // percentOff (parsed from the tapped payload) is a rounded whole number
    // (see computePercentOff) - reconstructing the price from it alone can
    // land a cent or two off the catalog's actual salePriceEur for any
    // discount that isn't a round percentage (e.g. 33.33% rounds to 33%,
    // reconstructing a price the catalog doesn't actually show). Caught in
    // review: this is the exact class of bug this whole feature exists to
    // prevent, just one step removed. Prefer the catalog's own salePriceEur
    // verbatim whenever it's still a valid discount for this product - it's
    // always the live, current-truth number, unlike anything embedded in a
    // possibly-days-old tapped message. Falls back to the percentOff
    // reconstruction only when the product currently has no catalog
    // salePriceEur at all (e.g. a one-off manual blast via
    // scripts/sendPromoTemplate.js for a discount not reflected in the
    // catalog).
    const usesCatalogSalePrice = hasValidSalePrice(product);
    const discountedPrice = usesCatalogSalePrice
      ? Number(product.salePriceEur)
      : Math.round(Number(product.priceEur) * (1 - percentOff / 100) * 100) / 100;
    // The displayed percentage must describe the price actually being
    // charged - showing the tapped payload's percentOff next to a price
    // computed from salePriceEur instead would just move the alignment bug
    // into the confirmation text itself (e.g. a stale "50% off" label next
    // to the catalog's real ~20%-off price).
    const displayPercentOff = usesCatalogSalePrice ? computePercentOff(product) : percentOff;
    const cart = ctx.get('cart') || [];
    addProductToCart(cart, product, { unitPriceOverride: discountedPrice });
    ctx.set('cart', cart);
    ctx.set('cartAddedText', `✅ Added *${product.name}* at ${displayPercentOff}% off (${formatEuro(discountedPrice)}) to your cart!\n\n`);
    // So a subsequent "Add to Cart" tap on the shared product_actions state
    // (_handleProductAction's cart_add branch) knows which product to add -
    // at full price, since that's a distinct, explicit repeat add rather
    // than another promo application.
    ctx.set('currentProductId', productId);
    ctx.goto('product_actions');
    return true;
  }

  // "Current promo" from the main menu - was a static hardcoded blurb
  // (unrelated to whatever the catalog actually showed on sale), which is
  // the bug this exists to fix. Now sends the approved afromarket_promo_v1
  // template for whichever product actually has a salePriceEur set, with
  // the percentage derived from that same field - see
  // findCurrentPromoProduct/computePercentOff above for why that keeps this
  // aligned with the catalog's own sale_price display, not a second,
  // independently-maintained number.
  //
  // Sends ONLY the template (or its text fallback) - no follow-up message.
  // An earlier version also sent a "What would you like to do next?" buttons
  // message right after, which needed a delivery-status wait to avoid
  // visually racing ahead of the template (a template's header image goes
  // through Meta's own async media upload + hydration, slower than a plain
  // interactive message). Live-tested on dev: even a 6s wait wasn't always
  // enough on the sandbox WABA. Removed per explicit business-owner
  // feedback ("we should not receive the message What would you like to do
  // next?") - simpler and structurally immune to that whole class of race,
  // since there's no second message left to race against.
  async _handleSendCurrentPromo(ctx) {
    const product = findCurrentPromoProduct(this.botConfig);
    if (!product) {
      // Nothing currently on sale - degrade to the same "what's new"
      // message this menu option used to always show, rather than sending
      // a promo template with no discount to actually announce.
      ctx.goto('current_promo_none');
      return true;
    }

    const percentOff = computePercentOff(product);

    try {
      await ctx.send({
        type: 'promo_template',
        to: ctx.from,
        templateName: 'afromarket_promo_v1',
        languageCode: 'en_US',
        percentOff,
        productName: product.name,
        imageLink: product.imageUrl,
        quickReplyPayload: `promo_add:${product.id}:${percentOff}`
      });
    } catch (err) {
      // Same discipline as _handleShopEntry/_handleCheckout's payment-link
      // fallback: a failed template send (disapproved, throttled WABA,
      // missing image) must not leave the customer with nothing after
      // tapping "Current promo" - fall back to a plain-text version of the
      // exact same offer instead of losing it.
      logger.warn('AfroMarket: failed to send promo template from current_promo, falling back to text', {
        productId: product.id,
        percentOff,
        error: err && err.message ? err.message : String(err)
      });
      await ctx.send({
        type: 'text',
        to: ctx.from,
        body: `🎉 *This week's deal*\n\n${product.name} — ${percentOff}% off (${formatEuro(Number(product.salePriceEur))})!`
      });
    }

    // Lands on 'current_promo_landing' (armed) rather than ending the turn
    // here directly, for the exact reason _handleShopEntry lands on
    // 'shop_landing' (armed) instead of just returning - see that method's
    // own long comment for the full mechanics. Short version: ctx.goto()
    // alone doesn't end the engine turn, and hasConsumedInboundText is
    // already true this turn (the customer's "Current promo" tap was
    // consumed by the main menu list before reaching here), so goto'ing
    // straight to any prompt-rendering state would render/send it
    // immediately - reintroducing a second message, just a different one.
    // _handleCurrentPromoLanding below deliberately does not goto anywhere
    // on this armed pass, which combined with current_promo_landing having
    // no `next` in bot.json, is what actually stops the loop with only the
    // template (or its fallback) sent.
    ctx.set('currentPromoArmed', true);
    ctx.goto('current_promo_landing');
    return true;
  }

  // See the long comment in _handleSendCurrentPromo for why this needs the
  // 'currentPromoArmed' flag rather than just always redirecting - same
  // "runs twice per interaction" shape as _handleShopLanding (armed right
  // after the template, unarmed on the customer's actual next message).
  // Same opportunistic-routing behavior on the unarmed pass too: see
  // _handleShopLanding's own comment for why goto('welcome') here doesn't
  // guarantee a welcome re-render, and why that's correct, not a bug.
  _handleCurrentPromoLanding(ctx) {
    if (ctx.get('currentPromoArmed')) {
      ctx.set('currentPromoArmed', false);
      logger.info('AfroMarket: current_promo armed - ending turn silently after promo template');
      return true;
    }

    logger.info('AfroMarket: current_promo unarmed - handing off to main_route via welcome');
    ctx.goto('welcome');
    return true;
  }

  _handleRecipeAction(ctx) {
    const choice = String(ctx.get('recipeActionChoice') || '').trim();

    if (choice === 'buy_ingredients') {
      const recipeId = ctx.get('currentRecipeId');
      const recipeName = ctx.get('currentRecipeName');
      const ingredientIds = (this.botConfig.recipeIngredients || {})[recipeId] || [];
      const cart = ctx.get('cart') || [];

      const addedNames = [];
      for (const productId of ingredientIds) {
        const product = findProduct(this.botConfig, productId);
        if (!product) continue;
        addProductToCart(cart, product);
        addedNames.push(product.name);
      }
      ctx.set('cart', cart);

      if (addedNames.length) {
        ctx.set('recipeCartAddedText', `✅ Added ingredients for *${recipeName}* to your cart: ${addedNames.join(', ')}.\n\n`);
      } else {
        ctx.set('recipeCartAddedText', `⚠️ No shoppable ingredients found for *${recipeName}*.\n\n`);
      }
      ctx.goto('recipe_actions');
      return true;
    }

    if (choice === 'more_recipes') {
      ctx.goto('recipes_hub');
      return true;
    }

    if (choice === 'view_cart') {
      ctx.goto('cart_view');
      return true;
    }

    ctx.goto('welcome');
    return true;
  }

  // Checkout entry point: if we already have this customer's delivery
  // details from a previous paid order (upserted in AfroMarketBot's
  // _recordOrder), skip straight to the review screen pre-filled with them
  // instead of asking them to retype everything - "Start Over" on that
  // screen still routes to the plain checkout_name -> checkout_address ->
  // checkout_email sequence for anyone who wants to use different details
  // this time.
  async _handleCheckoutStart(ctx) {
    ctx.set('checkoutUsingSavedAddress', false);

    // ctx.phone (not ctx.from): from is a routing identifier that's a BSUID
    // for username adopters, not a phone number - see
    // afromarket-bsuid-codebase-readiness-agent-instructions.md. Blindly
    // "+"-prefixing ctx.from here used to fabricate a garbage phone-shaped
    // string (e.g. "+user.9373795779eb...") for a BSUID-only customer,
    // which would have been stored as their delivery/invoice phone number.
    const rawPhone = String(ctx.phone || '').trim();
    const phone = rawPhone ? (rawPhone.startsWith('+') ? rawPhone : `+${rawPhone}`) : '';
    ctx.set('checkoutPhone', phone);

    let profile = null;
    try {
      profile = await this.customerProfileStore.get({ botId: this.botConfig.botId, whatsappId: ctx.from });
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      // A saved-profile lookup failure must never block checkout - fall
      // through to the normal fresh-details flow below either way. Postgres
      // simply not being configured (local dev, tests) is expected and
      // routine, not worth a WARN on every single checkout attempt - only
      // genuine connection/query failures get logged at that level.
      if (message.includes('DATABASE_URL not set')) {
        logger.info('AfroMarket: Postgres not configured, skipping saved-address lookup');
      } else {
        logger.warn('AfroMarket: failed to load saved customer profile, falling back to fresh checkout details', {
          error: message
        });
      }
    }

    if (profile && profile.name && profile.delivery_address) {
      ctx.set('checkoutName', profile.name);
      ctx.set('checkoutAddress', profile.delivery_address);
      // Prefill from the saved profile's email (added alongside name/address -
      // see migrations/003_add_customer_profile_email.sql) rather than always
      // blanking it, so a repeat customer isn't asked for their email on
      // every single order once we actually have one on file.
      ctx.set('checkoutEmail', profile.email || '');
      ctx.set('checkoutUsingSavedAddress', true);
      ctx.goto('checkout_review');
      return true;
    }

    ctx.goto('checkout_name');
    return true;
  }

  // Runs once checkout_name -> checkout_address -> checkout_email have each
  // captured their own field via the engine's plain `input`-state saveAs
  // (see afromarket.bot.json) - replaced the old single "reply in one
  // message with Name:/Address:/Email: labels" parser (regex-matched those
  // exact labels; anything else silently failed to populate name/address and
  // just re-showed a "resend in this exact format" error - real customer
  // pain, confirmed from a live bug report). Asking one field at a time
  // structurally removes that failure class: whatever the customer types IS
  // the field, no format to violate.
  _handleFinishCheckoutDetails(ctx) {
    ctx.set('checkoutUsingSavedAddress', false);

    const rawEmail = String(ctx.get('checkoutEmailRaw') || '').trim();
    const email = /^skip$/i.test(rawEmail) ? '' : rawEmail;

    // ctx.phone, not ctx.from - see _handleCheckoutStart's comment above.
    const rawPhone = String(ctx.phone || '').trim();
    const phone = rawPhone ? (rawPhone.startsWith('+') ? rawPhone : `+${rawPhone}`) : '';

    ctx.set('checkoutEmail', email);
    ctx.set('checkoutPhone', phone);

    // No PII (no name/address/email/phone) - just enough to tell from the
    // logs alone whether the sequential name/address/email chain actually
    // completed for a given turn, and whether email was supplied or
    // skipped, without printing any of the fields themselves.
    logger.info('AfroMarket: checkout details finished, handing off to checkout_review', {
      emailProvided: Boolean(email)
    });

    ctx.goto('checkout_review');
    return true;
  }

  async _handleCheckout(ctx) {
    const cart = ctx.get('cart') || [];
    const name = ctx.get('checkoutName') || 'there';
    const address = ctx.get('checkoutAddress') || '';
    const phone = ctx.get('checkoutPhone') || '';
    const email = ctx.get('checkoutEmail') || '';

    if (!cart.length) {
      ctx.set(
        'orderConfirmationText',
        `⚠️ Your cart was empty, so there's nothing to check out yet.\n\nBrowse groceries and add a few items first!`
      );
      ctx.set('cart', []);
      ctx.set('checkoutIdempotencyKey', null);
      ctx.set('checkoutOrderNumber', null);
      ctx.goto('order_confirmed');
      return true;
    }

    const { gateway } = getPaymentService();
    const activeProviderName = getActivePaymentProvider();
    const activeProvider = gateway.getProvider(activeProviderName);
    const paymentsConfigured = Boolean(activeProvider && activeProvider.isConfigured());

    // Email is optional in the combined checkout_details message, but Stripe's
    // hosted checkout requires one - ask for it specifically only when it's actually
    // needed, rather than failing the whole payment with a generic error. PayPal's
    // Orders v2 checkout collects the payer's email itself, so this gate only
    // applies when Stripe is the active provider (flag can be switched back to
    // Stripe at any time - this must keep working when it is).
    if (paymentsConfigured && activeProviderName === 'stripe' && !email) {
      ctx.goto('checkout_email_required');
      return true;
    }

    // Distinguishes two very different situations that both look like
    // "!paymentsConfigured": local dev with zero payment env vars at all
    // (handled below - legacy instant confirmation, unchanged from before
    // payments existed) versus a real deploy where a payment provider IS
    // configured but happens not to be the one AFROMARKET_PAYMENT_PROVIDER
    // currently selects (e.g. Stripe configured, flag unset/misconfigured,
    // defaults to paypal, paypal not yet provisioned). The second case must
    // never silently fall through to unpaid instant confirmation - that
    // would give away every order for free the moment this flag exists in
    // an environment nobody has explicitly set it for yet.
    const stripeProvider = gateway.getProvider('stripe');
    const paypalProvider = gateway.getProvider('paypal');
    const anyAfroMarketProviderConfigured = Boolean(
      (stripeProvider && stripeProvider.isConfigured()) || (paypalProvider && paypalProvider.isConfigured())
    );
    if (!paymentsConfigured && anyAfroMarketProviderConfigured) {
      logger.error(
        `AfroMarket: AFROMARKET_PAYMENT_PROVIDER="${activeProviderName}" has no configured credentials, but another ` +
          'payment provider IS configured in this environment - refusing to confirm an unpaid order. ' +
          'Set AFROMARKET_PAYMENT_PROVIDER to the provider that is actually configured.'
      );
      await ctx.send({
        type: 'text',
        to: ctx.from,
        body: `⚠️ Payment is temporarily unavailable. Please try again shortly, or contact us if this persists.`
      });
      ctx.goto('checkout_review');
      return true;
    }

    // No payment provider configured at all (e.g. local dev without any
    // payment env vars) - legacy instant confirmation, unchanged from before
    // payments existed.
    if (!paymentsConfigured) {
      const orderNumber = ctx.get('checkoutOrderNumber') || generateOrderNumber();
      const cartSnapshot = cart.map((line) => ({ ...line }));
      ctx.set('cart', []);
      ctx.set('checkoutIdempotencyKey', null);
      ctx.set('checkoutOrderNumber', null);
      ctx.set('orderConfirmationText', buildOrderConfirmationText({ orderNumber, cart: cartSnapshot, name, address, phone }));
      ctx.goto('order_confirmed');
      return true;
    }

    const orderNumber = ctx.get('checkoutOrderNumber') || generateOrderNumber();
    const idempotencyKey = ctx.get('checkoutIdempotencyKey');
    const cartSnapshot = cart.map((line) => ({ ...line }));
    const grandTotal = cartSnapshot.reduce((sum, line) => sum + line.unitPrice * line.qty, 0);

    try {
      const payment = await gateway.initiatePayment({
        botId: 'afromarket',
        amount: grandTotal,
        currency: this.botConfig.currency || 'EUR',
        phoneNumber: ctx.from,
        reference: orderNumber,
        description: `AfroMarket order ${orderNumber}`,
        preferredProvider: activeProviderName,
        customerEmail: email,
        customerName: name,
        idempotencyKey,
        metadata: { service: 'afromarket_order', orderNumber, cart: cartSnapshot, name, address, phone, email }
      });

      if (!payment.checkoutUrl) {
        throw new Error('Stripe initiatePayment returned no checkoutUrl');
      }

      // Only clear the cart once a real payment session actually exists - a
      // failed initiatePayment call above must never drop the customer's cart.
      ctx.set('cart', []);
      ctx.set('checkoutIdempotencyKey', null);
      ctx.set('checkoutOrderNumber', null);

      const payText =
        `📝 Order *${orderNumber}* is ready — *${formatEuro(grandTotal)}*.\n\n` +
        `Tap below to pay securely. We'll confirm right here as soon as your payment goes through.`;
      ctx.set('orderConfirmationText', payText);

      try {
        await ctx.send({
          type: 'cta_url',
          to: ctx.from,
          body: `💳 Pay for order ${orderNumber}`,
          buttonText: 'Pay Now',
          url: payment.checkoutUrl
        });
      } catch (sendErr) {
        // The payment session already exists - losing the rich message must not
        // lose the link itself, so fall back to a plain-text URL the customer
        // still receives via the state's own outbound message.
        logger.warn('AfroMarket: failed to send payment link message, including link in fallback text', {
          error: sendErr && sendErr.message ? sendErr.message : String(sendErr)
        });
        ctx.set('orderConfirmationText', `${payText}\n\n💳 Pay here: ${payment.checkoutUrl}`);
      }

      ctx.goto('order_confirmed');
      return true;
    } catch (err) {
      // A real payment provider is configured but initiation failed (bad email,
      // outage, network error, ...) - never confirm an unpaid order as if it
      // were paid. Keep the cart intact and let the customer retry. The
      // idempotency key/order number are deliberately NOT cleared here - no
      // payment record was ever stored for this attempt (initiatePayment
      // threw before reaching that point), so retrying reuses the same key/
      // order number for what is still logically the same in-flight attempt.
      logger.warn(`AfroMarket: ${activeProviderName} initiatePayment failed`, {
        error: err && err.message ? err.message : String(err)
      });
      await ctx.send({
        type: 'text',
        to: ctx.from,
        body:
          `⚠️ We couldn't start the payment for this order. Nothing has been charged and your cart is safe.\n\n` +
          (activeProviderName === 'stripe'
            ? `Please check your email address and tap *Confirm Order* to try again.`
            : `Please tap *Confirm Order* to try again.`)
      });
      ctx.goto('checkout_review');
      return true;
    }
  }
}

module.exports = {
  AfroMarketFlowPlugin,
  formatEuro,
  buildCartSummaryText,
  generateOrderNumber,
  buildOrderConfirmationText,
  findProduct,
  findCurrentPromoProduct,
  computePercentOff,
  isNativeCatalogEnabled,
  buildNativeCatalogSections,
  getActivePaymentProvider
};
