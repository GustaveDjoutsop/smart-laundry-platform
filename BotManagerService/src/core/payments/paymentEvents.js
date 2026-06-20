const { EventEmitter } = require('node:events');

const paymentEvents = new EventEmitter();

module.exports = { paymentEvents };
