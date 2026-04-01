import { Client, TextMessage, MessageAPIResponseBase } from '@line/bot-sdk';
import { QuickReplyItem } from './types.js';
import { chunkText, truncateText, fetchWithTimeout } from './utils.js';
import { LOADING_SECONDS } from './constants.js';

export class MessagingService {
  constructor(private client: Client) {}

  async replyText(
    replyToken: string,
    text: string,
  ): Promise<MessageAPIResponseBase | undefined> {
    const chunks = chunkText(text);
    const messages: TextMessage[] = chunks.map((chunk) => ({
      type: 'text',
      text: truncateText(chunk),
    }));

    return this.client.replyMessage(replyToken, messages);
  }

  async replyTextWithQuickReply(
    replyToken: string,
    text: string,
    quickReplyItems: QuickReplyItem[],
  ): Promise<MessageAPIResponseBase | undefined> {
    const chunks = chunkText(text);
    const lastIndex = chunks.length - 1;

    const messages: TextMessage[] = chunks.map((chunk, index) => {
      const isLast = index === lastIndex;
      const msg: TextMessage = {
        type: 'text',
        text: truncateText(chunk),
      };

      if (isLast) {
        msg.quickReply = {
          items: quickReplyItems.map((item) => ({
            type: 'action',
            action: {
              type: 'message',
              label: item.label,
              text: item.text,
            },
          })),
        };
      }

      return msg;
    });

    return this.client.replyMessage(replyToken, messages);
  }

  async pushText(chatId: string, text: string): Promise<void> {
    try {
      const chunks = chunkText(text);
      const messages: TextMessage[] = chunks.map((chunk) => ({
        type: 'text',
        text: truncateText(chunk),
      }));
      await this.client.pushMessage(chatId, messages);
    } catch (error) {
      console.error('Error pushing message to chat:', error);
    }
  }

  async showLoadingAnimation(chatId: string, seconds: number = LOADING_SECONDS): Promise<void> {
    try {
      const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
      if (!token) return;

      const response = await fetchWithTimeout(
        'https://api.line.me/v2/bot/chat/loading/start',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            chatId,
            loadingSeconds: seconds,
          }),
        },
        10000,
      );

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        console.error('Loading animation failed:', response.status, body);
      }
    } catch (error) {
      console.error('Error showing loading animation:', error);
    }
  }
}
