import { Router, Request, Response } from 'express';
import AIProviderConfig from '../models/AIProviderConfig.js';
import { getAIProviderFactory } from '../services/ai-provider-factory.js';
import { encrypt, decrypt, maskKey } from '../config/crypto.js';
import { logger } from '../utils/logger.js';
import OpenRouterService from '../services/openrouter.js';
import { GeminiService } from '../services/gemini.js';

const router = Router();

// ============== GET: Current Configuration ==============
router.get('/current', async (req: Request, res: Response) => {
  try {
    const factory = getAIProviderFactory();
    const info = factory.getInfo();
    const config = await AIProviderConfig.findOne({ provider: info.provider });

    if (!config) {
      return res.json({
        provider: info.provider,
        model: info.model,
        status: 'using-env',
        lastUpdated: info.lastUpdated,
        validationStatus: 'unknown',
      });
    }

    return res.json({
      provider: config.provider,
      model: config.model,
      status: config.status,
      lastUpdated: config.updatedAt,
      validationStatus: config.validationStatus,
      maskedKey: config.apiKeyEncrypted ? maskKey(decrypt(config.apiKeyEncrypted)) : null,
    });
  } catch (error) {
    logger.error('Error fetching current config:', error);
    res.status(500).json({ error: 'Failed to fetch configuration' });
  }
});

// ============== GET: Available Providers ==============
router.get('/providers', async (req: Request, res: Response) => {
  try {
    const factory = getAIProviderFactory();
    const providers = factory.getAvailableProviders();
    res.json({ providers });
  } catch (error) {
    logger.error('Error fetching providers:', error);
    res.status(500).json({ error: 'Failed to fetch providers' });
  }
});

// ============== GET: Available Models ==============
router.get('/models/:provider', async (req: Request, res: Response) => {
  try {
    const provider = String(req.params.provider || '').toLowerCase();

    // For OpenRouter, fetch from their API
    if (provider === 'openrouter') {
      try {
        const response = await fetch('https://openrouter.ai/api/v1/models');
        const data = await response.json();

        if (!data.data || !Array.isArray(data.data)) {
          return res.status(500).json({ error: 'Failed to fetch models from OpenRouter' });
        }

        const models = data.data
          .filter((model: any) => !model.architecture?.modality?.includes('image') || model.architecture?.modality?.includes('text'))
          .map((model: any) => ({
            id: model.id,
            name: `${model.name || model.id} ($${model.pricing?.prompt || 0}/$${model.pricing?.completion || 0})`,
            pricing: model.pricing,
          }))
          .sort((a: any, b: any) => (a.name || '').localeCompare(b.name || ''));

        return res.json({ models });
      } catch (error) {
        logger.warn('Error fetching from OpenRouter API:', error);
        // Fallback to default models
        const factory = getAIProviderFactory();
        const models = factory.getModelsForProvider(provider);
        return res.json({ models });
      }
    }

    // For other providers, use factory defaults
    const factory = getAIProviderFactory();
    const models = factory.getModelsForProvider(provider);

    if (models.length === 0) {
      return res.status(404).json({ error: 'Unknown provider' });
    }

    res.json({ models });
  } catch (error) {
    logger.error('Error fetching models:', error);
    res.status(500).json({ error: 'Failed to fetch models' });
  }
});

