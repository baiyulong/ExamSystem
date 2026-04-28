import 'dotenv/config';
import pg from 'pg';

import { validateStudyState } from '../src/stateSchema.js';

const { Pool } = pg;
const STATE_ROW_ID = 'default';

const schemaSql = `
create table if not exists study_state (
  id text primary key,
  state jsonb not null,
  version integer not null default 1,
  updated_at timestamptz not null default now()
);
`;

export function createDatabaseStateRepository({
  connectionString = process.env.DATABASE_URL,
  pool = connectionString ? new Pool({ connectionString }) : null,
} = {}) {
  let schemaPromise = null;

  async function ensureSchema() {
    if (!pool) return;
    if (!schemaPromise) {
      schemaPromise = pool.query(schemaSql).catch((error) => {
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
      if (!pool) return { state: null, updatedAt: null };
      await ensureSchema();
      const result = await pool.query(
        'select state, updated_at from study_state where id = $1',
        [STATE_ROW_ID],
      );
      if (result.rowCount === 0) return { state: null, updatedAt: null };
      let state;
      try {
        state = validateStudyState(result.rows[0].state);
      } catch (error) {
        throw new Error('Stored study state failed validation', { cause: error });
      }
      return {
        state,
        updatedAt: result.rows[0].updated_at.toISOString(),
      };
    },

    async saveState(state) {
      if (!pool) {
        throw new Error('DATABASE_URL is not configured');
      }
      const validState = validateStudyState(state);
      await ensureSchema();
      const result = await pool.query(
        `
        insert into study_state (id, state, version, updated_at)
        values ($1, $2::jsonb, 1, now())
        on conflict (id)
        do update set
          state = excluded.state,
          version = study_state.version + 1,
          updated_at = now()
        returning state, updated_at
        `,
        [STATE_ROW_ID, JSON.stringify(validState)],
      );
      return {
        state: validState,
        updatedAt: result.rows[0].updated_at.toISOString(),
      };
    },
  };
}
