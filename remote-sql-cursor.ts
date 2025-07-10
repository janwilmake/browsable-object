export type SqlStorageValue = ArrayBuffer | string | number | null;
export type SqlStorageRow = Record<string, SqlStorageValue>;

export class RemoteSqlStorageCursor<T extends SqlStorageRow = SqlStorageRow> {
  private results: T[] = [];
  private currentIndex: number = 0;
  private _columnNames: string[] = [];
  private _rowsRead: number = 0;
  private _rowsWritten: number = 0;
  private fetchPromise: Promise<void>;
  private isResolved: boolean = false;
  private error: Error | null = null;

  constructor(
    private stub: { fetch: (request: Request) => Promise<Response> },
    private query: string,
    private bindings: SqlStorageValue[] = [],
    authorization: string | undefined,
  ) {
    this.fetchPromise = this.executeQuery(authorization);
  }

  private async executeQuery(authorization: string | undefined): Promise<void> {
    try {
      const headers: { [key: string]: string } = {
        "Content-Type": "application/json",
      };
      if (authorization) {
        headers.authorization = authorization;
      }

      const response = await this.stub.fetch(
        new Request("http://internal/query/raw", {
          method: "POST",
          headers,
          body: JSON.stringify({
            sql: this.query,
            params: this.bindings,
          }),
        }),
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`SQL execution failed: ${errorText}`);
      }

      const data = await response.json<{ error?: string; result?: any[] }>();

      if (data.error) {
        throw new Error(data.error);
      }

      if (data.result && data.result.length > 0) {
        const result = data.result[0];

        if (result.columns) {
          this._columnNames = result.columns;
        }

        if (result.rows) {
          this.results = result.rows.map((row: any[]) => {
            const obj: Record<string, SqlStorageValue> = {};
            this._columnNames.forEach((col, idx) => {
              obj[col] = row[idx];
            });
            return obj as T;
          });
        }

        if (result.meta) {
          this._rowsRead = result.meta.rows_read || 0;
          this._rowsWritten = result.meta.rows_written || 0;
        }
      }

      this.isResolved = true;
    } catch (error) {
      this.error = error instanceof Error ? error : new Error(String(error));
      this.isResolved = true;
    }
  }

  private async ensureResolved(): Promise<void> {
    if (!this.isResolved) {
      await this.fetchPromise;
    }

    if (this.error) {
      throw this.error;
    }
  }

  async next(): Promise<
    { done?: false; value: T } | { done: true; value?: never }
  > {
    await this.ensureResolved();

    if (this.currentIndex < this.results.length) {
      return { value: this.results[this.currentIndex++] };
    }

    return { done: true };
  }

  async toArray(): Promise<T[]> {
    await this.ensureResolved();
    return [...this.results];
  }

  async one(): Promise<T> {
    await this.ensureResolved();

    if (this.results.length === 0) {
      throw new Error("No rows returned");
    }

    return this.results[0];
  }

  async *rawIterate(): AsyncIterableIterator<SqlStorageValue[]> {
    await this.ensureResolved();

    for (const row of this.results) {
      yield Object.values(row);
    }
  }

  async raw(): Promise<SqlStorageValue[][]> {
    await this.ensureResolved();
    return this.results.map((row) => Object.values(row));
  }

  get columnNames(): string[] {
    return this._columnNames;
  }

  get rowsRead(): number {
    return this._rowsRead;
  }

  get rowsWritten(): number {
    return this._rowsWritten;
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<T> {
    return {
      next: () => this.next(),
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  }
}

export function exec<T extends SqlStorageRow = SqlStorageRow>(
  stub: { fetch: (request: Request) => Promise<Response> },
  sql: string,
  ...bindings: SqlStorageValue[]
): RemoteSqlStorageCursor<T> {
  return new RemoteSqlStorageCursor<T>(stub, sql, bindings, undefined);
}

export const getExec = <TDO extends DurableObjectNamespace<any>>(
  namespace: TDO,
  name: string,
  authorization?: string,
) => {
  //@ts-ignore
  const stub = namespace.get(namespace.idFromName(name));

  const exec = <T extends SqlStorageRow = SqlStorageRow>(
    query: string,
    ...bindings: SqlStorageValue[]
  ) => {
    return new RemoteSqlStorageCursor<T>(stub, query, bindings, authorization);
  };
  return exec;
};

export const makeStub = (
  basePath: string,
  baseHeaders: Record<string, string> = { "Content-Type": "application/json" },
) => ({
  fetch: async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const actualUrl = new URL(basePath);
    actualUrl.pathname =
      (actualUrl.pathname === "/" ? "" : actualUrl.pathname) + url.pathname;

    const headers = { ...baseHeaders };
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });

    const response = await fetch(actualUrl, {
      method: request.method,
      headers,
      body: request.body,
    });

    return response;
  },
});
