import 'dotenv/config';
import pg from 'pg';

import { validateStudyState } from '../src/stateSchema.js';

const { Pool } = pg;
const STATE_ROW_ID = 'default';
export const STUDY_STATE_CONFLICT_CODE = 'STUDY_STATE_CONFLICT';

export class StudyStateConflictError extends Error {
  constructor() {
    super('Study state conflict');
    this.name = 'StudyStateConflictError';
    this.code = STUDY_STATE_CONFLICT_CODE;
  }
}

const schemaSql = `
create table if not exists study_state (
  id text primary key,
  state jsonb not null,
  version integer not null default 1,
  updated_at timestamptz not null default now()
);
`;
const versionMigrationSql = `
alter table study_state
add column if not exists version integer not null default 1;
`;

export function createDatabaseStateRepository({
  connectionString = process.env.DATABASE_URL,
  pool = connectionString ? new Pool({ connectionString }) : null,
} = {}) {
  let schemaPromise = null;

  async function ensureSchema() {
    if (!pool) return;
    if (!schemaPromise) {
      schemaPromise = pool.query(schemaSql)
        .then(() => pool.query(versionMigrationSql))
        .catch((error) => {
        schemaPromise = null;
        throw error;
      });
    }
    await schemaPromise;
  }

  return {
    async health() {
      if (!pool) return { configured: false, reachable: false };
      try {
        await ensureSchema();
        await pool.query('select 1');
        return { configured: true, reachable: true };
      } catch (error) {
        return { configured: true, reachable: false, error: error.message };
      }
    },

    async loadState() {
      if (!pool) return { state: null, updatedAt: null, version: null };
      await ensureSchema();
      const result = await pool.query(
        'select state, updated_at, version from study_state where id = $1',
        [STATE_ROW_ID],
      );
      if (result.rowCount === 0) return { state: null, updatedAt: null, version: null };
      let state;
      try {
        state = validateStudyState(result.rows[0].state);
      } catch (error) {
        throw new Error('Stored study state failed validation', { cause: error });
      }
      return {
        state,
        updatedAt: result.rows[0].updated_at.toISOString(),
        version: result.rows[0].version,
      };
    },

    async saveState(state, { expectedVersion } = {}) {
      if (!pool) {
        throw new Error('DATABASE_URL is not configured');
      }
      const validState = validateStudyState(state);
      if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
        throw new Error('Invalid expected version');
      }
      await ensureSchema();
      const params = [STATE_ROW_ID, JSON.stringify(validState)];
      let result;
      if (expectedVersion === 0) {
        result = await pool.query(
          `
          insert into study_state (id, state, version, updated_at)
          values ($1, $2::jsonb, 1, now())
          on conflict (id) do nothing
          returning state, updated_at, version
          `,
          params,
        );
      } else {
        params.push(expectedVersion);
        result = await pool.query(
          `
          update study_state
          set state = $2::jsonb,
              version = version + 1,
              updated_at = now()
          where id = $1 and version = $3
          returning state, updated_at, version
          `,
          params,
        );
      }
      if (result.rowCount === 0) {
        throw new StudyStateConflictError();
      }
      return {
        state: validState,
        updatedAt: result.rows[0].updated_at.toISOString(),
        version: result.rows[0].version,
      };
    },
  };
}
