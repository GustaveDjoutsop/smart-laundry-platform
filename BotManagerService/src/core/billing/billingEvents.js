const { EventEmitter } = require('node:events');

const billingEvents = new EventEmitter();

module.exports = { billingEvents };
