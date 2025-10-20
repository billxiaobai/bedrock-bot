const { EventEmitter } = require('events');

class BotComponent extends EventEmitter {
    constructor(name, bot, config, logger) {
        super();
        this.name = name;
        this.bot = bot;
        this.config = config;
        this.logger = logger;
        this.enabled = false;
        this.intervals = [];
        this.timeouts = [];
    }

    cleanup() {
        this.clearIntervals();
        this.clearTimeouts();
        this.removeAllListeners();
    }

    createInterval(callback, interval) {
        const id = setInterval(callback, interval);
        this.intervals.push(id);
        return id;
    }

    createTimeout(callback, delay) {
        const id = setTimeout(callback, delay);
        this.timeouts.push(id);
        return id;
    }

    clearIntervals() {
        this.intervals.forEach(id => clearInterval(id));
        this.intervals = [];
    }

    clearTimeouts() {
        this.timeouts.forEach(id => clearTimeout(id));
        this.timeouts = [];
    }

    async disable() {
        if (this.enabled) {
            this.enabled = false;
            await this.onDisable();
            this.cleanup();
            this.logger.info(`${this.name} component disabled`);
        }
    }

    async enable() {
        if (!this.enabled) {
            this.enabled = true;
            await this.onEnable();
            this.logger.info(`${this.name} component enabled`);
        }
    }

    async initialize() {
        if (this.config && typeof this.config.isFeatureEnabled === 'function' && this.config.isFeatureEnabled(this.name)) {
            this.enabled = true;
            await this.onEnable();
            this.logger.info(`${this.name} component enabled`);
        } else {
            this.logger.debug(`${this.name} component disabled`);
        }
    }

    isEnabled() {
        return this.enabled;
    }
}
module.exports = BotComponent;