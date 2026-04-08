import { Client, TextMessage, MessageAPIResponseBase } from '@line/bot-sdk';
import { QuickReplyItem } from './types.js';
import { chunkText, truncateText, fetchWithTimeout } from './utils.js';
import { LOADING_SECONDS } from './constants.js';
import { logger } from '../../utils/logger.js';

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
    } catch (error: any) {
      if (error.statusCode === 429 || (error.response && error.response.status === 429)) {
        logger.error(`⚠️ [LINE Push API] ขัดข้อง: โควต้าข้อความ Push รายเดือนเต็ม หรือถูกจำกัด Rate Limit (429) - ไม่สามารถส่งไปที่ ${chatId} ได้`);
      } else {
        logger.error('Error pushing message to chat:', error.message || error);
      }
    }
  }

  async pushTextWithQuickReply(
    chatId: string,
    text: string,
    quickReplyItems: QuickReplyItem[],
  ): Promise<void> {
    try {
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

      await this.client.pushMessage(chatId, messages);
    } catch (error: any) {
      if (error.statusCode === 429 || (error.response && error.response.status === 429)) {
        logger.error(`⚠️ [LINE Push API] ขัดข้อง: โควต้าข้อความ Push รายเดือนเต็ม หรือถูกจำกัด Rate Limit (429) - ไม่สามารถส่งพร้อม QuickReply ไปที่ ${chatId} ได้`);
      } else {
        logger.error('Error pushing message with quick reply:', error.message || error);
      }
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
        logger.error('Loading animation failed:', response.status, body);
      }
    } catch (error) {
      logger.error('Error showing loading animation:', error);
    }
  }
}
