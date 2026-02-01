export interface ClientConfig {
  baseUrl: string;
  password?: string;
  autoConnect?: boolean;
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
}

export interface MessagePart {
  id: string;
  type: 'text' | 'tool' | 'file' | 'reasoning' | 'snapshot' | 'patch' | 'agent' | 'retry' | 'compaction' | 'subtask' | 'step-start' | 'step-finish';
  text?: string;
  delta?: string; // From streaming events
  tool?: string;
  state?: any;
  // ... other fields as needed
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
