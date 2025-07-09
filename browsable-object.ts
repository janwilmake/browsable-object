/// <reference types="@cloudflare/workers-types" />
/// <reference lib="esnext" />
//@ts-check

import { DurableObject } from "cloudflare:workers";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, X-Starbase-Source, X-Data-Source",
  "Access-Control-Max-Age": "86400",
} as const;

export type QueryTransactionRequest = {
  transaction?: QueryRequest[];
};

export type QueryRequest = {
  sql: string;
  params?: any[];
};

export function createResponse(
  result: unknown,
  error: string | undefined,
  status: number,
): Response {
  return new Response(JSON.stringify({ result, error }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Validator function type
export type QueryValidator = (sql: string) => {
  isValid: boolean;
  error?: string;
};

export interface BrowsableOptions {
  /** Required unless `dangerouslyDisableAuth:true` */
  basicAuth?: {
    username: string;
    password: string;
  };
  dangerouslyDisableAuth?: boolean;
  disableStudio?: boolean;
  validator?: QueryValidator;
}

/**
Exec function type - can execute SQL queries.
Please note, this interface should allow remote exec function as well
Such as from https://github.com/janwilmake/remote-sql-cursor
*/
export type ExecFunction = (
  sql: string,
  ...params: any[]
) => {
  columnNames: string[];
  rowsRead: number;
  rowsWritten: number;
  raw(): IterableIterator<any[]> | Promise<any[]>;
  toArray(): any[] | Promise<any[]>;
};

function checkAuth(
  request: Request,
  options: BrowsableOptions,
): Response | null {
  if (options.dangerouslyDisableAuth) {
    return null;
  }

  if (!options.basicAuth) {
    return new Response(
      "Authentication configuration missing. Please pass 'basicAuth' to your Browsable.",
      { status: 500, headers: corsHeaders },
    );
  }

  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Basic ")) {
    return new Response("Authentication required", {
      status: 401,
      headers: {
        ...corsHeaders,
        "WWW-Authenticate": 'Basic realm="Secure Area"',
      },
    });
  }

  const encoded = authHeader.split(" ")[1];
  const decoded = atob(encoded);
  const [username, password] = decoded.split(":");

  if (
    username !== options.basicAuth.username ||
    password !== options.basicAuth.password
  ) {
    return new Response("Invalid credentials", {
      status: 401,
      headers: {
        ...corsHeaders,
        "WWW-Authenticate": 'Basic realm="Secure Area"',
      },
    });
  }

  return null;
}

async function executeRawQuery(
  exec: ExecFunction,
  opts: { sql: string; params?: unknown[] },
) {
  const { sql, params } = opts;

  try {
    let cursor;

    if (params && params.length) {
      cursor = exec(sql, ...params);
    } else {
      cursor = exec(sql);
    }

    return cursor;
  } catch (error) {
    console.error("SQL Execution Error:", error);
    throw error;
  }
}

async function executeQuery(
  exec: ExecFunction,
  opts: {
    sql: string;
    params?: unknown[];
    isRaw?: boolean;
  },
) {
  const cursor = await executeRawQuery(exec, opts);
  if (!cursor) return [];

  if (opts.isRaw) {
    return {
      columns: cursor.columnNames,
      rows: Array.from(await cursor.raw()),
      meta: {
        rows_read: cursor.rowsRead,
        rows_written: cursor.rowsWritten,
      },
    };
  }

  return cursor.toArray();
}

async function executeTransaction(
  exec: ExecFunction,
  opts: {
    queries: { sql: string; params?: any[] }[];
  },
): Promise<any> {
  const { queries } = opts;
  const results = [];

  for (const query of queries) {
    let result = await executeQuery(exec, {
      sql: query.sql,
      params: query.params ?? [],
      isRaw: true,
    });

    if (!result) {
      console.error("Returning empty array.");
      return [];
    }

    results.push(result);
  }

  return results;
}

async function executeStudioRequest(
  exec: ExecFunction,
  cmd: StudioRequest,
  validator?: QueryValidator,
): Promise<any> {
  // Validate query if validator is provided
  if (validator) {
    if (cmd.type === "query") {
      const validation = validator(cmd.statement);
      if (!validation.isValid) {
        throw new Error(`Invalid query: ${validation.error}`);
      }
    } else if (cmd.type === "transaction") {
      for (const statement of cmd.statements) {
        const validation = validator(statement);
        if (!validation.isValid) {
          throw new Error(`Invalid query: ${validation.error}`);
        }
      }
    }
  }

  if (cmd.type === "query") {
    return await executeQueryForStudio(exec, cmd.statement);
  } else if (cmd.type === "transaction") {
    // Note: This is a simplified version. For proper transaction support,
    // you might need access to the storage object for transactionSync
    const results = [];
    for (const statement of cmd.statements) {
      console.log("statement", statement);
      const result = await executeQueryForStudio(exec, statement);
      console.log("statement", result);
      results.push(result);
    }
    return results;
  }
}

/**
 * Main browsable request handler function
 */
export async function browsableRequest(
  request: Request,
  exec: ExecFunction,
  options: BrowsableOptions = {},
): Promise<Response | null> {
  const url = new URL(request.url);
  const supportedRouteSuffixes = ["/query/raw", "/studio"];

  // Check if this is a supported route
  const isSupported = supportedRouteSuffixes.some((route) =>
    url.pathname.endsWith(route),
  );

  if (!isSupported) {
    return null;
  }

  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Check authentication for protected endpoints
  const authError = checkAuth(request, options);
  if (authError) {
    return authError;
  }

  if (url.pathname.endsWith("/query/raw") && request.method === "POST") {
    const { sql, params, transaction } = (await request.json()) as any;

    // If validator is provided, validate the query or queries
    if (options.validator) {
      if (transaction) {
        for (const query of transaction) {
          const validation = options.validator(query.sql);
          if (!validation.isValid) {
            return createResponse(
              null,
              `Invalid query: ${validation.error}`,
              400,
            );
          }
        }
      } else if (sql) {
        const validation = options.validator(sql);
        if (!validation.isValid) {
          return createResponse(
            null,
            `Invalid query: ${validation.error}`,
            400,
          );
        }
      }
    }

    let data = await executeTransaction(exec, {
      queries: transaction ?? [{ sql, params }],
    });

    return createResponse(data, undefined, 200);
  }

  if (url.pathname.endsWith("/studio") && !options.disableStudio) {
    if (request.method === "GET") {
      // Return studio interface
      return new Response(createStudioInterface(), {
        headers: { "Content-Type": "text/html" },
      });
    } else if (request.method === "POST") {
      const body = (await request.json()) as StudioRequest;

      if (body.type === "query" || body.type === "transaction") {
        try {
          console.log("executing", body.type);
          const result = await executeStudioRequest(
            exec,
            body,
            options.validator,
          );
          console.log("result", { result });
          return Response.json({ result });
        } catch (e) {
          if (e instanceof Error) {
            return Response.json({ error: e.message });
          }
          return Response.json({ error: "Unknown error" });
        }
      }

      return Response.json({ error: "Invalid request" });
    }
  }

  return new Response("Not found", { status: 404 });
}

export class BrowsableHandler {
  public sql: SqlStorage | undefined;
  private validator?: QueryValidator;
  private options: BrowsableOptions;

  constructor(sql: SqlStorage | undefined, options?: BrowsableOptions) {
    this.sql = sql;
    this.validator = options?.validator;
    this.options = options || {};
  }

  async fetch(request: Request) {
    if (!this.sql) {
      return new Response("SQL storage not available", { status: 500 });
    }

    const exec: ExecFunction = (sql: string, ...params: any[]) => {
      return this.sql!.exec(sql, ...params);
    };

    const response = await browsableRequest(request, exec, this.options);

    // If browsableRequest returns null, it means the route wasn't handled
    if (response === null) {
      return new Response("Not found", { status: 404 });
    }

    return response;
  }

  async executeStudioRequest(cmd: StudioRequest): Promise<any> {
    if (!this.sql) {
      throw new Error("SQL storage not available");
    }

    const exec: ExecFunction = (sql: string, ...params: any[]) => {
      return this.sql!.exec(sql, ...params);
    };

    return executeStudioRequest(exec, cmd, this.validator);
  }

  async executeTransaction(opts: {
    queries: { sql: string; params?: any[] }[];
  }): Promise<any> {
    if (!this.sql) {
      throw new Error("SQL storage not available");
    }

    const exec: ExecFunction = (sql: string, ...params: any[]) => {
      return this.sql!.exec(sql, ...params);
    };

    return executeTransaction(exec, opts);
  }

  public async executeQuery(opts: {
    sql: string;
    params?: unknown[];
    isRaw?: boolean;
  }) {
    if (!this.sql) {
      throw new Error("SQL storage not available");
    }

    const exec: ExecFunction = (sql: string, ...params: any[]) => {
      return this.sql!.exec(sql, ...params);
    };

    return executeQuery(exec, opts);
  }
}

export function Browsable(options?: BrowsableOptions) {
  return function <T extends { new (...args: any[]): any }>(constructor: T) {
    return class extends constructor {
      public _bdoHandler?: BrowsableHandler;
      private _browsableOptions: BrowsableOptions;

      constructor(...args: any[]) {
        super(...args);
        this._browsableOptions = options || {};
      }

      async fetch(request: Request): Promise<Response> {
        // Initialize handler if not already done
        if (!this._bdoHandler) {
          this._bdoHandler = new BrowsableHandler(
            this.sql,
            this._browsableOptions,
          );
        }

        // Try browsable handler first
        const browsableResponse = await this._bdoHandler.fetch(request);

        // If browsable handler returns 404, try the parent class's fetch
        if (browsableResponse.status === 404) {
          if (super.fetch) {
            return super.fetch(request);
          }
          return browsableResponse;
        }

        return browsableResponse;
      }

      async __studio(cmd: StudioRequest) {
        const storage = this.ctx.storage as DurableObjectStorage;
        const sql = storage.sql as SqlStorage;

        // Validate query if validator is provided
        if (this._browsableOptions?.validator) {
          if (cmd.type === "query") {
            const validation = this._browsableOptions.validator(cmd.statement);
            if (!validation.isValid) {
              throw new Error(`Invalid query: ${validation.error}`);
            }
          } else if (cmd.type === "transaction") {
            for (const statement of cmd.statements) {
              const validation = this._browsableOptions.validator(statement);
              if (!validation.isValid) {
                throw new Error(`Invalid query: ${validation.error}`);
              }
            }
          }
        }

        if (cmd.type === "query") {
          return await executeQueryForStudio(sql.exec, cmd.statement);
        } else if (cmd.type === "transaction") {
          const result = await storage.transaction(async () => {
            const results = [];
            for (const statement of cmd.statements) {
              const result = await executeQueryForStudio(sql.exec, statement);
              results.push(result);
            }

            return results;
          });
          return result;
        }
      }
    };
  };
}

export class BrowsableDurableObject<TEnv = any> extends DurableObject<TEnv> {
  public sql: SqlStorage | undefined;
  protected _bdoHandler?: BrowsableHandler;
  protected readonly options?: BrowsableOptions;

  constructor(
    state: DurableObjectState,
    env: TEnv,
    options?: BrowsableOptions,
  ) {
    super(state, env);
    this.sql = undefined;
    this.options = options;
  }

  async fetch(request: Request): Promise<Response> {
    this._bdoHandler = new BrowsableHandler(this.sql, this.options);
    return this._bdoHandler.fetch(request);
  }
}

/**
 * Studio
 * ------
 *
 * This is the built in Studio UI inside of the Browsable extension. It allows you to optionally
 * setup a route to enable it. The landing page has an input for you to decide which Durable Object
 * ID you want to view the data for. After you have entered the identifier the second page is the
 * Studio database browser experience.
 */
interface StudioQueryRequest {
  type: "query";
  id?: string;
  statement: string;
}

interface StudioTransactionRequest {
  type: "transaction";
  id?: string;
  statements: string[];
}

type StudioRequest = StudioQueryRequest | StudioTransactionRequest;

async function executeQueryForStudio(exec: ExecFunction, statement: string) {
  const cursor = exec(statement);
  const rawResult = Array.from(await cursor.raw());

  const columnSet = new Set();
  const columnNames = cursor.columnNames.map((colName) => {
    let renameColName = colName;

    for (let i = 0; i < 20; i++) {
      if (!columnSet.has(renameColName)) break;
      renameColName = "__" + colName + "_" + i;
    }

    return {
      name: renameColName,
      displayName: colName,
      originalType: "text",
      type: undefined,
    };
  });

  return {
    headers: columnNames,
    rows: rawResult.map((r) =>
      columnNames.reduce((a, b, idx) => {
        a[b.name] = r[idx];
        return a;
      }, {} as Record<string, unknown>),
    ),
    stat: {
      queryDurationMs: 0,
      rowsAffected: 0,
      rowsRead: cursor.rowsRead,
      rowsWritten: cursor.rowsWritten,
    },
  };
}

function createStudioInterface() {
  return `<!DOCTYPE html>
  <html>
    <head>
      <style>
        html,
        body {
          padding: 0;
          margin: 0;
          width: 100vw;
          height: 100vh;
        }
  
        iframe {
          width: 100vw;
          height: 100vh;
          overflow: hidden;
          border: 0;
        }
      </style>
      <title>Durable Object Studio - Outerbase Studio</title>
      <link
        rel="icon"
        type="image/x-icon"
        href="https://studio.outerbase.com/icons/outerbase.ico"
      />
    </head>
    <body>
      <script>
        function handler(e) {
          if (e.data.type !== "query" && e.data.type !== "transaction") return;
  
          fetch(window.location.pathname, {
            method: "post",
            body: JSON.stringify(e.data),
          })
            .then((r) => {
              if (!r.ok) {
                document.getElementById("editor").contentWindow.postMessage(
                  {
                    id: e.data.id,
                    type: e.data.type,
                    error: "Something went wrong",
                  },
                  "*"
                );
                throw new Error("Something went wrong");
              }
              return r.json();
            })
            .then((r) => {
              if (r.error) {
                document.getElementById("editor").contentWindow.postMessage(
                  {
                    id: e.data.id,
                    type: e.data.type,
                    error: r.error,
                  },
                  "*"
                )
              }
  
              const response = {
                id: e.data.id,
                type: e.data.type,
                data: r.result
              };
  
              document
                .getElementById("editor")
                .contentWindow.postMessage(response, "*");
            })
            .catch(console.error);
        }
  
        window.addEventListener("message", handler);
      </script>
  
      <iframe
        id="editor"
        allow="clipboard-read; clipboard-write"
        src="https://studio.outerbase.com/embed/starbase"
      ></iframe>
    </body>
  </html>`;
}

function createHomepageInterface() {
  return `<!DOCTYPE html>
  <html>
    <title>Outerbase Studio</title>
    <style>
      html, body {
        font-size: 20px;
        font-family: monospace;
        padding: 1rem;
      }

      #name, #submit {
        font-size: 1rem;
        padding: 0.2rem 0.5rem;
        outline: none;
        font-family: monospace;
      }

      h1 { font-size: 1.5rem; }

      p {
        padding: 0;
        margin: 10px 0;
      }
    </style>
  </html>
  <body>
    <h1>Outerbase Studio</h1>

    <form method='get' action=''>
       <p>env.MY_DURABLE_OBJECT.idFromName(</p>
       <div style="padding-left: 20px">
        <input id='name' name='id' placeholder='name' required></input>
        <button id='submit'>View</button>
       </div>
       <p>)</p>
    </form>
  </body>
  </html>`;
}

interface StudioOptions {
  basicAuth?: {
    username: string;
    password: string;
  };
}

export async function studio(
  request: Request,
  doNamespace: DurableObjectNamespace<any>,
  options?: StudioOptions,
) {
  // Protecting
  if (options?.basicAuth) {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Basic ")) {
      return new Response("Authentication required", {
        status: 401,
        headers: {
          "WWW-Authenticate": 'Basic realm="Secure Area"',
        },
      });
    }

    const encoded = authHeader.split(" ")[1];
    const decoded = atob(encoded);
    const [username, password] = decoded.split(":");

    if (
      username !== options.basicAuth.username ||
      password !== options.basicAuth.password
    ) {
      return new Response("Invalid credentials", {
        status: 401,
        headers: {
          "WWW-Authenticate": 'Basic realm="Secure Area"',
        },
      });
    }
  }

  // We run on a single endpoint, we will make use the METHOD to determine what to do
  if (request.method === "GET") {
    // This is where we render the interface
    const url = new URL(request.url);
    const stubId = url.searchParams.get("id");

    if (!stubId) {
      return new Response(createHomepageInterface(), {
        headers: { "Content-Type": "text/html" },
      });
    }

    return new Response(createStudioInterface(), {
      headers: { "Content-Type": "text/html" },
    });
  } else if (request.method === "POST") {
    const body = (await request.json()) as StudioRequest;

    if (body.type === "query" || body.type === "transaction") {
      const stubId = doNamespace.idFromName(body.id || "default");
      const stub = doNamespace.get(stubId);

      try {
        // @ts-ignore - accessing __studio method that we know exists
        const result = await stub.__studio(body);
        return Response.json({ result });
      } catch (e) {
        if (e instanceof Error) {
          return Response.json({ error: e.message });
        }
        return Response.json({ error: "Unknown error" });
      }
    }

    return Response.json({ error: "Invalid request" });
  }

  return new Response("Method not allowed");
}
