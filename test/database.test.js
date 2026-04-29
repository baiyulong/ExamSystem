import test from 'node:test';
import assert from 'node:assert/strict';

import { createDatabaseStateRepository } from '../server/database.js';
import { StudyStateValidationError } from '../src/stateSchema.js';

const validState = {
  cards: [
    {
      id: 'card-1',
      knowledgeId: 'knowledge-1',
      question: 'Question?',
      answer: 'Answer.',
      priority: 'P0',
      intervalIndex: 0,
      reviewCount: 0,
      lapseCount: 0,
      nextReviewAt: '2026-04-28',
      status: 'learning',
    },
  ],
  plan: [
    {
      id: 'plan-1',
      week: 1,
      phase: 'Phase 1',
      title: 'Title',
      focus: 'Focus',
      status: 'in-progress',
    },
  ],
  wrongItems: [
    {
      id: 'wrong-1',
      title: 'Wrong item',
      reason: 'Reason',
      createdAt: '2026-04-28',
    },
  ],
  startedAt: '2026-04-28',
};

function createMockPool(queryHandler) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (/alter table study_state\s+add column if not exists version/i.test(sql)) {
        return { rowCount: 0, rows: [] };
      }
      return queryHandler(sql, params, calls);
    },
  };
}

test('health returns unconfigured false when no pool', async () => {
  const repository = createDatabaseStateRepository({ pool: null });

  await assert.deepEqual(await repository.health(), {
    configured: false,
    reachable: false,
  });
});

