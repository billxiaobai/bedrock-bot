const bedrock = require('bedrock-protocol');
const { EventEmitter } = require('events');
const moment = require('moment-timezone');
const fs = require('fs');

const Logger = require('./Logger');
const ConfigManager = require('./ConfigManager');
const AutoReconnect = require('./components/AutoReconnect');
const Advertisement = require('./components/Advertisement');
const Teleport = require('./components/Teleport');
const AutochangeIP = require('./components/AutochangeIP');

class BedrockBot extends EventEmitter {
	constructor(configInput = './config.json') {
		super();

		this.configPath = null;
		this.config = null;
		this._rawConfigInput = configInput;

		this.logger = Logger;
		this.client = null;
		this.isConnected = false;
		this.hasEmittedDisconnect = false;
		this.components = new Map();
		this.initializationFailed = false;
		this.ipModule = null;
		try {
			const cfgType = typeof configInput === 'string' ? `path:${configInput}` : 'object';
			this.logger.info(`BedrockBot constructor called (config=${cfgType}, pid=${process.pid})`);
		} catch (e) { /* ignore logger errors */ }

		this.initialize();
	}

	initialize() {
		try {
			if (this._rawConfigInput && typeof this._rawConfigInput === 'object') {
				const parsed = this._rawConfigInput;
				const getNested = (obj, path, def) => {
					if (!path) return def === undefined ? obj : def;
					const parts = path.split('.');
					let cur = obj;
					for (const p of parts) {
						if (cur && Object.prototype.hasOwnProperty.call(cur, p)) {
							cur = cur[p];
						} else {
							return def;
						}
					}
					return cur === undefined ? def : cur;
				};

				this.config = {
					get: (key, def) => getNested(parsed, key, def),
					addWatcher: (fn) => { /* no-op */ },
					isFeatureEnabled: (name) => {
						const features = getNested(parsed, 'features') || getNested(parsed, 'components') || {};
						return !!features[name];
					}
				};
				this.logger = Logger;
				try {
					if (AutochangeIP && typeof AutochangeIP.getCurrentHost === 'function') {
						this.ipModule = AutochangeIP;
					} else if (AutochangeIP && AutochangeIP.default && typeof AutochangeIP.default.getCurrentHost === 'function') {
						this.ipModule = AutochangeIP.default;
					} else if (AutochangeIP && typeof AutochangeIP.getInstance === 'function') {
						this.ipModule = AutochangeIP.getInstance();
					} else {
						this.logger.warn('AutochangeIP module not exposing expected interface; falling back to config host/port');
						this.ipModule = null;
					}
				} catch (e) {
					this.logger.warn('Failed to initialize AutochangeIP module for config object, will use config host/port');
					this.ipModule = null;
				}

				this.logger.info('BedrockBot initialized with config object');
				return;
			}
			this.configPath = typeof this._rawConfigInput === 'string' ? this._rawConfigInput : './config.json';
			this.config = new ConfigManager(this.configPath);
			this.logger = Logger;
			this.config.addWatcher(this.handleConfigChange.bind(this));

			try {
				if (AutochangeIP && typeof AutochangeIP.getCurrentHost === 'function') {
					this.ipModule = AutochangeIP;
				} else if (AutochangeIP && AutochangeIP.default && typeof AutochangeIP.default.getCurrentHost === 'function') {
					this.ipModule = AutochangeIP.default;
				} else if (AutochangeIP && typeof AutochangeIP.getInstance === 'function') {
					this.ipModule = AutochangeIP.getInstance();
				} else {
					this.logger.warn('AutochangeIP module not exposing expected interface; falling back to config host/port');
					this.ipModule = null;
				}
			} catch (e) {
				this.logger.warn('Failed to initialize AutochangeIP module, will use config host/port');
				this.ipModule = null;
			}

			this.logger.info('BedrockBot initialized successfully');
			try {
				const username = (this.config && typeof this.config.get === 'function') ? this.config.get('bot.username') : undefined;
				this.logger.info(`BedrockBot initialized (username=${username || 'unknown'})`);
			} catch (e) {}
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
						addWatcher: (fn) => { /* no-op */ },
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
			const botConfig = (this.config && typeof this.config.get === 'function' && this.config.get('bot')) || {};

			const host = (this.ipModule && typeof this.ipModule.getCurrentHost === 'function')
				? this.ipModule.getCurrentHost()
				: (botConfig.host || 'bedrock.mcfallout.net');

			const port = (this.ipModule && typeof this.ipModule.getCurrentPort === 'function')
				? this.ipModule.getCurrentPort()
				: (botConfig.port || 19132);

			this.logger.info(`Connecting to ${host}:${port} as ${botConfig.username || 'unknown'}`);

			const clientOptions = {
				host,
				port,
				username: botConfig.username,
				offline: botConfig.offline,
				version: botConfig.version || '1.21.100',
				connectTimeout: 30000,
			};

			this.client = bedrock.createClient(clientOptions);
			this.logger.info(`Connecting to ${this.client.options.host}:${this.client.options.port}, version ${this.client.options.version})`);
			this.setupEventHandlers();
			const clientRef = this.client;

			return new Promise((resolve, reject) => {
				const timeout = setTimeout(() => {
					if (!this.isConnected) {
						const error = new Error('Connect timed out');
						try {
							if (this.ipModule && typeof this.ipModule.switchToNextHost === 'function') {
								const oldHost = (this.ipModule.getCurrentHost && this.ipModule.getCurrentHost()) || 'unknown';
								const newHost = this.ipModule.switchToNextHost();
								this.logger.warn(`Connection timed out, switching server IP ${oldHost} -> ${newHost}`);
							}
						} catch (e) {
							this.logger.debug(`AutochangeIP switch attempt failed: ${e.message}`);
						}
						this.handleError(error);
						reject(error);
					}
				}, clientOptions.connectTimeout);

				const onSpawn = () => {
					clearTimeout(timeout);
					try {
						if (clientRef && typeof clientRef.removeListener === 'function') clientRef.removeListener('error', onError);
					} catch (e) { /* ignore */ }
					resolve();
				};

				const onError = (error) => {
					clearTimeout(timeout);
					try {
						if (clientRef && typeof clientRef.removeListener === 'function') clientRef.removeListener('spawn', onSpawn);
					} catch (e) { /* ignore */ }

					if (error && error.message && (
						error.message.includes('Connect timed out') ||
						error.message.includes('ETIMEDOUT') ||
						error.message.includes('Ping timed out') ||
						error.message.includes('ECONNREFUSED')
					)) {
						try {
							if (this.ipModule && typeof this.ipModule.switchToNextHost === 'function') {
								const oldHost = (this.ipModule.getCurrentHost && this.ipModule.getCurrentHost()) || 'unknown';
								const newHost = this.ipModule.switchToNextHost();
								this.logger.warn(`Connection error detected (${error.message}), switching server IP ${oldHost} -> ${newHost}`);
							}
						} catch (e) {
							this.logger.debug(`AutochangeIP switch attempt failed: ${e.message}`);
						}
					}

					this.handleError(error);
					reject(error);
				};

				if (clientRef && typeof clientRef.once === 'function') {
					clientRef.once('spawn', onSpawn);
					clientRef.once('error', onError);
				} else {
					clearTimeout(timeout);
					reject(new Error('Client not available'));
				}
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
		try { await this.chat(welcomeMessage); } catch (e) {}
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
	shouldIgnoreError(error) {
		if (!error) return false;
		const msg = (error && (error.message || String(error))) || String(error);
		const patterns = [
			/Invalid tag/i,
			/SizeOf error/i,
			/Read error for undefined/i,
			/SizeOf error for undefined/i
		];
		return patterns.some(re => re.test(msg));
	}

	handleError(error) {
		const ignore = this.shouldIgnoreError(error);
		if (!ignore) {
			this.logger.error(`Bot error: ${error.message}`);
		}
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

					component.on('reconnectAttempt', async (attempt, lastError, instanceName) => {
						this.emit('reconnectAttempt', attempt);
						try {
							await this.performReconnect(lastError);
						} catch (error) {
							const nameLabel = instanceName || (this.config && this.config.get && this.config.get('bot.username')) || 'unknown';
							this.logger.error(`[${nameLabel}] Reconnect attempt ${attempt} failed: ${error.message}`);
							if (component.name === 'autoReconnect') {
								setTimeout(() => {
									try { component.attemptReconnect(error); } catch (e) {
										this.logger.error(`[${nameLabel}] Failed to schedule next reconnect: ${e.message}`);
									}
								}, component.delay || 5000);
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

	async performReconnect(lastError) {
		try {
			this.logger.info('Attempting to reconnect...');

			if (lastError && lastError.message && (
				lastError.message.includes('Connect timed out') ||
				lastError.message.includes('ETIMEDOUT') ||
				lastError.message.includes('Ping timed out') ||
				lastError.message.includes('ECONNREFUSED')
			)) {
				try {
					if (this.ipModule && typeof this.ipModule.switchToNextHost === 'function') {
						const oldHost = (this.ipModule.getCurrentHost && this.ipModule.getCurrentHost()) || 'unknown';
						const newHost = this.ipModule.switchToNextHost();
						this.logger.warn(`AutoReconnect: previous error (${lastError.message}), switching server IP ${oldHost} -> ${newHost}`);
					}
				} catch (e) {
					this.logger.debug(`AutochangeIP switch attempt failed: ${e.message}`);
				}
			}

			this.cleanupComponentsExceptAutoReconnect();

			if (this.client) {
				try { this.client.disconnect(); } catch (error) { this.logger.debug(`Error disconnecting client: ${error.message}`); }
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
			try { component.cleanup(); } catch (error) { this.logger.error(`Error cleaning up ${component.name}: ${error.message}`); }
		});
	}

	cleanupComponentsExceptAutoReconnect() {
		this.components.forEach(component => {
			if (component.name !== 'autoReconnect') {
				try { component.cleanup(); } catch (error) { this.logger.error(`Error cleaning up ${component.name}: ${error.message}`); }
			}
		});
	}

	async chat(message) {
		if (!this.client || !this.isConnected) throw new Error('Bot is not connected');
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
			if (!this.shouldIgnoreError(error)) {
				this.logger.error(`Failed to send chat message: ${error.message}`);
			}
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
			try { this.client.disconnect(); } catch (e) {}
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
			'0': '\x1b[30m','1': '\x1b[34m','2': '\x1b[32m','3': '\x1b[36m',
			'4': '\x1b[31m','5': '\x1b[35m','6': '\x1b[33m','7': '\x1b[37m',
			'8': '\x1b[90m','9': '\x1b[94m','a': '\x1b[92m','b': '\x1b[96m',
			'c': '\x1b[91m','d': '\x1b[95m','e': '\x1b[93m','f': '\x1b[97m',
			'r': '\x1b[0m'
		};
		const formattingMap = { 'l': '\x1b[1m','m':'\x1b[9m','n':'\x1b[4m','o':'\x1b[3m' };
		return message.replace(/§([0-9a-frlmno])/gi, (match, code) => {
			if (colorMap[code.toLowerCase()]) return colorMap[code.toLowerCase()];
			if (formattingMap[code.toLowerCase()]) return formattingMap[code.toLowerCase()];
			return '';
		}) + '\x1b[0m';
	}
}

module.exports = BedrockBot;