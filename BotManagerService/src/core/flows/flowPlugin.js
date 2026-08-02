class FlowPlugin {
  // Optional hooks
  async beforeHandleMessage(_ctx) {}

  async beforeState(_ctx) {}

  async afterState(_ctx) {}

  async beforeTransition(_ctx, _transition) {}

  // Optional custom actions
  // Return true if handled.
  async handleAction(_ctx, _action) {
    return false;
  }
}

module.exports = { FlowPlugin };
