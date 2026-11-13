/**
 * Wrap a sql.js Database so it exposes the small subset of the node:sqlite API that
 * shared/schema.js and shared/core.js use: exec(sql) and prepare(sql).get/all/run.
 * Statements are prepared per call, so they stay valid across db.export().
 */
export function wrapSqlJs(sqlDb) {
  const bindable = (params) => params.map((p) => (p === undefined ? null : p));

  return {
    exec: (sql) => sqlDb.exec(sql),
    prepare(sql) {
      const withStatement = (params, fn) => {
        const stmt = sqlDb.prepare(sql);
        try {
          stmt.bind(bindable(params));
          return fn(stmt);
        } finally {
          stmt.free();
        }
      };
      return {
        get: (...params) => withStatement(params, (s) => (s.step() ? s.getAsObject() : undefined)),
        all: (...params) =>
          withStatement(params, (s) => {
            const rows = [];
            while (s.step()) rows.push(s.getAsObject());
            return rows;
          }),
        run: (...params) =>
          withStatement(params, (s) => {
            s.step();
            return { changes: sqlDb.getRowsModified() };
          }),
      };
    },
  };
}
