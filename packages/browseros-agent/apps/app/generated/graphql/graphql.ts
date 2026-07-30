/* eslint-disable */
/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
import { DocumentTypeDecoration } from '@graphql-typed-document-node/core';
/** All input for the `bulkCreateConversationMessages` mutation. */
export type BulkCreateConversationMessagesInput = {
  /**
   * An arbitrary string value with no semantic meaning. Will be included in the
   * payload verbatim. May be used to track mutations by the client.
   */
  clientMutationId?: string | null | undefined;
  pConversationId?: string | null | undefined;
  pMessages?: Array<ConversationMessageInputRecordInput | null | undefined> | null | undefined;
};

/** An input for mutations affecting `Conversation` */
export type ConversationInput = {
  createdAt?: string | null | undefined;
  lastMessagedAt?: string | null | undefined;
  profileId: string;
  rowId: string;
};

/** An input for mutations affecting `ConversationMessageInputRecord` */
export type ConversationMessageInputRecordInput = {
  message?: any;
  orderIndex?: number | null | undefined;
};

/** All input for the create `Conversation` mutation. */
export type CreateConversationInput = {
  /**
   * An arbitrary string value with no semantic meaning. Will be included in the
   * payload verbatim. May be used to track mutations by the client.
   */
  clientMutationId?: string | null | undefined;
  /** The `Conversation` to be created by this mutation. */
  conversation: ConversationInput;
};

/** All input for the create `LlmProvider` mutation. */
export type CreateLlmProviderInput = {
  /**
   * An arbitrary string value with no semantic meaning. Will be included in the
   * payload verbatim. May be used to track mutations by the client.
   */
  clientMutationId?: string | null | undefined;
  /** The `LlmProvider` to be created by this mutation. */
  llmProvider: LlmProviderInput;
};

/** All input for the create `ScheduledJob` mutation. */
export type CreateScheduledJobInput = {
  /**
   * An arbitrary string value with no semantic meaning. Will be included in the
   * payload verbatim. May be used to track mutations by the client.
   */
  clientMutationId?: string | null | undefined;
  /** The `ScheduledJob` to be created by this mutation. */
  scheduledJob: ScheduledJobInput;
};

/** An input for mutations affecting `LlmProvider` */
export type LlmProviderInput = {
  baseUrl?: string | null | undefined;
  contextWindow?: number | null | undefined;
  createdAt?: string | null | undefined;
  modelId: string;
  name: string;
  profileId: string;
  region?: string | null | undefined;
  resourceName?: string | null | undefined;
  rowId: string;
  supportsImages?: boolean | null | undefined;
  temperature?: number | null | undefined;
  type: string;
  updatedAt?: string | null | undefined;
};

/** Represents an update to a `LlmProvider`. Fields that are set will be updated. */
export type LlmProviderPatch = {
  baseUrl?: string | null | undefined;
  contextWindow?: number | null | undefined;
  createdAt?: string | null | undefined;
  modelId?: string | null | undefined;
  name?: string | null | undefined;
  profileId?: string | null | undefined;
  region?: string | null | undefined;
  resourceName?: string | null | undefined;
  rowId?: string | null | undefined;
  supportsImages?: boolean | null | undefined;
  temperature?: number | null | undefined;
  type?: string | null | undefined;
  updatedAt?: string | null | undefined;
};

/** Represents an update to a `Profile`. Fields that are set will be updated. */
export type ProfilePatch = {
  avatarUrl?: string | null | undefined;
  createdAt?: string | null | undefined;
  firstName?: string | null | undefined;
  lastName?: string | null | undefined;
  preferences?: any;
  rowId?: string | null | undefined;
  updatedAt?: string | null | undefined;
  userId?: string | null | undefined;
};

/** An input for mutations affecting `ScheduledJob` */
export type ScheduledJobInput = {
  createdAt?: string | null | undefined;
  enabled?: boolean | null | undefined;
  lastRunAt?: string | null | undefined;
  llmProviderId?: string | null | undefined;
  name: string;
  profileId: string;
  query: string;
  rowId: string;
  scheduleInterval?: number | null | undefined;
  scheduleTime?: string | null | undefined;
  scheduleType: string;
  updatedAt?: string | null | undefined;
};

