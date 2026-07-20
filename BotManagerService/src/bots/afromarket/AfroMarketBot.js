const { ConfigBot } = require('../base/ConfigBot');
const { AfroMarketFlowPlugin } = require('./afromarketFlowPlugin');

class AfroMarketBot extends ConfigBot {
  constructor(config) {
    super(config, { plugin: new AfroMarketFlowPlugin({ botConfig: config }) });
  }
}

module.exports = { AfroMarketBot };
