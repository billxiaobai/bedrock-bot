const bedrock = require('bedrock-protocol');
const { EventEmitter } = require('events');
const moment = require('moment-timezone');
const fs = require('fs');

const Logger = require('./Logger');
const ConfigManager = require('./ConfigManager');
const AutoReconnect = require('./components/AutoReconnect');
const Advertisement = require('./components/Advertisement');
const Teleport = require('./components/Teleport');

class BedrockBot extends EventEmitter {
    constructor(configPath = './config.json') {
        super();

        this.configPath = configPath;
        this.config = null;
        this.logger = null;
        this.client = null;
        this.isConnected = false;
        this.hasEmittedDisconnect = false;
        this.components = new Map();
        this.initializationFailed = false;
        this.initialize();
    }

    initialize() {
        try {
            this.config = new ConfigManager(this.configPath);

            this.logger = Logger

            this.config.addWatcher(this.handleConfigChange.bind(this));

            this.logger.info('BedrockBot initialized successfully');
        } catch (error) {
            this.logger = Logger;
            const isMissingRequired = error && error.message && error.message.includes('Missing required configuration sections');
            if (isMissingRequired) {
                this.logger.warn(`Configuration incomplete: ${error.message}`);
                try {
                    const raw = fs.readFileSync(this.configPath, 'utf8');
                    const parsed = JSON.parse(raw);
                    this.config = {
                        get: (key) => parsed[key],
                        addWatcher: (fn) => { },
                        isFeatureEnabled: (name) => {
                            const features = parsed.features || parsed.components || {};
                            return !!features[name];
                        }
                    };

                    this.logger.info('Loaded configuration from config.json fallback (logger uses built-in settings)');
                    return;
                } catch (readErr) {
                    this.logger.error(`Failed to read/parse config.json: ${readErr.message}`);
                    this.logger.error('Initialization failed — start aborted. Fix config.json and restart the process.');
                    this.initializationFailed = true;
                    return;
                }
            }

            console.error('Failed to initialize bot:', error.message);
            this.logger.error(`Failed to initialize bot: ${error.message}`);
            this.initializationFailed = true;
            return;
        }
    }

    handleConfigChange(event, data) {
        if (event === 'config_reloaded') {
            this.logger.info('Configuration reloaded');
            this.updateComponents();
        } else if (event === 'config_error') {
            this.logger.error(`Configuration error: ${data.message}`);
        }
    }

    async start() {
        if (this.initializationFailed) {
            this.logger.error('Cannot start Bedrock Bot because initialization failed. Check previous errors.');
            return;
        }

        try {
            this.logger.info('Starting Bedrock Bot...');

            await this.initializeComponents();

            await this.connect();
        } catch (error) {
            this.logger.error(`Failed to start bot: ${error.message}`);
            
            const autoReconnect = this.getComponent('autoReconnect');
            if (autoReconnect) {
                this.logger.info('Initial connection failed, but AutoReconnect will handle retries');
                return;
            }
            
            throw error;
        }
    }

    async connect() {
        try {
            this.hasEmittedDisconnect = false;
            const botConfig = this.config.get('bot');

            this.logger.info(`Connecting to ${botConfig.host}:${botConfig.port} as ${botConfig.username}`);

            const clientOptions = {
                host: botConfig.host,
                port: botConfig.port,
                username: botConfig.username,
                offline: botConfig.offline,
                version: botConfig.version || '1.21.100',
                connectTimeout: 30000,
            };

            this.client = bedrock.createClient(clientOptions);
            this.logger.info(`Connecting to ${this.client.options.host}:${this.client.options.port}, version ${this.client.options.version})`);
            this.setupEventHandlers();

            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    if (!this.isConnected) {
                        const error = new Error('Connect timed out');
                        this.handleError(error);
                        reject(error);
                    }
                }, clientOptions.connectTimeout);

                const onSpawn = () => {
                    clearTimeout(timeout);
                    this.client.removeListener('error', onError);
                    resolve();
                };

