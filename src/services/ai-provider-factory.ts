import { IAIProvider } from './base-ai-provider.js';
import { GeminiService } from './gemini.js';
import OpenRouterService from './openrouter.js';
import AIProviderConfig from '../models/AIProviderConfig.js';
import { decrypt } from '../config/crypto.js';
import { logger } from '../utils/logger.js';

class AIProviderFactory {
  private currentProvider: IAIProvider | null = null;
  private currentProviderName: string = 'gemini';
  private currentModel: string = 'gemini-3.1-flash-lite';
  private lastConfigUpdate: Date = new Date();

  private readonly DEFAULT_PROVIDER = 'gemini';
  private readonly DEFAULT_MODEL = 'gemini-3.1-flash-lite';

  constructor() {
    // Initialize with env variables
    this.currentProviderName = (process.env.AI_PROVIDER || this.DEFAULT_PROVIDER).toLowerCase();
    this.currentModel = process.env.AI_MODEL || this.DEFAULT_MODEL;

    logger.info(`[AIProviderFactory] Initialized with provider: ${this.currentProviderName}, model: ${this.currentModel}`);
  }

  /**
   * Load config from database (REQUIRED - always load from DB)
   */
  async loadConfigFromDB(): Promise<void> {
    try {
      const config = await AIProviderConfig.findOne({ status: 'active' });

      if (!config) {
        throw new Error('No active AI configuration found in database');
      }

      const provider = config.provider;
      const model = config.model;
      const decryptedKey = decrypt(config.apiKeyEncrypted);

      if (provider === 'openrouter') {
        this.currentProvider = new OpenRouterService(decryptedKey, model);
        this.currentProviderName = 'openrouter';
        this.currentModel = model;
      } else if (provider === 'gemini') {
        this.currentProvider = new GeminiService(decryptedKey, model);
        this.currentProviderName = 'gemini';
        this.currentModel = model;
      } else {
        throw new Error(`Unknown provider: ${provider}`);
      }

      this.lastConfigUpdate = config.updatedAt;
      logger.info(`[AIProviderFactory] Loaded from DB: ${provider} (${model})`);
    } catch (error) {
      logger.error('[AIProviderFactory] Failed to load from DB:', error);
      throw error;
    }
  }

  /**
   * Get current provider instance
   */
  getProvider(): IAIProvider {
    if (!this.currentProvider) {
      throw new Error('AI Provider not initialized');
    }
    return this.currentProvider;
  }

  /**
   * Get current provider info
   */
  getInfo(): { provider: string; model: string; lastUpdated: Date } {
    return {
      provider: this.currentProviderName,
      model: this.currentModel,
      lastUpdated: this.lastConfigUpdate,
    };
  }

  /**
   * Update provider at runtime
   */
  async updateProvider(providerName: string, model: string, apiKey?: string): Promise<void> {
    try {
      providerName = providerName.toLowerCase();

      if (providerName === 'openrouter') {
        if (!apiKey) {
          throw new Error('API key required for OpenRouter');
        }
        this.currentProvider = new OpenRouterService(apiKey, model);
        this.currentProviderName = 'openrouter';
        this.currentModel = model;
      } else if (providerName === 'gemini') {
        if (!apiKey) {
          throw new Error('API key required for Gemini');
        }
        this.currentProvider = new GeminiService(apiKey, model);
        this.currentProviderName = 'gemini';
        this.currentModel = model;
      } else {
        throw new Error(`Unknown provider: ${providerName}`);
      }

      this.lastConfigUpdate = new Date();
      logger.info(`[AIProviderFactory] Provider updated: ${providerName} (${model})`);
    } catch (error) {
      logger.error('[AIProviderFactory] Failed to update provider:', error);
      throw error;
    }
  }

  /**
   * Get available providers
   */
  getAvailableProviders(): Array<{ name: string; displayName: string; requiresKey: boolean }> {
    return [
      { name: 'gemini', displayName: 'Google Gemini', requiresKey: false },
      { name: 'openrouter', displayName: 'OpenRouter.ai', requiresKey: true },
    ];
  }

  /**
   * Get models for specific provider
   */
  getModelsForProvider(providerName: string): Array<{ id: string; name: string }> {
    providerName = providerName.toLowerCase();

    if (providerName === 'gemini') {
      return [
        { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
        { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite' },
        { id: 'gemini-3.1-flash-lite-preview', name: 'Gemini 3.1 Flash Lite Preview' },
        { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash' },
      ];
    } else if (providerName === 'openrouter') {
      return [
        { id: 'openrouter/auto', name: 'OpenRouter Auto (Best Value)' },
        { id: 'google/gemini-3.5-flash', name: 'Google Gemini 3.5 Flash' },
        { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini' },
        { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet' },
        { id: 'meta-llama/llama-3.1-70b-instruct', name: 'Llama 3.1 70B' },
      ];
    }

    return [];
  }
}

// Singleton instance
let factoryInstance: AIProviderFactory | null = null;

export function getAIProviderFactory(): AIProviderFactory {
  if (!factoryInstance) {
    factoryInstance = new AIProviderFactory();
  }
  return factoryInstance;
}

export async function initializeAIProvider(): Promise<void> {
  const factory = getAIProviderFactory();

  // Always load from DB (no env fallback)
  try {
    await factory.loadConfigFromDB();
    logger.info('[AIProviderFactory] Successfully loaded AI configuration from database');
  } catch (error) {
    logger.error('[AIProviderFactory] Failed to load AI configuration from database:', error);
    logger.error('[AIProviderFactory] Please ensure there is an active AI configuration in the database');
    throw new Error('AI configuration not found in database. Please set up an active configuration first.');
  }
}
