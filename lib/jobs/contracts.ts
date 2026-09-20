import type { BackgroundJob, BackgroundJobType } from "@/types";

export interface EnqueueJobInput {
  userId: string | null;
  jobType: BackgroundJobType;
  payload?: Record<string, unknown>;
  priority?: number;
  maxAttempts?: number;
  scheduledFor?: string;
  deduplicationKey?: string | null;
  correlationId?: string;
}

export interface JobQueue {
  enqueue(input: EnqueueJobInput): Promise<BackgroundJob>;
  claim(workerId: string, lockTimeoutSeconds?: number): Promise<BackgroundJob | null>;
  heartbeat(jobId: string, workerId: string): Promise<boolean>;
  complete(jobId: string, workerId: string, result?: Record<string, unknown>): Promise<BackgroundJob>;
  retry(jobId: string, workerId: string, error: string, scheduledFor: string): Promise<BackgroundJob>;
  fail(jobId: string, workerId: string, error: string, deadLetter: boolean): Promise<BackgroundJob>;
  cancel(jobId: string, userId?: string): Promise<BackgroundJob>;
  getJob(jobId: string, userId?: string): Promise<BackgroundJob | null>;
  listJobs(userId: string, limit?: number): Promise<BackgroundJob[]>;
}
