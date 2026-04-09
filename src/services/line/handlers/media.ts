import { Client, ImageEventMessage, FileEventMessage, MessageAPIResponseBase } from '@line/bot-sdk';
import { MessagingService } from '../messaging.js';
import { ConversationService } from '../conversation.js';
import { streamToBuffer } from '../utils.js';
import geminiService from '../../gemini.js';
import { LOADING_SECONDS } from '../constants.js';
import { logger } from '../../../utils/logger.js';

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
    const imageStream = (await client.getMessageContent(message.id)) as AsyncIterable<Buffer>;
    const imageData = await streamToBuffer(imageStream);
    const base64Image = imageData.toString('base64');

    await messaging.showLoadingAnimation(userId, LOADING_SECONDS);

    const analysisResult = await geminiService.analyzeImage(base64Image, userText);

    let conversation = await conversationService.getActiveConversation(userId);
    if (!conversation) {
      conversation = await conversationService.createNewConversation(userId, 'active');
    }

    let summaryLog = `[ส่งรูปภาพ] ${analysisResult.description || 'รูปภาพที่เกี่ยวข้องกับปัญหา'}`;
    if (userText) {
      summaryLog += `\nข้อความประกอบ: ${userText}`;
    }
    
    await conversationService.appendUserMessage(conversation, summaryLog);
    await conversationService.appendAssistantMessage(conversation, analysisResult.response);

    return messaging.replyTextWithQuickReply(replyToken, analysisResult.response, [
      { label: '✅ แก้ได้แล้ว', text: 'แก้ได้แล้ว' },
      { label: '❌ ยังแก้ไม่ได้', text: 'ยังแก้ไม่ได้' },
      { label: '👤 ติดต่อเจ้าหน้าที่', text: 'ติดต่อเจ้าหน้าที่' },
    ]);
  } catch (error) {
    logger.error('Error handling image:', error);
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
    const fileName = message.fileName || '';

    if (!fileName.toLowerCase().endsWith('.pdf')) {
      return messaging.replyText(replyToken, 'รองรับเฉพาะไฟล์ PDF เท่านั้นครับ');
    }

    const fileStream = (await client.getMessageContent(message.id)) as AsyncIterable<Buffer>;
    const fileData = await streamToBuffer(fileStream);
    const base64File = fileData.toString('base64');

    await messaging.showLoadingAnimation(userId, LOADING_SECONDS);

    const analysisResult = await geminiService.analyzePDF(base64File, fileName);

    let conversation = await conversationService.getActiveConversation(userId);
    if (!conversation) {
      conversation = await conversationService.createNewConversation(userId, 'active');
    }

    await conversationService.appendUserMessage(conversation, `[ส่งไฟล์ PDF] ${fileName}`);
    await conversationService.appendAssistantMessage(conversation, analysisResult.response);

    return messaging.replyText(replyToken, analysisResult.response);
  } catch (error) {
    logger.error('Error handling file:', error);
    return messaging.replyText(replyToken, 'ไม่สามารถประมวลผลไฟล์ได้ กรุณาลองใหม่อีกครั้ง');
  }
}
