# browsable-object

A decorator, inheritance mechanism, and handler for making Cloudflare Durable Objects browsable and queryable via SQL. Forked from [@outerbase/browsable-durable-object](https://github.com/outerbase/browsable-durable-object) to change functionality. See the original for usage patterns.

Added features compared to original:

- query validation via `validator`
- auth is required unless explicitly disabled (more secure, harder to make mistakes!)
- easy to plug into all your DOs using any chosen routing pattern
- middleware `browsableRequest` allows directly plugging this into your worker
- studio is now directly part of your DO it when `@Browsable` is used, no need for additional config (works even in localhost!)

Easiest Usage:

```ts
@Browsable({
  basicAuth: { username: "admin", password: env.SECRET },
  // dangerouslyDisableAuth: true,
  // disableStudio:true,
  // validator: createReadOnlyValidator(),
})
export class MyDO extends DurableObject {
  //... your DO
}
type Env = { SECRET: string; MyDO: DurableObjectNamespace };
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const firstSegment = url.pathname.split("/")[1];
    if (!firstSegment) {
      return new Response(
        `Usage: /{id}/studio for the studio, raw queries at /{id}/query/raw`,
      );
    }
    // Forward the request to the specified durable object
    const stub = env.MyDO.get(env.MyDO.idFromName(firstSegment));
    return stub.fetch(request);
  },
};
```

## Installation

```bash
npm install browsable-object
```

Check https://github.com/outerbase/browsable-durable-object for other usage patterns

## TODO

- Confirm `remote-sql-cursor` 'exec' function works with the `browsableRequest` middleware.
- If so, I can use this in DORM to 1) have easy pattern to make aggregate readonly and 2) make it possible to easily access studio for client with any amount of mirrors.
- Try with [@cloudflare/actors](https://github.com/cloudflare/actors) ([thread](https://x.com/BraydenWilmoth/status/1937862089332404402))
