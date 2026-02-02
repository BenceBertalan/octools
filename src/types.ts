export interface ClientConfig {
  baseUrl: string;
  password?: string;
  autoConnect?: boolean;
  livenessCheckInterval?: number;  // Check interval in ms (default: 1000)
  sessionTimeout?: number;          // Timeout in ms (default: 30000)
}

export type SessionStatusType = 'idle' | 'busy' | 'retry' | 'error';

export interface SessionStatus {
  type: SessionStatusType;
  sessionID?: string;
  message?: string;
  attempt?: number;
  next?: number;
}

export interface Session {
  id: string;
  title?: string;
  directory?: string;
  projectID?: string;
  agent?: string;
  model?: { providerID: string; modelID: string };
  secondaryModel?: { providerID: string; modelID: string };
  time: {
    created: number;
    updated: number;
  };
}

export interface MessageInfo {
  id: string;
  sessionID: string;
  role: 'user' | 'assistant';
  time: {
    created: number;
    completed?: number;
  };
  error?: any;
  parentID?: string;
  finish?: string;
  agent?: string;
  modelID?: string;
  providerID?: string;
}

export interface MessagePart {
  id: string;
  type: 'text' | 'tool' | 'file' | 'reasoning' | 'snapshot' | 'patch' | 'agent' | 'retry' | 'compaction' | 'subtask' | 'step-start' | 'step-finish';
  text?: string;
  delta?: string; // From streaming events
  tool?: string;
  state?: {
    status?: 'pending' | 'running' | 'completed' | 'error';
    title?: string;
    description?: string;
    agent?: string;
    [key: string]: any;
  };
  metadata?: {
    subagent_type?: string;
    description?: string;
    [key: string]: any;
  };
}

export interface SubagentProgress {
  sessionID: string;
  messageID: string;
  partID: string;
  agent: string;
  task: string;
  status: 'pending' | 'running' | 'completed' | 'error';
}

export class AuthError extends Error {
  constructor(public message: string, public details?: any) {
    super(message);
    this.name = 'AuthError';
  }
}

export interface SessionErrorEvent {
  sessionID: string;
  error: {
    message: string;
    name?: string;
    data?: any;
    [key: string]: any;
  };
}

export interface Message {
  info: MessageInfo;
  parts: MessagePart[];
}

// Event payloads
export interface BusEvent {
  type: string;
  properties: any;
}

export interface QuestionRequest {
  requestID: string;
  sessionID: string;
  // ...
}

export interface PermissionRequest {
  requestID: string;
  sessionID: string;
  // ...
}

// Liveness monitoring events
export interface SessionLivenessEvent {
  sessionID: string;
  secondsSinceLastEvent: number;
  isStale: boolean;
}

export interface SessionRetryStartEvent {
  sessionID: string;
  reason: 'timeout' | 'error' | 'manual';
  attemptNumber?: number;
}

export interface SessionRetrySuccessEvent {
  sessionID: string;
}

export interface SessionRetryFailedEvent {
  sessionID: string;
  error: string;
}