// ============== POST: Test Connection ==============
router.post('/test', async (req: Request, res: Response) => {
  try {
    const { provider, model, apiKey } = req.body;

    if (!provider || !model) {
      return res.status(400).json({ error: 'Missing required fields: provider, model' });
    }

    // If no API key provided, try to use existing one
    let keyToUse = apiKey;
    if (!keyToUse) {
      const existingConfig = await AIProviderConfig.findOne({ provider });
      if (!existingConfig) {
        return res.status(400).json({
          error: `API key required for ${provider}. No existing configuration found.`
        });
      }
      // Use the existing decrypted key
      keyToUse = decrypt(existingConfig.apiKeyEncrypted);
    }

    // Create temporary service to test
    let testService;
    if (provider === 'openrouter') {
      testService = new OpenRouterService(keyToUse, model);
    } else if (provider === 'gemini') {
      testService = new (GeminiService as any)(keyToUse, model);
    } else {
      return res.status(400).json({ error: 'Unknown provider' });
    }

    // Simple test: generate minimal content
    try {
      const result = await testService.chat([
        {
          role: 'user',
          content: 'สวัสดี',
          timestamp: new Date(),
        },
      ]);

      if (result) {
        return res.json({
          valid: true,
          message: 'Connection test successful',
        });
      }
    } catch {
      return res.json({
        valid: false,
        message: 'Connection test failed',
      });
    }
  } catch (error) {
    logger.error('Error testing connection:', error);
    const errorMsg = (error as Error).message || 'Unknown error';
    res.status(500).json({ error: `Failed to test connection: ${errorMsg}` });
  }
});

// ============== POST: Update Configuration ==============
router.post('/update', async (req: Request, res: Response) => {
  try {
    const { provider, model, apiKey } = req.body;

    if (!provider || !model) {
      return res.status(400).json({ error: 'Missing required fields: provider, model' });
    }

    // If no API key provided, try to use existing one
    let keyToUse = apiKey;
    if (!keyToUse) {
      const existingConfig = await AIProviderConfig.findOne({ provider });
      if (!existingConfig) {
        return res.status(400).json({
          error: `API key required for ${provider}. No existing configuration found.`
        });
      }
      // Use the existing decrypted key
      keyToUse = decrypt(existingConfig.apiKeyEncrypted);
    }

    // Create temporary service to test
    let testService;
    if (provider === 'openrouter') {
      testService = new OpenRouterService(keyToUse, model);
    } else if (provider === 'gemini') {
      testService = new (GeminiService as any)(keyToUse, model);
    } else {
      return res.status(400).json({ error: 'Unknown provider' });
    }

    // Validate connection
    let isValid = false;
    try {
      const result = await testService.chat([
        {
          role: 'user',
          content: 'test',
          timestamp: new Date(),
        },
      ]);
      isValid = !!result;
    } catch (err) {
      logger.warn('Validation test failed:', err);
    }

    // Delete old config for this provider
    await AIProviderConfig.deleteMany({ provider });

    // Create new config
    const config = new AIProviderConfig({
      provider,
      model,
      apiKeyEncrypted: encrypt(keyToUse),
      status: 'active',
      validationStatus: isValid ? 'valid' : 'unknown',
      lastValidated: new Date(),
      errorMessage: null,
    });

    await config.save();

    // Update factory
    const factory = getAIProviderFactory();
    await factory.updateProvider(provider, model, keyToUse);

    logger.info(`[AIConfig] Provider updated: ${provider} (${model})`);

    res.json({
      success: true,
      message: 'Configuration updated successfully',
      config: {
        provider: config.provider,
        model: config.model,
        status: config.status,
        validationStatus: config.validationStatus,
      },
    });
  } catch (error) {
    logger.error('Error updating config:', error);
    const errorMsg = (error as Error).message || 'Unknown error';
    res.status(500).json({ error: `Failed to update configuration: ${errorMsg}` });
  }
});

// ============== DELETE: Remove Configuration ==============
router.delete('/:provider', async (req: Request, res: Response) => {
  try {
    const { provider } = req.params;

    const result = await AIProviderConfig.deleteOne({ provider });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Configuration not found' });
    }

    logger.info(`[AIConfig] Configuration deleted for provider: ${provider}`);

    res.json({
      success: true,
      message: `Configuration deleted for ${provider}`,
    });
  } catch (error) {
    logger.error('Error deleting config:', error);
    res.status(500).json({ error: 'Failed to delete configuration' });
  }
});

export default router;
