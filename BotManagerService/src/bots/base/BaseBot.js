class BaseBot {
  constructor(config) {
    this.config = config;
  }

  async handleMessage(_ctx) {
    throw new Error('Not implemented');
  }
}

module.exports = { BaseBot };
