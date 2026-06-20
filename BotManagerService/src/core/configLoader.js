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

function loadBotConfig(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

module.exports = { loadEnvironmentConfig, loadBotConfig };
