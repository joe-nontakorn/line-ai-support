export type MessageRole = 'user' | 'assistant' | 'system';

export interface IMessage {
  role: MessageRole;
  content: string;
  timestamp?: Date;
}

export type ParsedResponseType = 'IT_PROBLEM' | 'IT_INFO' | 'OUT_OF_SCOPE';

export interface ParsedAIResponse {
  content: string;
  type: ParsedResponseType;
  topic?: string;
}

export interface AIAnalysisResult {
  description: string;
  response: string;
}

export interface RequestContext {
  userKey?: string;
  userTicketsContext?: string;
}

export interface AnalysisResult {
  issueSummary: string;
  category: string;
  subCategory: string;
  isITRelated: boolean;
  clarificationNeeded: string | null;
}

export interface IAIProvider {
  /**
   * Parse raw AI response to structured format
   */
  parseResponse?(rawResponse: string): ParsedAIResponse;

  /**
   * Chat with conversation history
   */
  chat(conversationHistory: IMessage[], context?: RequestContext): Promise<string>;

  /**
   * Analyze and parse image
   */
  analyzeImage(
    base64Image: string,
    userText?: string,
    mimeType?: string,
    context?: RequestContext,
  ): Promise<AIAnalysisResult>;

  /**
   * Analyze PDF
   */
  analyzePDF(
    base64PDF: string,
    fileName: string,
    context?: RequestContext,
  ): Promise<AIAnalysisResult>;

  /**
   * Analyze and categorize issue
   */
  analyzeAndCategorizeIssue(
    conversationHistory: IMessage[],
    context?: RequestContext,
  ): Promise<AnalysisResult>;

  /**
   * Clarify issue for better details
   */
  clarifyIssue(issueSummary: string, context?: RequestContext): Promise<string>;

  /**
   * Categorize issue
   */
  categorizeIssue(
    issueSummary: string,
    context?: RequestContext,
  ): Promise<{ category: string; subCategory: string }>;

  /**
   * Get troubleshooting advice
   */
  getTroubleshootingAdvice(issueSummary: string, context?: RequestContext): Promise<string>;
}
