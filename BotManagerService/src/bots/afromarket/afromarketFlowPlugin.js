const { FlowPlugin } = require('../../core/flows/flowPlugin');

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

    if (stateDefinition.id === 'cart_view' || stateDefinition.id === 'checkout_review') {
      const cart = ctx.get('cart') || [];
      ctx.set('cartSummaryText', buildCartSummaryText(cart));
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

    ctx.goto('welcome');
    return true;
  }

  _handleCheckout(ctx) {
    const cart = ctx.get('cart') || [];
    const name = ctx.get('checkoutName') || 'there';
    const address = ctx.get('checkoutAddress') || '';
    const phone = ctx.get('checkoutPhone') || '';

    if (!cart.length) {
      ctx.set(
        'orderConfirmationText',
        `⚠️ Your cart was empty, so there's nothing to check out yet.\n\nBrowse groceries and add a few items first!`
      );
      ctx.set('cart', []);
      ctx.goto('order_confirmed');
      return true;
    }

    const orderNumber = generateOrderNumber();
    const grandTotal = cart.reduce((sum, line) => sum + line.unitPrice * line.qty, 0);
    const itemLines = cart.map((line) => `• ${line.qty}x ${line.name}`).join('\n');

    ctx.set(
      'orderConfirmationText',
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
    ctx.set('cart', []);
    ctx.goto('order_confirmed');
    return true;
  }
}

module.exports = { AfroMarketFlowPlugin, formatEuro, buildCartSummaryText, generateOrderNumber };