/** Represents an update to a `ScheduledJob`. Fields that are set will be updated. */
export type ScheduledJobPatch = {
  createdAt?: string | null | undefined;
  enabled?: boolean | null | undefined;
  lastRunAt?: string | null | undefined;
  llmProviderId?: string | null | undefined;
  name?: string | null | undefined;
  profileId?: string | null | undefined;
  query?: string | null | undefined;
  rowId?: string | null | undefined;
  scheduleInterval?: number | null | undefined;
  scheduleTime?: string | null | undefined;
  scheduleType?: string | null | undefined;
  updatedAt?: string | null | undefined;
};

/** All input for the `updateLlmProvider` mutation. */
export type UpdateLlmProviderInput = {
  /**
   * An arbitrary string value with no semantic meaning. Will be included in the
   * payload verbatim. May be used to track mutations by the client.
   */
  clientMutationId?: string | null | undefined;
  /** An object where the defined keys will be set on the `LlmProvider` being updated. */
  patch: LlmProviderPatch;
  rowId: string;
};

/** All input for the `updateScheduledJob` mutation. */
export type UpdateScheduledJobInput = {
  /**
   * An arbitrary string value with no semantic meaning. Will be included in the
   * payload verbatim. May be used to track mutations by the client.
   */
  clientMutationId?: string | null | undefined;
  /** An object where the defined keys will be set on the `ScheduledJob` being updated. */
  patch: ScheduledJobPatch;
  rowId: string;
};

export type GetProfileIdByUserIdQueryVariables = Exact<{
  userId: string;
}>;


export type GetProfileIdByUserIdQuery = { profileByUserId: { rowId: string } | null };

export type CreateConversationForUploadMutationVariables = Exact<{
  input: CreateConversationInput;
}>;


export type CreateConversationForUploadMutation = { createConversation: { conversation: { id: string, rowId: string, profileId: string, lastMessagedAt: string, createdAt: string } | null } | null };

export type BulkCreateConversationMessagesMutationVariables = Exact<{
  input: BulkCreateConversationMessagesInput;
}>;


export type BulkCreateConversationMessagesMutation = { bulkCreateConversationMessages: { result: Array<{ id: string, rowId: string, conversationId: string, orderIndex: number } | null> | null } | null };

export type ConversationExistsQueryVariables = Exact<{
  pConversationId?: string | null | undefined;
}>;


export type ConversationExistsQuery = { conversationExists: boolean | null };

export type GetUploadedMessageCountQueryVariables = Exact<{
  conversationId: string;
}>;


export type GetUploadedMessageCountQuery = { conversationMessages: { totalCount: number } | null };

export type CreateLlmProviderForUploadMutationVariables = Exact<{
  input: CreateLlmProviderInput;
}>;


export type CreateLlmProviderForUploadMutation = { createLlmProvider: { llmProvider: { rowId: string } | null } | null };

export type UpdateLlmProviderForUploadMutationVariables = Exact<{
  input: UpdateLlmProviderInput;
}>;


export type UpdateLlmProviderForUploadMutation = { updateLlmProvider: { llmProvider: { rowId: string } | null } | null };

export type GetLlmProvidersByProfileIdQueryVariables = Exact<{
  profileId: string;
}>;


export type GetLlmProvidersByProfileIdQuery = { llmProviders: { nodes: Array<{ rowId: string, type: string, name: string, baseUrl: string | null, modelId: string, supportsImages: boolean, contextWindow: number | null, temperature: number | null, resourceName: string | null, region: string | null } | null> } | null };

export type GetScheduledJobsByProfileIdQueryVariables = Exact<{
  profileId: string;
}>;


export type GetScheduledJobsByProfileIdQuery = { scheduledJobs: { nodes: Array<{ rowId: string, name: string, query: string, scheduleType: string, scheduleTime: string | null, scheduleInterval: number | null, enabled: boolean, llmProviderId: string | null, createdAt: string, updatedAt: string, lastRunAt: string | null } | null> } | null };

export type CreateScheduledJobMutationVariables = Exact<{
  input: CreateScheduledJobInput;
}>;


export type CreateScheduledJobMutation = { createScheduledJob: { scheduledJob: { rowId: string } | null } | null };

export type UpdateScheduledJobMutationVariables = Exact<{
  input: UpdateScheduledJobInput;
}>;


export type UpdateScheduledJobMutation = { updateScheduledJob: { scheduledJob: { rowId: string } | null } | null };

export type DeleteScheduledJobMutationVariables = Exact<{
  rowId: string;
}>;


export type DeleteScheduledJobMutation = { deleteScheduledJob: { deletedScheduledJobId: string | null } | null };

