export type Stage = 'prepare' | 'apply' | 'rollback';

export interface Step {
  id(): string;
  run(): Promise<void>;
}

export interface RollbackStep extends Step {
  rollback(): Promise<void>;
}

export type FailurePolicy = 'stop-on-error' | 'continue-on-error';

export interface StagePlan {
  prepare: Step[];
  apply: Step[];
  onProgress?: (event: ProgressEvent) => void;
  failurePolicy?: FailurePolicy;
}

export interface ProgressEvent {
  stepId: string;
  stage: Stage;
  status: 'running' | 'ok' | 'failed';
  err?: Error;
}

export interface PipelineResult {
  status: 'ok' | 'failed';
  failedStep?: string;
  err?: Error;
  rolledBack?: string[];
}

function hasRollback(step: Step): step is RollbackStep {
  return typeof (step as RollbackStep).rollback === 'function';
}

export async function runPipeline(plan: StagePlan): Promise<PipelineResult> {
  const emit = (e: ProgressEvent): void => { plan.onProgress?.(e); };

  // prepare — fail-fast
  for (const s of plan.prepare) {
    const id = s.id();
    emit({ stepId: id, stage: 'prepare', status: 'running' });
    try {
      await s.run();
      emit({ stepId: id, stage: 'prepare', status: 'ok' });
    } catch (err) {
      emit({ stepId: id, stage: 'prepare', status: 'failed', err: err as Error });
      return { status: 'failed', failedStep: id, err: err as Error };
    }
  }

  // apply — rollback on failure
  const completed: Step[] = [];
  for (const s of plan.apply) {
    const id = s.id();
    emit({ stepId: id, stage: 'apply', status: 'running' });
    try {
      await s.run();
      emit({ stepId: id, stage: 'apply', status: 'ok' });
      completed.push(s);
    } catch (err) {
      emit({ stepId: id, stage: 'apply', status: 'failed', err: err as Error });
      const rolledBack: string[] = [];
      for (const done of [...completed].reverse()) {
        if (!hasRollback(done)) continue;
        const doneId = done.id();
        emit({ stepId: doneId, stage: 'rollback', status: 'running' });
        try {
          await done.rollback();
          emit({ stepId: doneId, stage: 'rollback', status: 'ok' });
          rolledBack.push(doneId);
        } catch (rollbackErr) {
          emit({ stepId: doneId, stage: 'rollback', status: 'failed', err: rollbackErr as Error });
        }
      }
      return { status: 'failed', failedStep: id, err: err as Error, rolledBack };
    }
  }

  return { status: 'ok' };
}
