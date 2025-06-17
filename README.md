# browsable-object

Forked from [@outerbase/browsable-durable-object](https://github.com/outerbase/browsable-durable-object) to add some functionality

A decorator, inheritance mechanism, and handler for making Cloudflare Durable Objects browsable and queryable via SQL, with support for custom query validation.

## Installation

```bash
npm install browsable-object
```

## Features

- **SQL Query Interface**: Easily query your Durable Object's SQLite database
- **Multiple Implementation Options**: Use via decorator, inheritance, or composition
- **Custom Query Validation**: Provide your own validator function to control which queries are allowed
- **Studio UI**: Built-in database browser interface
- **CORS Support**: Configurable cross-origin resource sharing

## Usage

Here are various ways to implement the browsable experience, with examples of using custom validation.

### Class Decorator

```typescript
import { DurableObject } from "cloudflare:workers";
import { Browsable, QueryValidator } from "browsable-object";

// Standard implementation
@Browsable()
export class MyDurableObject extends DurableObject<Env> {
  public sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
  }

  async fetch(request: Request): Promise<Response> {
    return new Response("Hello from MyDurableObject");
  }
}

// Read-only implementation with custom validator
const readOnlyValidator: QueryValidator = (sql: string) => {
  const upperSql = sql.trim().toUpperCase();

  if (upperSql.startsWith("SELECT") || upperSql.startsWith("WITH")) {
    return { isValid: true };
  }

  return {
    isValid: false,
    error: "Only SELECT and WITH queries are allowed",
  };
};

@Browsable({ validator: readOnlyValidator })
export class MyReadOnlyDurableObject extends DurableObject<Env> {
  public sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
  }

  async fetch(request: Request): Promise<Response> {
    return new Response("Hello from Read-Only DurableObject");
  }
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const path = new URL(request.url).pathname;
    let id: DurableObjectId = env.MY_DURABLE_OBJECT.idFromName(path);
    let stub = env.MY_DURABLE_OBJECT.get(id);

    return stub.fetch(request);
  },
} satisfies ExportedHandler<Env>;
```

### Inheritance

```typescript
import { BrowsableDurableObject, QueryValidator } from "browsable-object";

// Standard implementation
export class MyDurableObject extends BrowsableDurableObject<Env> {
  public sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
  }

  async fetch(request: Request): Promise<Response> {
    const baseResponse = await super.fetch(request);

    if (baseResponse.status === 404) {
      return new Response("Hello from MyDurableObject");
    }

    return baseResponse;
  }
}

// Read-only implementation with custom validator
const readOnlyValidator: QueryValidator = (sql: string) => {
  const upperSql = sql.trim().toUpperCase();
  const forbiddenKeywords = [
    "INSERT",
    "UPDATE",
    "DELETE",
    "DROP",
    "CREATE",
    "ALTER",
  ];

  for (const keyword of forbiddenKeywords) {
    if (upperSql.includes(keyword)) {
      return {
        isValid: false,
        error: `${keyword} operations are not allowed`,
      };
    }
  }

  return { isValid: true };
};

export class MyReadOnlyDurableObject extends BrowsableDurableObject<Env> {
  public sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    // Pass validator option to the parent class
    super(ctx, env, { validator: readOnlyValidator });
    this.sql = ctx.storage.sql;
  }

  async fetch(request: Request): Promise<Response> {
    const baseResponse = await super.fetch(request);

    if (baseResponse.status === 404) {
      return new Response("Hello from Read-Only DurableObject");
    }

    return baseResponse;
  }
}
```

### Composition

```typescript
import { BrowsableHandler, QueryValidator } from "browsable-object";

// Standard implementation
export class MyDurableObject extends DurableObject<Env> {
  public sql: SqlStorage;
  private handler: BrowsableHandler;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.handler = new BrowsableHandler(this.sql);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === "/query/raw") {
      return await this.handler.fetch(request);
    }

    return new Response("Hello from MyDurableObject");
  }
}

// Read-only implementation with custom validator
const strictValidator: QueryValidator = (sql: string) => {
  const upperSql = sql.trim().toUpperCase();

  // Only allow specific SELECT patterns
  if (!upperSql.startsWith("SELECT")) {
    return {
      isValid: false,
      error: "Only SELECT queries are allowed",
    };
  }

  // Check for dangerous functions
  const dangerousPatterns = ["PRAGMA", "ATTACH", "DETACH"];
  for (const pattern of dangerousPatterns) {
    if (upperSql.includes(pattern)) {
      return {
        isValid: false,
        error: `${pattern} is not allowed`,
      };
    }
  }

  return { isValid: true };
};

export class MyReadOnlyDurableObject extends DurableObject<Env> {
  public sql: SqlStorage;
  private handler: BrowsableHandler;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    // Initialize with validator option
    this.handler = new BrowsableHandler(this.sql, {
      validator: strictValidator,
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === "/query/raw") {
      return await this.handler.fetch(request);
    }

    return new Response("Hello from Read-Only DurableObject");
  }
}
```

### Studio UI Support

```typescript
import { DurableObject } from "cloudflare:workers";
import { Browsable, studio, QueryValidator } from "browsable-object";

// Standard implementation
@Browsable()
export class MyDurableObject extends DurableObject<Env> {
  public sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
  }
}

// Read-only implementation for Studio
const studioValidator: QueryValidator = (sql: string) => {
  const upperSql = sql.trim().toUpperCase();

  // Allow SELECT, WITH, and EXPLAIN queries
  const allowedStarters = ["SELECT", "WITH", "EXPLAIN"];
  const isAllowed = allowedStarters.some((starter) =>
    upperSql.startsWith(starter),
  );

  if (!isAllowed) {
    return {
      isValid: false,
      error: "Only SELECT, WITH, and EXPLAIN queries are allowed in Studio",
    };
  }

  return { isValid: true };
};

@Browsable({ validator: studioValidator })
export class MyReadOnlyDurableObject extends DurableObject<Env> {
  public sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
  }
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/studio") {
      return await studio(request, env.MY_DURABLE_OBJECT, {
        basicAuth: {
          username: "admin",
          password: "password",
        },
      });
    }

    // the rest of your code here
    // ....

    return new Response("Hello World", { status: 200 });
  },
} satisfies ExportedHandler<Env>;
```

## API Reference

### QueryValidator

A function type that validates SQL queries:

```typescript
type QueryValidator = (sql: string) => {
  isValid: boolean;
  error?: string;
};
```

### BrowsableOptions

Options that can be passed to the Browsable decorator, BrowsableDurableObject constructor, or BrowsableHandler constructor.

```typescript
interface BrowsableOptions {
  validator?: QueryValidator; // Custom function to validate SQL queries
}
```

### Browsable(options?: BrowsableOptions)

Class decorator that adds browsable functionality to a Durable Object.

### BrowsableDurableObject

Base class that can be extended to create a browsable Durable Object.

```typescript
constructor(
  state: DurableObjectState,
  env: TEnv,
  options?: BrowsableOptions
)
```

### BrowsableHandler

Handler class for processing SQL queries with optional custom validation.

```typescript
constructor(
  sql: SqlStorage | undefined,
  options?: BrowsableOptions
)
```

### studio(request: Request, namespace: DurableObjectNamespace, options?)

Creates a Studio UI interface for browsing your Durable Object data.

```typescript
interface StudioOptions {
  basicAuth?: {
    username: string;
    password: string;
  };
}
```

## Query Validation

You can provide a custom `QueryValidator` function to control which SQL queries are allowed. The validator receives the SQL string and returns an object indicating whether the query is valid and optionally an error message.

### Example Validators

```typescript
// Read-only validator
const readOnlyValidator: QueryValidator = (sql: string) => {
  const upperSql = sql.trim().toUpperCase();
  const writeOperations = [
    "INSERT",
    "UPDATE",
    "DELETE",
    "CREATE",
    "DROP",
    "ALTER",
  ];

  for (const op of writeOperations) {
    if (upperSql.includes(op)) {
      return { isValid: false, error: `${op} operations are not allowed` };
    }
  }

  return { isValid: true };
};

// Table-specific validator
const tableRestrictedValidator: QueryValidator = (sql: string) => {
  const upperSql = sql.trim().toUpperCase();

  if (upperSql.includes("SENSITIVE_TABLE")) {
    return { isValid: false, error: "Access to sensitive_table is restricted" };
  }

  return { isValid: true };
};

// Complex validator with multiple rules
const complexValidator: QueryValidator = (sql: string) => {
  const upperSql = sql.trim().toUpperCase();

  // Rule 1: Only allow SELECT and WITH
  if (!upperSql.startsWith("SELECT") && !upperSql.startsWith("WITH")) {
    return { isValid: false, error: "Only SELECT and WITH queries allowed" };
  }

  // Rule 2: No dangerous functions
  const dangerousFunctions = ["LOAD_EXTENSION", "PRAGMA", "ATTACH"];
  for (const func of dangerousFunctions) {
    if (upperSql.includes(func)) {
      return { isValid: false, error: `Function ${func} is not allowed` };
    }
  }

  // Rule 3: Limit query complexity (example)
  if (sql.length > 10000) {
    return { isValid: false, error: "Query too long" };
  }

  return { isValid: true };
};
```

## Endpoints

When using any of the browsable implementations, the following endpoint is available:

- `POST /query/raw` - Execute SQL queries with optional validation

### Request Format

```typescript
// Single query
{
  "sql": "SELECT * FROM users",
  "params": ["optional", "parameters"]
}

// Transaction (multiple queries)
{
  "transaction": [
    { "sql": "SELECT * FROM users", "params": [] },
    { "sql": "SELECT * FROM posts WHERE user_id = ?", "params": [1] }
  ]
}
```

### Response Format

```typescript
{
  "result": {
    "columns": ["id", "name", "email"],
    "rows": [[1, "John", "john@example.com"]],
    "meta": {
      "rows_read": 1,
      "rows_written": 0
    }
  },
  "error": null
}
```

## License

MIT
