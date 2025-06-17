import { DurableObject } from "cloudflare:workers";
import { Browsable, BrowsableHandler, studio } from "./browsable";

// Define the environment interface
interface Env {
  READ_ONLY_TEST: DurableObjectNamespace;
}

// Create a durable object with readonly mode
@Browsable({ readonly: true })
export class ReadOnlyTestObject extends DurableObject {
  private sql: SqlStorage;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    // Initialize the SQLite storage
    this.sql = state.storage.sql;

    // Create a simple table for testing
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS test_data (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        value INTEGER
      )
    `);

    // Add some sample data if table is empty
    this.sql.exec(`
      INSERT INTO test_data (name, value)
      SELECT 'Sample 1', 100
      WHERE NOT EXISTS (SELECT 1 FROM test_data)
      UNION ALL
      SELECT 'Sample 2', 200
      WHERE NOT EXISTS (SELECT 1 FROM test_data)
    `);
  }

  // This method isn't necessary as it's handled by the @Browsable decorator
  // but included to show how the handler would be set up manually
  async fetch(request: Request): Promise<Response> {
    return new Response("This is handled by Browsable decorator", {
      status: 200,
    });
  }
}

// Worker entry point
export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    // Studio endpoint
    if (url.pathname === "/studio") {
      return await studio(request, env.READ_ONLY_TEST);
    }

    // Create a test ID or use the provided one
    const id = url.searchParams.get("id") || "test-object";
    const objectId = env.READ_ONLY_TEST.idFromName(id);
    const object = env.READ_ONLY_TEST.get(objectId);

    // Create some example queries for testing
    if (url.pathname === "/") {
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>ReadOnly Test</title>
          <style>
            body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
            .query { margin-bottom: 20px; border: 1px solid #ccc; padding: 10px; border-radius: 5px; }
            button { padding: 5px 10px; background: #0066cc; color: white; border: none; border-radius: 3px; cursor: pointer; }
            pre { background: #f5f5f5; padding: 10px; border-radius: 3px; overflow-x: auto; }
            .success { color: green; }
            .error { color: red; }
          </style>
        </head>
        <body>
          <h1>Read-Only Query Testing</h1>

          <a href="/studio">visit studio</a>
          
          <div class="query">
            <h3>Valid SELECT Query</h3>
            <button onclick="runQuery('SELECT * FROM test_data')">Run</button>
            <div id="result1"></div>
          </div>
          
          <div class="query">
            <h3>Invalid INSERT Query</h3>
            <button onclick="runQuery('INSERT INTO test_data (name, value) VALUES (\'New Item\', 300)')">Run</button>
            <div id="result2"></div>
          </div>
          
          <div class="query">
            <h3>Invalid UPDATE Query</h3>
            <button onclick="runQuery('UPDATE test_data SET value = 999 WHERE id = 1')">Run</button>
            <div id="result3"></div>
          </div>
          
          <div class="query">
            <h3>Invalid DELETE Query</h3>
            <button onclick="runQuery('DELETE FROM test_data WHERE id = 2')">Run</button>
            <div id="result4"></div>
          </div>
          
          <script>
            let resultCount = 0;
            
            async function runQuery(sql) {
              resultCount++;
              const resultId = 'result' + resultCount;
              const resultDiv = document.getElementById(resultId);
              resultDiv.innerHTML = '<p>Running...</p>';
              
              try {
                const response = await fetch('/query/raw', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json'
                  },
                  body: JSON.stringify({ sql })
                });
                
                const data = await response.json();
                
                if (data.error) {
                  resultDiv.innerHTML = '<p class="error">Error: ' + data.error + '</p>';
                } else {
                  resultDiv.innerHTML = '<p class="success">Success!</p><pre>' + JSON.stringify(data.result, null, 2) + '</pre>';
                }
              } catch (err) {
                resultDiv.innerHTML = '<p class="error">Error: ' + err.message + '</p>';
              }
            }
          </script>
        </body>
        </html>
      `;

      return new Response(html, {
        headers: { "Content-Type": "text/html" },
      });
    }

    // Forward the request to the durable object
    return object.fetch(request);
  },
};