test('health ensures schema and checks connectivity', async () => {
  const pool = createMockPool(async (sql) => {
    if (sql.includes('create table if not exists study_state')) {
      return { rowCount: 0, rows: [] };
    }
    if (sql === 'select 1') {
      return { rowCount: 1, rows: [{ '?column?': 1 }] };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  const repository = createDatabaseStateRepository({ pool });

  await assert.deepEqual(await repository.health(), {
    configured: true,
    reachable: true,
  });
  assert.equal(pool.calls.length, 3);
  assert.match(pool.calls[0].sql, /create table if not exists study_state/i);
  assert.match(pool.calls[1].sql, /alter table study_state\s+add column if not exists version/i);
  assert.equal(pool.calls[2].sql, 'select 1');
});

test('health applies version column migration before checking connectivity', async () => {
  const pool = createMockPool(async (sql) => {
    if (sql.includes('create table if not exists study_state')) {
      return { rowCount: 0, rows: [] };
    }
    if (sql.includes('alter table study_state add column if not exists version')) {
      return { rowCount: 0, rows: [] };
    }
    if (sql === 'select 1') {
      return { rowCount: 1, rows: [{ '?column?': 1 }] };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  const repository = createDatabaseStateRepository({ pool });

  await assert.deepEqual(await repository.health(), {
    configured: true,
    reachable: true,
  });
  assert.match(pool.calls[0].sql, /create table if not exists study_state/i);
  assert.match(pool.calls[1].sql, /alter table study_state\s+add column if not exists version/i);
  assert.equal(pool.calls[2].sql, 'select 1');
});

test('concurrent health calls only run schema DDL once', async () => {
  let resolveSchema;
  const schemaPromise = new Promise((resolve) => {
    resolveSchema = resolve;
  });
  const pool = createMockPool(async (sql) => {
    if (sql.includes('create table if not exists study_state')) {
      return schemaPromise;
    }
    if (sql === 'select 1') {
      return { rowCount: 1, rows: [{ '?column?': 1 }] };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  const repository = createDatabaseStateRepository({ pool });

  const firstHealth = repository.health();
  const secondHealth = repository.health();

  await Promise.resolve();
  assert.equal(pool.calls.length, 1);

  resolveSchema({ rowCount: 0, rows: [] });

  await assert.deepEqual(await firstHealth, {
    configured: true,
    reachable: true,
  });
  await assert.deepEqual(await secondHealth, {
    configured: true,
    reachable: true,
  });
  assert.equal(pool.calls.filter(({ sql }) => sql.includes('create table if not exists study_state')).length, 1);
  assert.equal(pool.calls.filter(({ sql }) => sql === 'select 1').length, 2);
});

test('health retries schema after transient failure', async () => {
  let schemaAttempts = 0;
  const pool = createMockPool(async (sql) => {
    if (sql.includes('create table if not exists study_state')) {
      schemaAttempts += 1;
      if (schemaAttempts === 1) {
        throw new Error('transient schema failure');
      }
      return { rowCount: 0, rows: [] };
    }
    if (sql === 'select 1') {
      return { rowCount: 1, rows: [{ '?column?': 1 }] };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  const repository = createDatabaseStateRepository({ pool });

  await assert.deepEqual(await repository.health(), {
    configured: true,
    reachable: false,
    error: 'transient schema failure',
  });

  await assert.deepEqual(await repository.health(), {
    configured: true,
    reachable: true,
  });
  assert.equal(pool.calls.filter(({ sql }) => sql.includes('create table if not exists study_state')).length, 2);
  assert.equal(pool.calls.filter(({ sql }) => sql === 'select 1').length, 1);
});

test('health returns false and error message when the pool fails', async () => {
  const pool = createMockPool(async () => {
    throw new Error('boom');
  });
  const repository = createDatabaseStateRepository({ pool });

  await assert.deepEqual(await repository.health(), {
    configured: true,
    reachable: false,
    error: 'boom',
  });
});

test('loadState returns null state when no pool', async () => {
  const repository = createDatabaseStateRepository({ pool: null });

  await assert.deepEqual(await repository.loadState(), {
    state: null,
    updatedAt: null,
    version: null,
  });
});

test('loadState returns null state when no row exists', async () => {
  const pool = createMockPool(async (sql) => {
    if (sql.includes('create table if not exists study_state')) {
      return { rowCount: 0, rows: [] };
    }
    if (sql.includes('select state, updated_at, version from study_state where id = $1')) {
      return { rowCount: 0, rows: [] };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  const repository = createDatabaseStateRepository({ pool });

  await assert.deepEqual(await repository.loadState(), {
    state: null,
    updatedAt: null,
    version: null,
  });
});

test('loadState validates and returns state plus ISO updatedAt', async () => {
  const updatedAt = new Date('2026-04-28T10:20:30.000Z');
  const pool = createMockPool(async (sql) => {
    if (sql.includes('create table if not exists study_state')) {
      return { rowCount: 0, rows: [] };
    }
    if (sql.includes('select state, updated_at, version from study_state where id = $1')) {
      return { rowCount: 1, rows: [{ state: validState, updated_at: updatedAt, version: 5 }] };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  const repository = createDatabaseStateRepository({ pool });

  await assert.deepEqual(await repository.loadState(), {
    state: validState,
    updatedAt: updatedAt.toISOString(),
    version: 5,
  });
});

test('loadState wraps stored invalid state as a persistence error', async () => {
  const pool = createMockPool(async (sql) => {
    if (sql.includes('create table if not exists study_state')) {
      return { rowCount: 0, rows: [] };
    }
    if (sql.includes('select state, updated_at, version from study_state where id = $1')) {
      return {
        rowCount: 1,
        rows: [{ state: { startedAt: '2026-04-28' }, updated_at: new Date('2026-04-28T10:20:30.000Z') }],
      };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  const repository = createDatabaseStateRepository({ pool });

  await assert.rejects(
    () => repository.loadState(),
    (error) => {
      assert.equal(error instanceof StudyStateValidationError, false);
      assert.match(error.message, /Stored study state failed validation/);
      assert.ok(error.cause instanceof StudyStateValidationError);
      return true;
    },
  );
});

test('saveState throws when DATABASE_URL is not configured', async () => {
  const repository = createDatabaseStateRepository({ pool: null });

  await assert.rejects(() => repository.saveState(validState), /DATABASE_URL is not configured/);
});

test('saveState validates before querying the database', async () => {
  const pool = createMockPool(async () => {
    throw new Error('should not be called');
  });
  const repository = createDatabaseStateRepository({ pool });

  await assert.rejects(
    () => repository.saveState({
      ...validState,
      cards: [{ ...validState.cards[0], intervalIndex: -1 }],
    }),
    StudyStateValidationError,
  );
  assert.equal(pool.calls.length, 0);
});

test('saveState rejects missing expectedVersion before querying the database', async () => {
  const pool = createMockPool(async () => {
    throw new Error('should not be called');
  });
  const repository = createDatabaseStateRepository({ pool });

  await assert.rejects(
    () => repository.saveState(validState),
    /Invalid expected version/,
  );
  assert.equal(pool.calls.length, 0);
});

test('saveState rejects null expectedVersion before querying the database', async () => {
  const pool = createMockPool(async () => {
    throw new Error('should not be called');
  });
  const repository = createDatabaseStateRepository({ pool });

  await assert.rejects(
    () => repository.saveState(validState, { expectedVersion: null }),
    /Invalid expected version/,
  );
  assert.equal(pool.calls.length, 0);
});

test('saveState inserts expectedVersion 0 and returns saved state plus ISO updatedAt', async () => {
  const updatedAt = new Date('2026-04-28T11:22:33.000Z');
  const pool = createMockPool(async (sql, params) => {
    if (sql.includes('create table if not exists study_state')) {
      return { rowCount: 0, rows: [] };
    }
    if (sql.includes('insert into study_state')) {
      assert.deepEqual(params, ['default', JSON.stringify(validState)]);
      return { rowCount: 1, rows: [{ state: validState, updated_at: updatedAt, version: 1 }] };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  const repository = createDatabaseStateRepository({ pool });

  await assert.deepEqual(await repository.saveState(validState, { expectedVersion: 0 }), {
    state: validState,
    updatedAt: updatedAt.toISOString(),
    version: 1,
  });
});

test('saveState returns the validated input state even if the database echoes malformed state', async () => {
  const updatedAt = new Date('2026-04-28T11:22:33.000Z');
  const pool = createMockPool(async (sql, params) => {
    if (sql.includes('create table if not exists study_state')) {
      return { rowCount: 0, rows: [] };
    }
    if (sql.includes('insert into study_state')) {
      assert.deepEqual(params, ['default', JSON.stringify(validState)]);
      return {
        rowCount: 1,
        rows: [{ state: { cards: [] }, updated_at: updatedAt, version: 1 }],
      };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  const repository = createDatabaseStateRepository({ pool });

  await assert.deepEqual(await repository.saveState(validState, { expectedVersion: 0 }), {
    state: validState,
    updatedAt: updatedAt.toISOString(),
    version: 1,
  });
});

test('saveState rejects stale expectedVersion and preserves newer database state', async () => {
  const originalUpdatedAt = new Date('2026-04-28T10:20:30.000Z');
  const firstUpdatedAt = new Date('2026-04-28T11:22:33.000Z');
  const firstClientState = { ...validState, startedAt: '2026-04-29' };
  const secondClientState = { ...validState, startedAt: '2026-04-30' };
  let databaseRow = {
    state: validState,
    updated_at: originalUpdatedAt,
    version: 7,
  };
  const pool = createMockPool(async (sql, params) => {
    if (sql.includes('create table if not exists study_state')) {
      return { rowCount: 0, rows: [] };
    }
    if (sql.includes('select state, updated_at') && sql.includes('version')) {
      return { rowCount: 1, rows: [databaseRow] };
    }
    if (sql.includes('update study_state')) {
      const [, stateJson, expectedVersion] = params;
      if (expectedVersion !== databaseRow.version) {
        return { rowCount: 0, rows: [] };
      }
      databaseRow = {
        state: JSON.parse(stateJson),
        updated_at: firstUpdatedAt,
        version: databaseRow.version + 1,
      };
      return { rowCount: 1, rows: [databaseRow] };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  const repository = createDatabaseStateRepository({ pool });

  const clientALoad = await repository.loadState();
  const clientBLoad = await repository.loadState();
  const clientASave = await repository.saveState(firstClientState, {
    expectedVersion: clientALoad.version,
  });

  await assert.rejects(
    () => repository.saveState(secondClientState, {
      expectedVersion: clientBLoad.version,
    }),
    (error) => {
      assert.equal(error.code, 'STUDY_STATE_CONFLICT');
      assert.match(error.message, /Study state conflict/);
      return true;
    },
  );

  assert.equal(clientALoad.version, 7);
  assert.equal(clientBLoad.version, 7);
  assert.equal(clientASave.version, 8);
  assert.deepEqual((await repository.loadState()).state, firstClientState);
});

test('saveState rejects positive expectedVersion when no database row exists', async () => {
  const pool = createMockPool(async (sql) => {
    if (sql.includes('create table if not exists study_state')) {
      return { rowCount: 0, rows: [] };
    }
    if (sql.includes('insert into study_state')) {
      return {
        rowCount: 1,
        rows: [{ state: validState, updated_at: new Date('2026-04-28T11:22:33.000Z'), version: 1 }],
      };
    }
    if (sql.includes('update study_state')) {
      return { rowCount: 0, rows: [] };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  const repository = createDatabaseStateRepository({ pool });

  await assert.rejects(
    () => repository.saveState(validState, { expectedVersion: 7 }),
    (error) => {
      assert.equal(error.code, 'STUDY_STATE_CONFLICT');
      assert.match(error.message, /Study state conflict/);
      return true;
    },
  );
  assert.equal(pool.calls.some(({ sql }) => sql.includes('insert into study_state')), false);
});