export type CreateConversationWithMessageMutationVariables = Exact<{
  conversationId: string;
  profileId: string;
  message: any;
}>;


export type CreateConversationWithMessageMutation = { createConversation: { conversation: { rowId: string } | null } | null, createConversationMessage: { conversationMessage: { rowId: string, orderIndex: number } | null } | null };

export type AppendConversationMessageMutationVariables = Exact<{
  messageId: string;
  conversationId: string;
  orderIndex: number;
  message: any;
}>;


export type AppendConversationMessageMutation = { createConversationMessage: { conversationMessage: { rowId: string, orderIndex: number } | null } | null };

export type UpdateConversationLastMessagedAtMutationVariables = Exact<{
  conversationId: string;
}>;


export type UpdateConversationLastMessagedAtMutation = { updateConversation: { conversation: { rowId: string, lastMessagedAt: string } | null } | null };

export type GetConversationWithMessagesQueryVariables = Exact<{
  conversationId: string;
}>;


export type GetConversationWithMessagesQuery = { conversation: { rowId: string, conversationMessages: { nodes: Array<{ message: any } | null> } } | null };

export type GetRemoteLlmProvidersQueryVariables = Exact<{
  profileId: string;
}>;


export type GetRemoteLlmProvidersQuery = { llmProviders: { nodes: Array<{ rowId: string, type: string, name: string, baseUrl: string | null, modelId: string, supportsImages: boolean, contextWindow: number | null, temperature: number | null, resourceName: string | null, region: string | null, createdAt: string, updatedAt: string } | null> } | null };

export type DeleteRemoteLlmProviderMutationVariables = Exact<{
  rowId: string;
}>;


export type DeleteRemoteLlmProviderMutation = { deleteLlmProvider: { deletedLlmProviderId: string | null } | null };

export type GetProfileByUserIdQueryVariables = Exact<{
  userId: string;
}>;


export type GetProfileByUserIdQuery = { profileByUserId: { rowId: string, firstName: string | null, lastName: string | null, avatarUrl: string | null } | null };

export type UpdateProfileByUserIdMutationVariables = Exact<{
  userId: string;
  patch: ProfilePatch;
}>;


export type UpdateProfileByUserIdMutation = { updateProfileByUserId: { profile: { rowId: string, firstName: string | null, lastName: string | null, avatarUrl: string | null } | null } | null };

export type GetConversationsForHistoryQueryVariables = Exact<{
  profileId: string;
  first?: number | null | undefined;
  after?: string | null | undefined;
}>;


export type GetConversationsForHistoryQuery = { conversations: { nodes: Array<{ rowId: string, lastMessagedAt: string, conversationMessages: { nodes: Array<{ message: any } | null> } } | null>, pageInfo: { endCursor: string | null, hasNextPage: boolean } } | null };

export type DeleteConversationMutationVariables = Exact<{
  rowId: string;
}>;


export type DeleteConversationMutation = { deleteConversation: { deletedConversationId: string | null } | null };

export class TypedDocumentString<TResult, TVariables>
  extends String
  implements DocumentTypeDecoration<TResult, TVariables>
{
  __apiType?: NonNullable<DocumentTypeDecoration<TResult, TVariables>['__apiType']>;
  private value: string;
  public __meta__?: Record<string, any> | undefined;

  constructor(value: string, __meta__?: Record<string, any> | undefined) {
    super(value);
    this.value = value;
    this.__meta__ = __meta__;
  }

  override toString(): string & DocumentTypeDecoration<TResult, TVariables> {
    return this.value;
  }
}

export const GetProfileIdByUserIdDocument = new TypedDocumentString(`
    query GetProfileIdByUserId($userId: String!) {
  profileByUserId(userId: $userId) {
    rowId
  }
}
    `) as unknown as TypedDocumentString<GetProfileIdByUserIdQuery, GetProfileIdByUserIdQueryVariables>;
export const CreateConversationForUploadDocument = new TypedDocumentString(`
    mutation CreateConversationForUpload($input: CreateConversationInput!) {
  createConversation(input: $input) {
    conversation {
      id
      rowId
      profileId
      lastMessagedAt
      createdAt
    }
  }
}
    `) as unknown as TypedDocumentString<CreateConversationForUploadMutation, CreateConversationForUploadMutationVariables>;
export const BulkCreateConversationMessagesDocument = new TypedDocumentString(`
    mutation BulkCreateConversationMessages($input: BulkCreateConversationMessagesInput!) {
  bulkCreateConversationMessages(input: $input) {
    result {
      id
      rowId
      conversationId
      orderIndex
    }
  }
}
    `) as unknown as TypedDocumentString<BulkCreateConversationMessagesMutation, BulkCreateConversationMessagesMutationVariables>;
