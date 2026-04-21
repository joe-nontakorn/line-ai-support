import { Client, ImageEventMessage, FileEventMessage, MessageAPIResponseBase } from '@line/bot-sdk';
import { MessagingService } from '../messaging.js';
import { ConversationService } from '../conversation.js';
import { streamToBuffer } from '../utils.js';
import geminiService from '../../gemini.js';
import { LOADING_SECONDS } from '../constants.js';
import { logger } from '../../../utils/logger.js';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_LOG_TEXT = 500;

function truncateText(text: string, max = MAX_LOG_TEXT): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function isPdfBuffer(buffer: Buffer): boolean {
  return buffer.subarray(0, 5).toString() === '%PDF-';
}

export async function handleImageMessage(
  replyToken: string,
  userId: string,
  message: ImageEventMessage,
  client: Client,
  messaging: MessagingService,
  conversationService: ConversationService,
  userText?: string
): Promise<MessageAPIResponseBase | undefined> {
  try {
    if (!message?.id) {
      logger.warn('Missing LINE image message id', { userId, message });
      return messaging.replyText(replyToken, 'ไม่สามารถประมวลผลรูปภาพได้ กรุณาลองใหม่อีกครั้ง');
    }

    const imageStream = (await client.getMessageContent(message.id)) as AsyncIterable<Buffer>;
    const imageData = await streamToBuffer(imageStream, MAX_IMAGE_BYTES);
    const base64Image = imageData.toString('base64');

    try {
      await messaging.showLoadingAnimation(userId, LOADING_SECONDS);
    } catch (e) {
      logger.warn('Failed to show loading animation for image', { err: e, userId });
    }

    const mimeType = 'image/jpeg';
    const analysisResult = await geminiService.analyzeImage(base64Image, userText, mimeType);

    let conversation = await conversationService.getActiveConversation(userId);
    if (!conversation) {
      conversation = await conversationService.createNewConversation(userId, 'active');
    }

    let summaryLog = `[ส่งรูปภาพ] ${truncateText(analysisResult.description || 'รูปภาพที่เกี่ยวข้องกับปัญหา')}`;
    if (userText) {
      summaryLog += `\nข้อความประกอบ: ${truncateText(userText)}`;
    }

    await conversationService.appendUserMessage(conversation, summaryLog);
    await conversationService.appendAssistantMessage(conversation, truncateText(analysisResult.response, 4000));

    return messaging.replyTextWithQuickReply(replyToken, analysisResult.response, [
      { label: '✅ แก้ได้แล้ว', text: 'แก้ได้แล้ว' },
      { label: '❌ ยังแก้ไม่ได้', text: 'ยังแก้ไม่ได้' },
      { label: '👤 ติดต่อเจ้าหน้าที่', text: 'ติดต่อเจ้าหน้าที่' },
    ]);
  } catch (error) {
    logger.error('Error handling image', { err: error, userId, messageId: message?.id });
    return messaging.replyText(replyToken, 'ไม่สามารถประมวลผลรูปภาพได้ กรุณาลองใหม่อีกครั้ง');
  }
}

export async function handleFileMessage(
  replyToken: string,
  userId: string,
  message: FileEventMessage,
  client: Client,
  messaging: MessagingService,
  conversationService: ConversationService
): Promise<MessageAPIResponseBase | undefined> {
  try {
    if (!message?.id) {
      logger.warn('Missing LINE file message id', { userId, message });
      return messaging.replyText(replyToken, 'ไม่สามารถประมวลผลไฟล์ได้ กรุณาลองใหม่อีกครั้ง');
    }

    const fileName = message.fileName || '';

    if (!fileName.toLowerCase().endsWith('.pdf')) {
      return messaging.replyText(replyToken, 'รองรับเฉพาะไฟล์ PDF เท่านั้นครับ');
    }

    const fileStream = (await client.getMessageContent(message.id)) as AsyncIterable<Buffer>;
    const fileData = await streamToBuffer(fileStream, MAX_PDF_BYTES);

    if (!isPdfBuffer(fileData)) {
      logger.warn('Uploaded file does not match PDF signature', { userId, fileName, messageId: message.id });
      return messaging.replyText(replyToken, 'ไฟล์นี้ไม่ใช่ PDF ที่ถูกต้อง กรุณาตรวจสอบแล้วส่งใหม่อีกครั้ง');
    }

    const base64File = fileData.toString('base64');

    try {
      await messaging.showLoadingAnimation(userId, LOADING_SECONDS);
    } catch (e) {
      logger.warn('Failed to show loading animation for file', { err: e, userId });
    }

    const analysisResult = await geminiService.analyzePDF(base64File, fileName);

    let conversation = await conversationService.getActiveConversation(userId);
    if (!conversation) {
      conversation = await conversationService.createNewConversation(userId, 'active');
    }

    await conversationService.appendUserMessage(conversation, `[ส่งไฟล์ PDF] ${truncateText(fileName, 255)}`);
    await conversationService.appendAssistantMessage(conversation, truncateText(analysisResult.response, 4000));

    return messaging.replyText(replyToken, analysisResult.response);
  } catch (error) {
    logger.error('Error handling file', { err: error, userId, messageId: message?.id, fileName: message?.fileName });
    return messaging.replyText(replyToken, 'ไม่สามารถประมวลผลไฟล์ได้ กรุณาลองใหม่อีกครั้ง');
  }
}