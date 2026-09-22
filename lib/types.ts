export type Priority =
  | "general"
  | "senior"
  | "pregnant"
  | "disability"
  | "urgent";

export type TokenStatus =
  | "waiting"
  | "called"
  | "completed"
  | "missed"
  | "cancelled";

export type ServiceStatus = "open" | "paused" | "closed";

export interface Service {
  id: string;
  name: string;
  prefix: string;
  counter: string;
  defaultMinutes: number;
  status: ServiceStatus;
  sequence: number;
  streak: number;
}

export interface Token {
  id: string;
  number: string;
  name: string;
  mobile: string;
  serviceId: string;
  priority: Priority;
  status: TokenStatus;
  createdAt: string;
  calledAt: string | null;
  completedAt: string | null;
  skippedAt: string | null;
  cancelledAt: string | null;
}

export interface QueueEvent {
  id: number;
  tokenId: string | null;
  message: string;
  createdAt: string;
}

export interface ServiceView extends Service {
  waiting: number;
  averageMinutes: number;
  current: string | null;
  upcoming: string[];
}

export interface Snapshot {
  services: ServiceView[];
  tokens: Token[];
  events: QueueEvent[];
  metrics: {
    waiting: number;
    completed: number;
    missed: number;
    averageWait: number;
    averageService: number;
  };
  hours: { label: string; count: number }[];
  updatedAt: string;
}

export interface Tracking {
  token: Token;
  service: Service;
  current: string | null;
  ahead: number;
  estimatedWait: number;
  displayStatus: string;
  updatedAt: string;
}

export interface Board {
  services: ServiceView[];
  updatedAt: string;
}

export const priorityLabels: Record<Priority, string> = {
  general: "General",
  senior: "Senior citizen",
  pregnant: "Pregnant patient",
  disability: "Person with disability",
  urgent: "Urgent assistance",
};