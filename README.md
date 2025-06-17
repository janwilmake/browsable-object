# browsable-object

Forked from [@outerbase/browsable-durable-object](https://github.com/outerbase/browsable-durable-object) to add some functionality

A decorator, inheritance mechanism, and handler for making Cloudflare Durable Objects browsable and queryable via SQL, with support for read-only validation.

## Installation

```bash
npm install browsable-object
```

## Features

- **SQL Query Interface**: Easily query your Durable Object's SQLite database
- **Multiple Implementation Options**: Use via decorator, inheritance, or composition
- **Read-Only Mode**: Validate queries to ensure they are read-only operations
- **Studio UI**: Built-in database browser interface
- **CORS Support**: Configurable cross-origin resource sharing

## Usage

Here are various ways to implement the browsable experience, with examples of using the read-only option.

### Class Decorator

```typescript
import { DurableObject } from "cloudflare:workers";
import { Browsable } from "@outerbase/browsable-durable-object";

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

// Read-only implementation
@Browsable({ readonly: true })
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

// Read-only implementation
export class MyReadOnlyDurableObject extends BrowsableDurableObject<Env> {
  public sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    // Pass readonly option to the parent class
    super(ctx, env, { readonly: true });
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

// Read-only implementation
export class MyReadOnlyDurableObject extends DurableObject<Env> {
  public sql: SqlStorage;
  private handler: BrowsableHandler;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    // Initialize with readonly option
    this.handler = new BrowsableHandler(this.sql, { readonly: true });
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
import { Browsable, studio } from "@outerbase/browsable-durable-object";

// Standard implementation
@Browsable()
export class MyDurableObject extends DurableObject<Env> {}

// Read-only implementation
@Browsable({ readonly: true })
export class MyReadOnlyDurableObject extends DurableObject<Env> {}

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

### BrowsableOptions

Options that can be passed to the Browsable decorator, BrowsableDurableObject constructor, or BrowsableHandler constructor.

```typescript
interface BrowsableOptions {
  readonly?: boolean; // Enables SQL query validation to ensure read-only operations
}
```

### Browsable(options?: BrowsableOptions)

Class decorator that adds browsable functionality to a Durable Object.

### BrowsableDurableObject

Base class that can be extended to create a browsable Durable Object.

### BrowsableHandler

Handler class for processing SQL queries with optional read-only validation.

```typescript
new BrowsableHandler(sql: SqlStorage, options?: BrowsableOptions)
```

### studio(request: Request, namespace: DurableObjectNamespace, options?)

Creates a Studio UI interface for browsing your Durable Object data.

## Read-Only Validation

When the `readonly: true` option is provided, SQL queries are validated before execution to ensure they are read-only operations. The validation checks for:

- No INSERT, UPDATE, DELETE statements
- No CREATE, DROP, ALTER statements
- No dangerous function calls like PRAGMA or load_extension

If a query fails validation, an error response is returned with details about why the query was rejected.

## License

MIT
