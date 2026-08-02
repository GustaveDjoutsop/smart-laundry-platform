const crypto = require('crypto');
const { FlowPlugin } = require('../../core/flows/flowPlugin');
const { getPaymentService } = require('../../core/payments/paymentService');
const { logger } = require('../../utils/logger');

function formatEuro(amount) {
  const value = Number(amount) || 0;
  return `€${value.toFixed(2)}`;
}

function findProduct(botConfig, productId) {
  const products = Array.isArray(botConfig.products) ? botConfig.products : [];
  return products.find((p) => p && p.id === productId) || null;
}

function addProductToCart(cart, product) {
  const existing = cart.find((line) => line.productId === product.id);
  if (existing) {
    existing.qty += 1;
    return;
  }
  cart.push({
    productId: product.id,
    name: product.name,
    unitPrice: Number(product.priceEur) || 0,
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

function estimatedDeliveryDate() {
  const deliveryDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
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
    `Estimated delivery: ${estimatedDeliveryDate()}.\n\n` +
    `We will let you know when your order ships.`
  );
}

// AfroMarketFlowPlugin adds the two pieces of behavior that a pure JSON config
// cannot express: a stateful shopping cart (with per-line totals) and order
// checkout. Everything else (menus, recipes, product photos, static info
// cards) stays plain configuration in afromarket.bot.json.
class AfroMarketFlowPlugin extends FlowPlugin {
  constructor({ botConfig } = {}) {
    super();
    this.botConfig = botConfig;
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
    if (action === 'products.route') {
      return this._handleProductAction(ctx);
    }

    if (action === 'recipes.route') {
      return this._handleRecipeAction(ctx);
    }

    if (action === 'cart.checkout') {
      return this._handleCheckout(ctx);
    }

    if (action === 'checkout.parseDetails') {
      return this._handleParseCheckoutDetails(ctx);
    }

    return false;
  }

  _handleProductAction(ctx) {
    const choice = String(ctx.get('productActionChoice') || '').trim();
    const cart = ctx.get('cart') || [];

    if (choice === 'cart_add') {
      const product = findProduct(this.botConfig, ctx.get('currentProductId'));
      if (product) {
        addProductToCart(cart, product);
        ctx.set('cart', cart);
        ctx.set('cartAddedText', `✅ Added *${product.name}* (${formatEuro(product.priceEur)}) to your cart!\n\n`);
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
      ctx.goto('region_menu');
      return true;
    }

    if (choice === 'view_cart') {
      ctx.goto('cart_view');
      return true;
    }

    ctx.goto('welcome');
    return true;
  }

  _handleParseCheckoutDetails(ctx) {
    ctx.set('checkoutDetailsError', '');

    const raw = String(ctx.get('checkoutDetailsRaw') || '');
    const fields = { name: '', address: '', email: '' };
    let lastField = null;

    for (const line of raw.split(/\r?\n/)) {
      const trimmedLine = line.trim();
      const match = trimmedLine.match(/^(name|address|email)\s*:\s*(.+)$/i);
      if (match) {
        const field = match[1].toLowerCase();
        fields[field] = match[2].trim();
        lastField = field;
        continue;
      }
      // A line with no "Field:" prefix is a wrapped continuation of whichever
      // field came last (e.g. a multi-line address) - not a new, unrelated line
      // to silently drop.
      if (trimmedLine && lastField) {
        fields[lastField] = `${fields[lastField]} ${trimmedLine}`.trim();
      }
    }

    const { name, address, email } = fields;

    if (!name || !address) {
      ctx.set(
        'checkoutDetailsError',
        `⚠️ I couldn't find both a name and an address in that message. Please resend using the exact format below:\n\n`
      );
      ctx.goto('checkout_details');
      return true;
    }

    const fromDigits = String(ctx.from || '').trim();
    const phone = fromDigits ? (fromDigits.startsWith('+') ? fromDigits : `+${fromDigits}`) : '';

    ctx.set('checkoutName', name);
    ctx.set('checkoutAddress', address);
    ctx.set('checkoutEmail', email);
    ctx.set('checkoutPhone', phone);
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
    const stripe = gateway.getProvider('stripe');
    const paymentsConfigured = Boolean(stripe && stripe.isConfigured());

    // Email is optional in the combined checkout_details message, but Stripe's
    // hosted checkout requires one - ask for it specifically only when it's actually
    // needed, rather than failing the whole payment with a generic error.
    if (paymentsConfigured && !email) {
      ctx.goto('checkout_email_required');
      return true;
    }

    // No payment provider configured at all (e.g. local dev without STRIPE_SECRET_KEY) -
    // legacy instant confirmation, unchanged from before payments existed.
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
        preferredProvider: 'stripe',
        customerEmail: email,
        customerName: name,
        idempotencyKey,
        metadata: { service: 'afromarket_order', orderNumber, cart: cartSnapshot, name, address, phone }
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
      logger.warn('AfroMarket: Stripe initiatePayment failed', {
        error: err && err.message ? err.message : String(err)
      });
      await ctx.send({
        type: 'text',
        to: ctx.from,
        body:
          `⚠️ We couldn't start the payment for this order. Nothing has been charged and your cart is safe.\n\n` +
          `Please check your email address and tap *Confirm Order* to try again.`
      });
      ctx.goto('checkout_review');
      return true;
    }
  }
}

module.exports = { AfroMarketFlowPlugin, formatEuro, buildCartSummaryText, generateOrderNumber, buildOrderConfirmationText };
