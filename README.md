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

# TODO

- Try with [@cloudflare/actors](https://github.com/cloudflare/actors) ([thread](https://x.com/BraydenWilmoth/status/1937862089332404402))
