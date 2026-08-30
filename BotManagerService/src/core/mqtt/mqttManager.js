const mqtt = require('mqtt');
const { EventEmitter } = require('node:events');
const { logger } = require('../../utils/logger');

class MqttManager extends EventEmitter {
  constructor({ url, username, password, clientId } = {}) {
    super();
    this.url = url;
    this.username = username;
    this.password = password;
    this.clientId = clientId || `botmanagerservice_${Math.random().toString(16).slice(2)}`;

    this.client = null;
    this.connected = false;
  }

  async init() {
    if (!this.url) {
      logger.warn('MQTT_URL not set: MQTT disabled');
      return;
    }

    this.client = mqtt.connect(this.url, {
      username: this.username || undefined,
      password: this.password || undefined,
      clientId: this.clientId,
      reconnectPeriod: 2000,
      connectTimeout: 10_000
    });

    this.client.on('connect', () => {
      this.connected = true;
      logger.info('MQTT connected');
      this.emit('connected');
    });

    this.client.on('reconnect', () => {
      logger.warn('MQTT reconnecting');
    });

    this.client.on('close', () => {
      this.connected = false;
      logger.warn('MQTT connection closed');
      this.emit('disconnected');
    });

    this.client.on('error', (err) => {
      this.connected = false;
      logger.warn('MQTT error', err && err.message ? err.message : String(err));
    });

    this.client.on('message', (topic, payload) => {
      this.emit('message', topic, payload);
    });
  }

  async publish(topic, payload, options) {
    if (!this.client || !this.connected) {
      logger.warn('MQTT not connected: dropping publish');
      return false;
    }

    const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload));

    return new Promise((resolve) => {
      this.client.publish(topic, buf, options || {}, (err) => {
        if (err) {
          logger.warn('MQTT publish failed', err && err.message ? err.message : String(err));
          resolve(false);
        } else {
          resolve(true);
        }
      });
    });
  }

  async subscribe(topic) {
    if (!this.client) return false;

    return new Promise((resolve) => {
      this.client.subscribe(topic, (err) => {
        if (err) {
          logger.warn('MQTT subscribe failed', err && err.message ? err.message : String(err));
          resolve(false);
        } else {
          resolve(true);
        }
      });
    });
  }

  // Used on process shutdown - ends the connection without the client's own
  // reconnectPeriod immediately reopening it. Resolves once mqtt.js confirms
  // the close (or immediately if never connected), so callers can await it
  // as part of an ordered graceful-shutdown sequence.
  async disconnect() {
    if (!this.client) return;

    await new Promise((resolve) => this.client.end(false, {}, resolve));
    this.connected = false;
  }
}

module.exports = { MqttManager };
