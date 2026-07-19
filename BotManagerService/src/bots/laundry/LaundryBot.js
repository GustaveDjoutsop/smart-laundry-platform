const { ConfigBot } = require('../base/ConfigBot');
const { LaundryFlowPlugin } = require('./laundryFlowPlugin');

class LaundryBot extends ConfigBot {
  constructor(config) {
    super(config, { plugin: new LaundryFlowPlugin({ botConfig: config }) });
  }
}

module.exports = { LaundryBot };
