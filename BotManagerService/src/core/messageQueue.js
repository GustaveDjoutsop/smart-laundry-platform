const { getAppConfig } = require('./appConfig');
const { QueueManager } = require('./queueManager');

const config = getAppConfig();
const queueManager = new QueueManager({ maxSize: config.queue.maxSize });

module.exports = { queueManager };