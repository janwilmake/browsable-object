import { DurableObject } from "cloudflare:workers";
import {
  Browsable,
  browsableRequest,
  QueryValidator,
} from "./browsable-object";
import { exec, getExec } from "./remote-sql-cursor";

@Browsable({
  basicAuth: { username: "admin", password: "test" },
  dangerouslyDisableAuth: true,
  // disableStudio:true,
  // validator: createReadOnlyValidator(),
})
export class MyDO extends DurableObject {
  private sql: SqlStorage;
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.sql = state.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS test_data (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        value INTEGER
      )
    `);
    const existingData = this.sql
      .exec(`SELECT COUNT(*) as count FROM test_data`)
      .one();
    if (!existingData || existingData.count === 0) {
      this.sql.exec(
        `INSERT INTO test_data (name, value) VALUES ('Sample 1', 100),('Sample 2', 200),('Sample 3', 300)`,
      );
    }
  }
}
type Env = { MyDO: DurableObjectNamespace<MyDO> };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const firstSegment = url.pathname.split("/")[1];
    if (!firstSegment) {
      return new Response(
        `Usage: /{id}/studio for the studio, raw queries at /{id}/query/raw`,
      );
    }

    // Forward the request to the durable object
    const stub = env.MyDO.get(env.MyDO.idFromName(firstSegment));

    if (firstSegment === "test") {
      const exec = getExec(
        env.MyDO,
        firstSegment,
        request.headers.get("authorization"),
      );
      const array = await exec("SELECT * FROM test_data").toArray();
      return new Response(JSON.stringify(array));
    }

    return browsableRequest(
      request,
      getExec(env.MyDO, firstSegment, request.headers.get("authorization")),
      { dangerouslyDisableAuth: true },
    );
    //return stub.fetch(request);
  },
};

// Helper function to create a simple readonly validator
export function createReadOnlyValidator(): QueryValidator {
  return (sql: string) => {
    const normalizedSql = sql.trim().toLowerCase();

    // Simple check for write operations
    const writeOperations = [
      "insert",
      "update",
      "delete",
      "create",
      "drop",
      "alter",
      "truncate",
      "replace",
      "attach",
      "detach",
    ];

    for (const operation of writeOperations) {
      if (normalizedSql.startsWith(operation)) {
        return {
          isValid: false,
          error: `Write operation not allowed: ${operation.toUpperCase()}`,
        };
      }
    }

    // Check for dangerous functions
    const dangerousFunctions = [
      "load_extension",
      "sqlite_compileoption",
      "pragma",
    ];

    for (const func of dangerousFunctions) {
      if (normalizedSql.includes(func)) {
        return {
          isValid: false,
          error: `Function not allowed: ${func}`,
        };
      }
    }

    return { isValid: true };
  };
}