export const ConversationExistsDocument = new TypedDocumentString(`
    query ConversationExists($pConversationId: String) {
  conversationExists(pConversationId: $pConversationId)
}
    `) as unknown as TypedDocumentString<ConversationExistsQuery, ConversationExistsQueryVariables>;
export const GetUploadedMessageCountDocument = new TypedDocumentString(`
    query GetUploadedMessageCount($conversationId: String!) {
  conversationMessages(condition: {conversationId: $conversationId}, first: 0) {
    totalCount
  }
}
    `) as unknown as TypedDocumentString<GetUploadedMessageCountQuery, GetUploadedMessageCountQueryVariables>;
export const CreateLlmProviderForUploadDocument = new TypedDocumentString(`
    mutation CreateLlmProviderForUpload($input: CreateLlmProviderInput!) {
  createLlmProvider(input: $input) {
    llmProvider {
      rowId
    }
  }
}
    `) as unknown as TypedDocumentString<CreateLlmProviderForUploadMutation, CreateLlmProviderForUploadMutationVariables>;
export const UpdateLlmProviderForUploadDocument = new TypedDocumentString(`
    mutation UpdateLlmProviderForUpload($input: UpdateLlmProviderInput!) {
  updateLlmProvider(input: $input) {
    llmProvider {
      rowId
    }
  }
}
    `) as unknown as TypedDocumentString<UpdateLlmProviderForUploadMutation, UpdateLlmProviderForUploadMutationVariables>;
export const GetLlmProvidersByProfileIdDocument = new TypedDocumentString(`
    query GetLlmProvidersByProfileId($profileId: String!) {
  llmProviders(condition: {profileId: $profileId}) {
    nodes {
      rowId
      type
      name
      baseUrl
      modelId
      supportsImages
      contextWindow
      temperature
      resourceName
      region
    }
  }
}
    `) as unknown as TypedDocumentString<GetLlmProvidersByProfileIdQuery, GetLlmProvidersByProfileIdQueryVariables>;
export const GetScheduledJobsByProfileIdDocument = new TypedDocumentString(`
    query GetScheduledJobsByProfileId($profileId: String!) {
  scheduledJobs(condition: {profileId: $profileId}, first: 100) {
    nodes {
      rowId
      name
      query
      scheduleType
      scheduleTime
      scheduleInterval
      enabled
      llmProviderId
      createdAt
      updatedAt
      lastRunAt
    }
  }
}
    `) as unknown as TypedDocumentString<GetScheduledJobsByProfileIdQuery, GetScheduledJobsByProfileIdQueryVariables>;
export const CreateScheduledJobDocument = new TypedDocumentString(`
    mutation CreateScheduledJob($input: CreateScheduledJobInput!) {
  createScheduledJob(input: $input) {
    scheduledJob {
      rowId
    }
  }
}
    `) as unknown as TypedDocumentString<CreateScheduledJobMutation, CreateScheduledJobMutationVariables>;
export const UpdateScheduledJobDocument = new TypedDocumentString(`
    mutation UpdateScheduledJob($input: UpdateScheduledJobInput!) {
  updateScheduledJob(input: $input) {
    scheduledJob {
      rowId
    }
  }
}
    `) as unknown as TypedDocumentString<UpdateScheduledJobMutation, UpdateScheduledJobMutationVariables>;
export const DeleteScheduledJobDocument = new TypedDocumentString(`
    mutation DeleteScheduledJob($rowId: String!) {
  deleteScheduledJob(input: {rowId: $rowId}) {
    deletedScheduledJobId
  }
}
    `) as unknown as TypedDocumentString<DeleteScheduledJobMutation, DeleteScheduledJobMutationVariables>;
export const CreateConversationWithMessageDocument = new TypedDocumentString(`
    mutation CreateConversationWithMessage($conversationId: String!, $profileId: String!, $message: JSON!) {
  createConversation(
    input: {conversation: {rowId: $conversationId, profileId: $profileId, lastMessagedAt: "now()"}}
  ) {
    conversation {
      rowId
    }
  }
  createConversationMessage(
    input: {conversationMessage: {rowId: $conversationId, conversationId: $conversationId, orderIndex: 0, message: $message}}
  ) {
    conversationMessage {
      rowId
      orderIndex
    }
  }
}
    `) as unknown as TypedDocumentString<CreateConversationWithMessageMutation, CreateConversationWithMessageMutationVariables>;