                const onError = (error) => {
                    clearTimeout(timeout);
                    this.client.removeListener('spawn', onSpawn);
                    this.handleError(error);
                    reject(error);
                };

                this.client.once('spawn', onSpawn);
                this.client.once('error', onError);
            });

        } catch (error) {
            this.logger.error(`Connection failed: ${error.message}`);
            throw error;
        }
    }

    setupEventHandlers() {
        if (!this.client) return;
        this.client.on('spawn', this.handleSpawn.bind(this));
        this.client.on('disconnect', this.handleDisconnect.bind(this));
        this.client.on('end', this.handleEnd.bind(this));
        this.client.on('error', this.handleError.bind(this));
        this.client.on('kick', this.handleKick.bind(this));
        this.client.on('text', this.handleTextMessage.bind(this));
    }

    async handleSpawn(packet) {
        this.isConnected = true;
        this.hasEmittedDisconnect = false;
        this.logger.info('Bot successfully spawned in the world');

        const welcomeMessage = `[${moment().tz('Asia/Taipei').format('HH:mm:ss')}] XIBOT 已上線！`;
        await this.chat(welcomeMessage);

        await this.reinitializeComponents();

        this.emit('spawn', packet);
    }

    handleDisconnect(packet) {
        this.isConnected = false;
        this.hasEmittedDisconnect = true;
        const reason = packet?.reason || 'Unknown reason';
        this.logger.warn(`Bot disconnected: ${reason}`);

        this.emit('disconnect', reason);
    }

    handleEnd(packet) {
        this.isConnected = false;
        this.hasEmittedDisconnect = true;
        const reason = packet?.reason || 'Connection ended';
        this.logger.warn(`Bot connection ended: ${reason}`);

        this.emit('end', reason);
    }

    handleError(error) {
        this.logger.error(`Bot error: ${error.message}`);
        this.emit('error', error);
        
        if (!this.isConnected && !this.hasEmittedDisconnect && (
            error.message.includes('Connect timed out') ||
            error.message.includes('ETIMEDOUT') ||
            error.message.includes('ECONNREFUSED') ||
            error.message.includes('Connection failed')
        )) {
            this.logger.info('Initial connection error detected, triggering AutoReconnect');
            this.hasEmittedDisconnect = true;
            this.emit('disconnect', `Connection error: ${error.message}`);
        }
    }

    handleKick(packet) {
        this.isConnected = false;
        const reason = packet?.reason || 'Unknown reason';
        this.logger.warn(`Bot was kicked: ${reason}`);

        this.emit('kick', reason);
        this.emit('disconnect', `Kicked: ${reason}`);
    }

    handleTextMessage(packet) {
        if (!packet || !packet.message) return;

        const message = this.minecraftToAnsi(packet.message);
        this.logger.info(`[CHAT] ${message}`);
        
        this.emit('message', { text: message, packet });
    }

    async initializeComponents() {
        try {
            this.logger.info('Initializing bot components...');

            const components = [
                new AutoReconnect(this, this.config, this.logger),
                new Advertisement(this, this.config, this.logger),
                new Teleport(this, this.config, this.logger)
            ];

            for (const component of components) {
                try {
                    await component.initialize();
                    this.components.set(component.name, component);

                    component.on('reconnectAttempt', async (attempt) => {
                        this.emit('reconnectAttempt', attempt);
                        try {
                            await this.performReconnect();
                        } catch (error) {
                            this.logger.error(`Reconnect attempt ${attempt} failed: ${error.message}`);
                            if (component.name === 'autoReconnect') {
                                component.isReconnecting = false;
                            }
                        }
                    });

                } catch (error) {
                    this.logger.error(`Failed to initialize ${component.name}: ${error.message}`);
                }
            }

            this.logger.info(`Initialized ${this.components.size} components`);

        } catch (error) {
            this.logger.error(`Component initialization failed: ${error.message}`);
        }
    }

    async reinitializeComponents() {
        try {
            if (!this.components.has('autoReconnect')) {
                await this.initializeComponents();
                return;
            }

            this.logger.info('Reinitializing non-AutoReconnect components...');

            const components = [
                new Advertisement(this, this.config, this.logger),
                new Teleport(this, this.config, this.logger)
            ];

            for (const component of components) {
                try {
                    await component.initialize();
                    this.components.set(component.name, component);
                } catch (error) {
                    this.logger.error(`Failed to reinitialize ${component.name}: ${error.message}`);
                }
            }

            this.logger.info(`Reinitialized ${components.length} components`);

        } catch (error) {
            this.logger.error(`Component reinitialization failed: ${error.message}`);
        }
    }

    updateComponents() {
        this.logger.debug('Updating components with new configuration');
    }

    async performReconnect() {
        try {
            this.logger.info('Attempting to reconnect...');

            this.cleanupComponentsExceptAutoReconnect();

            if (this.client) {
                try {
                    this.client.disconnect();
                } catch (error) {
                    this.logger.debug(`Error disconnecting client: ${error.message}`);
                }
                this.client = null;
            }

            this.isConnected = false;

            await new Promise(resolve => setTimeout(resolve, 1000));

            await this.connect();
            
            this.logger.info('Reconnection successful');
        } catch (error) {
            this.logger.error(`Reconnection failed: ${error.message}`);
            throw error;
        }
    }

    cleanupComponents() {
        this.components.forEach(component => {
            try {
                component.cleanup();
            } catch (error) {
                this.logger.error(`Error cleaning up ${component.name}: ${error.message}`);
            }
        });
    }

    cleanupComponentsExceptAutoReconnect() {
        this.components.forEach(component => {
            if (component.name !== 'autoReconnect') {
                try {
                    component.cleanup();
                } catch (error) {
                    this.logger.error(`Error cleaning up ${component.name}: ${error.message}`);
                }
            }
        });
    }

    async chat(message) {
        if (!this.client || !this.isConnected) {
            throw new Error('Bot is not connected');
        }

        try {

            this.client.queue('text', {
                type: 'chat',
                needs_translation: false,
                source_name: this.client.username,
                xuid: '',
                platform_chat_id: '',
                filtered_message: '',
                message: message
            });
        } catch (error) {
            this.logger.error(`Failed to send chat message: ${error.message}`);
            throw error;
        }
    }

    getStatus() {
        return {
            connected: this.isConnected,
            components: Array.from(this.components.keys()),
            uptime: this.getUptime()
        };
    }

    getUptime() {
        return this.startTime ? Date.now() - this.startTime : 0;
    }

    getComponent(name) {
        return this.components.get(name) || null;
    }

    async disconnect() {
        this.logger.info('Disconnecting bot...');

        this.cleanupComponents();

        if (this.client) {
            this.client.disconnect();
            this.client = null;
        }

        this.isConnected = false;
        this.logger.info('Bot disconnected');
    }

    async stop() {
        await this.disconnect();
        this.logger.info('Bot stopped');
    }

    minecraftToAnsi(message) {
        const colorMap = {
            '0': '\x1b[30m',
            '1': '\x1b[34m',
            '2': '\x1b[32m',
            '3': '\x1b[36m',
            '4': '\x1b[31m',
            '5': '\x1b[35m',
            '6': '\x1b[33m',
            '7': '\x1b[37m',
            '8': '\x1b[90m',
            '9': '\x1b[94m',
            'a': '\x1b[92m',
            'b': '\x1b[96m',
            'c': '\x1b[91m',
            'd': '\x1b[95m',
            'e': '\x1b[93m',
            'f': '\x1b[97m',
            'r': '\x1b[0m',
        };

        const formattingMap = {
            'l': '\x1b[1m',
            'm': '\x1b[9m',
            'n': '\x1b[4m',
            'o': '\x1b[3m',
        };

        return message.replace(/§([0-9a-frlmno])/gi, (match, code) => {
            if (colorMap[code.toLowerCase()]) {
                return colorMap[code.toLowerCase()];
            } else if (formattingMap[code.toLowerCase()]) {
                return formattingMap[code.toLowerCase()];
            }
            return '';
        }) + '\x1b[0m';
    }
}

module.exports = BedrockBot;