import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  AITaskTypeSchema,
  ConversationMessageSchema,
  ConversationPageSchema,
  ConversationSummarySchema,
  type AITaskType,
  type ConversationMessage,
  type ConversationPage,
  type ConversationSummary
} from "@codemind/shared";
import { z } from "zod";

const StoredConversationSchema = z.object({
  id: z.string().min(1),
  workspaceRoot: z.string().min(1),
  title: z.string().min(1),
  taskType: AITaskTypeSchema,
  model: z.string().min(1),
  archived: z.boolean().default(false),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  messages: z.array(ConversationMessageSchema)
});

type StoredConversation = z.infer<typeof StoredConversationSchema>;

const ConversationsFileSchema = z.object({
  version: z.literal(1),
  conversations: z.array(StoredConversationSchema)
});

export class ConversationStoreError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ConversationStoreError";
    this.code = code;
  }
}

/**
 * Local-first persistent conversation store for Electron main process.
 * Stores workspace-scoped conversation metadata, messages, and source references
 * without uploading repository code or storing API keys.
 */
export class ConversationStore {
  private readonly filePath: string;
  private conversations: StoredConversation[] = [];
  private loaded = false;

  constructor(baseDirectory: string) {
    this.filePath = path.join(baseDirectory, "ai-conversations.json");
  }

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      if (!fs.existsSync(this.filePath)) return;
      const raw = fs.readFileSync(this.filePath, "utf8");
      const parsed = ConversationsFileSchema.safeParse(JSON.parse(raw));
      if (parsed.success) {
        this.conversations = parsed.data.conversations;
      }
    } catch {
      this.conversations = [];
    }
  }

  private persist(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(
      tempPath,
      JSON.stringify({ version: 1, conversations: this.conversations }, null, 2),
      "utf8"
    );
    fs.renameSync(tempPath, this.filePath);
  }

  private toSummary(conv: StoredConversation): ConversationSummary {
    return ConversationSummarySchema.parse({
      id: conv.id,
      workspaceRoot: conv.workspaceRoot,
      title: conv.title,
      taskType: conv.taskType,
      model: conv.model,
      messageCount: conv.messages.length,
      archived: conv.archived,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt
    });
  }

  public createConversation(params: {
    workspaceRoot: string;
    title?: string;
    taskType: AITaskType;
    model: string;
  }): ConversationSummary {
    this.ensureLoaded();
    const now = new Date().toISOString();
    const conv: StoredConversation = {
      id: crypto.randomUUID(),
      workspaceRoot: params.workspaceRoot,
      title: params.title?.trim() || "New Conversation",
      taskType: params.taskType,
      model: params.model,
      archived: false,
      createdAt: now,
      updatedAt: now,
      messages: []
    };
    this.conversations.unshift(conv);
    this.persist();
    return this.toSummary(conv);
  }

  public listConversations(workspaceRoot: string, includeArchived = false): ConversationSummary[] {
    this.ensureLoaded();
    return this.conversations
      .filter((c) => c.workspaceRoot === workspaceRoot && (includeArchived || !c.archived))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((c) => this.toSummary(c));
  }

  public getConversationPage(params: {
    workspaceRoot: string;
    conversationId: string;
    limit?: number;
    cursor?: number;
  }): ConversationPage {
    this.ensureLoaded();
    const conv = this.conversations.find(
      (c) => c.id === params.conversationId && c.workspaceRoot === params.workspaceRoot
    );
    if (!conv) {
      throw new ConversationStoreError("CONVERSATION_NOT_FOUND", "Conversation not found.");
    }

    const totalMessages = conv.messages.length;
    const limit = Math.max(1, Math.min(params.limit ?? 30, 100));
    const endIdx =
      params.cursor !== undefined ? Math.min(params.cursor, totalMessages) : totalMessages;
    const startIdx = Math.max(0, endIdx - limit);
    const pageMessages = conv.messages.slice(startIdx, endIdx);

    return ConversationPageSchema.parse({
      conversation: this.toSummary(conv),
      messages: pageMessages,
      totalMessages,
      hasMore: startIdx > 0,
      nextCursor: startIdx > 0 ? startIdx : null
    });
  }

  public renameConversation(
    workspaceRoot: string,
    conversationId: string,
    title: string
  ): ConversationSummary {
    this.ensureLoaded();
    const conv = this.conversations.find(
      (c) => c.id === conversationId && c.workspaceRoot === workspaceRoot
    );
    if (!conv) {
      throw new ConversationStoreError("CONVERSATION_NOT_FOUND", "Conversation not found.");
    }
    conv.title = title.trim();
    conv.updatedAt = new Date().toISOString();
    this.persist();
    return this.toSummary(conv);
  }

  public deleteConversation(workspaceRoot: string, conversationId: string): boolean {
    this.ensureLoaded();
    const before = this.conversations.length;
    this.conversations = this.conversations.filter(
      (c) => !(c.id === conversationId && c.workspaceRoot === workspaceRoot)
    );
    if (this.conversations.length === before) {
      return false;
    }
    this.persist();
    return true;
  }

  public appendMessage(
    workspaceRoot: string,
    conversationId: string,
    message: Omit<ConversationMessage, "id" | "conversationId" | "createdAt"> & {
      id?: string;
      createdAt?: string;
    }
  ): ConversationMessage {
    this.ensureLoaded();
    const conv = this.conversations.find(
      (c) => c.id === conversationId && c.workspaceRoot === workspaceRoot
    );
    if (!conv) {
      throw new ConversationStoreError("CONVERSATION_NOT_FOUND", "Conversation not found.");
    }

    const now = message.createdAt ?? new Date().toISOString();
    const fullMessage = ConversationMessageSchema.parse({
      ...message,
      id: message.id ?? crypto.randomUUID(),
      conversationId,
      createdAt: now
    });

    conv.messages.push(fullMessage);
    if (conv.title === "New Conversation" && fullMessage.role === "user") {
      conv.title = fullMessage.content.trim().slice(0, 60) || "New Conversation";
    }
    if (fullMessage.model) {
      conv.model = fullMessage.model;
    }
    conv.updatedAt = now;
    this.persist();
    return fullMessage;
  }

  public getRecentMessagesForHistory(
    workspaceRoot: string,
    conversationId: string,
    maxMessages = 10
  ): ConversationMessage[] {
    this.ensureLoaded();
    const conv = this.conversations.find(
      (c) => c.id === conversationId && c.workspaceRoot === workspaceRoot
    );
    if (!conv) return [];
    return conv.messages.filter((m) => m.status === "completed").slice(-maxMessages);
  }
}
