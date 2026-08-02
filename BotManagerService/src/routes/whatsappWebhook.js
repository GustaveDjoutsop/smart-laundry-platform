const express = require('express');

const { whatsappHandler } = require('../handlers/whatsappHandler');

function whatsappRouter() {
  const router = express.Router();

  router.get('/', whatsappHandler.verify);
  router.post('/', whatsappHandler.receive);

  return router;
}

module.exports = { whatsappRouter };
