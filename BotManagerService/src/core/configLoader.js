const fs = require('fs');
const yaml = require('js-yaml');

function loadYamlFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return yaml.load(raw) || {};
}

function deepMerge(base, override) {
  if (Array.isArray(base) || Array.isArray(override)) {
    return override === undefined ? base : override;
  }

  if (typeof base !== 'object' || base === null) {
    return override === undefined ? base : override;
  }

  const result = { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    result[key] = key in result ? deepMerge(result[key], value) : value;
  }
  return result;
}

function loadEnvironmentConfig({ configDir, envName }) {
  const base = loadYamlFile(`${configDir}/environments/values.yml`);
  const env = loadYamlFile(`${configDir}/environments/${envName}.yml`);
  return deepMerge(base, env);
}

function substituteEnvPlaceholders(value) {
  if (typeof value === 'string') {
    // Replace ${VAR_NAME} with process.env.VAR_NAME when set; otherwise keep
    // the literal so existing configs keep behaving as before.
    return value.replace(/\$\{([A-Z0-9_]+)\}/g, (match, envVarName) => {
      const envValue = process.env[envVarName];
      return envValue !== undefined && envValue !== '' ? envValue : match;
    });
  }

  if (Array.isArray(value)) {
    return value.map((item) => substituteEnvPlaceholders(item));
  }

  if (value && typeof value === 'object') {
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = substituteEnvPlaceholders(item);
    }
    return result;
  }

  return value;
}

function loadBotConfig(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return substituteEnvPlaceholders(JSON.parse(raw));
}

module.exports = { loadEnvironmentConfig, loadBotConfig, substituteEnvPlaceholders };