export const AppendConversationMessageDocument = new TypedDocumentString(`
    mutation AppendConversationMessage($messageId: String!, $conversationId: String!, $orderIndex: Int!, $message: JSON!) {
  createConversationMessage(
    input: {conversationMessage: {rowId: $messageId, conversationId: $conversationId, orderIndex: $orderIndex, message: $message}}
  ) {
    conversationMessage {
      rowId
      orderIndex
    }
  }
}
    `) as unknown as TypedDocumentString<AppendConversationMessageMutation, AppendConversationMessageMutationVariables>;
export const UpdateConversationLastMessagedAtDocument = new TypedDocumentString(`
    mutation UpdateConversationLastMessagedAt($conversationId: String!) {
  updateConversation(
    input: {rowId: $conversationId, patch: {lastMessagedAt: "now()"}}
  ) {
    conversation {
      rowId
      lastMessagedAt
    }
  }
}
    `) as unknown as TypedDocumentString<UpdateConversationLastMessagedAtMutation, UpdateConversationLastMessagedAtMutationVariables>;
export const GetConversationWithMessagesDocument = new TypedDocumentString(`
    query GetConversationWithMessages($conversationId: String!) {
  conversation(rowId: $conversationId) {
    rowId
    conversationMessages(first: 100, orderBy: ORDER_INDEX_ASC) {
      nodes {
        message
      }
    }
  }
}
    `) as unknown as TypedDocumentString<GetConversationWithMessagesQuery, GetConversationWithMessagesQueryVariables>;
export const GetRemoteLlmProvidersDocument = new TypedDocumentString(`
    query GetRemoteLlmProviders($profileId: String!) {
  llmProviders(condition: {profileId: $profileId}) {
    nodes {
      rowId
      type
      name
      baseUrl
      modelId
      supportsImages
      contextWindow
      temperature
      resourceName
      region
      createdAt
      updatedAt
    }
  }
}
    `) as unknown as TypedDocumentString<GetRemoteLlmProvidersQuery, GetRemoteLlmProvidersQueryVariables>;
export const DeleteRemoteLlmProviderDocument = new TypedDocumentString(`
    mutation DeleteRemoteLlmProvider($rowId: String!) {
  deleteLlmProvider(input: {rowId: $rowId}) {
    deletedLlmProviderId
  }
}
    `) as unknown as TypedDocumentString<DeleteRemoteLlmProviderMutation, DeleteRemoteLlmProviderMutationVariables>;
export const GetProfileByUserIdDocument = new TypedDocumentString(`
    query GetProfileByUserId($userId: String!) {
  profileByUserId(userId: $userId) {
    rowId
    firstName
    lastName
    avatarUrl
  }
}
    `) as unknown as TypedDocumentString<GetProfileByUserIdQuery, GetProfileByUserIdQueryVariables>;
export const UpdateProfileByUserIdDocument = new TypedDocumentString(`
    mutation UpdateProfileByUserId($userId: String!, $patch: ProfilePatch!) {
  updateProfileByUserId(input: {userId: $userId, patch: $patch}) {
    profile {
      rowId
      firstName
      lastName
      avatarUrl
    }
  }
}
    `) as unknown as TypedDocumentString<UpdateProfileByUserIdMutation, UpdateProfileByUserIdMutationVariables>;
export const GetConversationsForHistoryDocument = new TypedDocumentString(`
    query GetConversationsForHistory($profileId: String!, $first: Int = 50, $after: Cursor) {
  conversations(
    condition: {profileId: $profileId}
    first: $first
    after: $after
    orderBy: LAST_MESSAGED_AT_DESC
  ) {
    nodes {
      rowId
      lastMessagedAt
      conversationMessages(first: 2, orderBy: ORDER_INDEX_DESC) {
        nodes {
          message
        }
      }
    }
    pageInfo {
      endCursor
      hasNextPage
    }
  }
}
    `) as unknown as TypedDocumentString<GetConversationsForHistoryQuery, GetConversationsForHistoryQueryVariables>;
export const DeleteConversationDocument = new TypedDocumentString(`
    mutation DeleteConversation($rowId: String!) {
  deleteConversation(input: {rowId: $rowId}) {
    deletedConversationId
  }
}
    `) as unknown as TypedDocumentString<DeleteConversationMutation, DeleteConversationMutationVariables>;