const Mustache = require('mustache');

// WhatsApp messages are plain text; Mustache's default HTML escaping
// produces artifacts like "&#x2F;" in the chat UI.
Mustache.escape = (value) => String(value);

function renderTemplate(template, context) {
  if (!template) return '';
  return Mustache.render(String(template), context || {});
}

module.exports = { renderTemplate };
