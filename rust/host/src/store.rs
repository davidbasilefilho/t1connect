use crate::{Error, Result, TaskId};
use rusqlite::{Connection, TransactionBehavior, params};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

const STEP_MS: i64 = 45;
const LAST_SEQ: i64 = 34;
const TASK_LIMIT: i64 = 128;
const SCHEMA: &str = include_str!("../../../src/schema.sql");

pub(super) struct Store(Connection);

pub(super) enum Start {
    Started,
    Existing,
    Capacity,
}

pub(super) fn wall_ms() -> Result<i64> {
    let since_epoch = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| Error::Clock)?;
    i64::try_from(since_epoch.as_millis()).map_err(|_| Error::Clock)
}

fn due_at(now: i64) -> Result<i64> {
    now.checked_add(STEP_MS).ok_or(Error::Clock)
}

impl Store {
    pub(super) fn open(path: &Path) -> Result<Self> {
        let db = Connection::open(path)?;
        db.execute_batch(SCHEMA)?;
        Ok(Self(db))
    }

    pub(super) fn start(&mut self, id: &TaskId<'_>, now: i64) -> Result<Start> {
        let tx = self
            .0
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM tasks WHERE id = ?)",
            [id.as_str()],
            |row| row.get::<_, bool>(0),
        )? {
            return Ok(Start::Existing);
        }
        let count: i64 = tx.query_row("SELECT count(*) FROM tasks", [], |row| row.get(0))?;
        if count >= TASK_LIMIT {
            return Ok(Start::Capacity);
        }
        tx.execute(
            "INSERT INTO tasks VALUES (?, 1, ?)",
            params![id.as_str(), due_at(now)?],
        )?;
        tx.execute(
            "INSERT INTO events VALUES (?, 1, 'started', ?)",
            params![id.as_str(), now],
        )?;
        tx.commit()?;
        Ok(Start::Started)
    }

    pub(super) fn tick(&mut self, now: i64) -> Result<()> {
        let pending: bool = self.0.query_row(
            "SELECT EXISTS(SELECT 1 FROM tasks WHERE last_seq < ? AND due_at <= ?)",
            params![LAST_SEQ, now],
            |row| row.get(0),
        )?;
        if !pending {
            return Ok(());
        }
        let tx = self
            .0
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let due = {
            let mut statement = tx.prepare(
                "SELECT id, last_seq FROM tasks WHERE last_seq < ? AND due_at <= ? ORDER BY due_at, id LIMIT ?",
            )?;
            let rows = statement.query_map(params![LAST_SEQ, now, TASK_LIMIT], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })?;
            rows.collect::<rusqlite::Result<Vec<_>>>()?
        };
        for (id, previous) in due {
            let next = previous
                .checked_add(1)
                .ok_or(Error::Boundary("invalid journal sequence"))?;
            let kind = if next == LAST_SEQ {
                "completed"
            } else {
                "progress"
            };
            tx.execute(
                "INSERT INTO events VALUES (?, ?, ?, ?)",
                params![id, next, kind, now],
            )?;
            tx.execute(
                "UPDATE tasks SET last_seq = ?, due_at = ? WHERE id = ?",
                params![next, due_at(now)?, id],
            )?;
        }
        tx.commit()?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn duplicate_start_and_tick_keep_one_sequence() -> Result<()> {
        let mut store = Store::open(Path::new(":memory:"))?;
        let id = TaskId::parse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")?;
        assert!(matches!(store.start(&id, 0)?, Start::Started));
        assert!(matches!(store.start(&id, 0)?, Start::Existing));
        for now in (45..=1485).step_by(45) {
            store.tick(now)?;
        }
        store.tick(9999)?;
        let (count, first, last): (i64, i64, i64) = store.0.query_row(
            "SELECT count(*), min(seq), max(seq) FROM events",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )?;
        assert_eq!((count, first, last), (34, 1, 34));
        Ok(())
    }
}
