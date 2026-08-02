function redactString(input) {
  if (!input) return input;
  let str = String(input);

  // Bearer tokens
  str = str.replace(/\bBearer\s+[^\s]+/gi, 'Bearer [REDACTED]');

  // Generic KEY=VALUE secrets
  str = str.replace(/\b([A-Z0-9_]*(TOKEN|SECRET|PASSWORD|KEY))\b=([^\s]+)/gi, '$1=[REDACTED]');

  // WhatsApp / Meta tokens often start with "EA" and are long
  str = str.replace(/\bEA[A-Za-z0-9]{20,}\b/g, '[REDACTED_TOKEN]');

  // E.164-ish phone numbers
  str = str.replace(/\+\d{7,15}\b/g, '[REDACTED_PHONE]');

  // Cameroon local pattern kept for backward compat
  str = str.replace(/\b\+?237\d{8,9}\b/g, '[REDACTED_PHONE]');

  return str;
}

function redact(value) {
  if (value === undefined || value === null) return value;
  if (typeof value === 'string') return redactString(value);

  try {
    return redactString(JSON.stringify(value));
  } catch (_err) {
    return redactString(String(value));
  }
}

module.exports = { redact, redactString };
