import { DurableObject } from "cloudflare:workers";
import { Browsable, QueryValidator, studio } from "./browsable";

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
// Define the environment interface
interface Env {
  READ_ONLY_TEST: DurableObjectNamespace;
}

// Create a durable object with readonly validator
@Browsable({
  validator: createReadOnlyValidator(),
})
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
    const existingData = this.sql
      .exec(`SELECT COUNT(*) as count FROM test_data`)
      .one();
    if (!existingData || existingData.count === 0) {
      this.sql.exec(`
        INSERT INTO test_data (name, value) VALUES 
        ('Sample 1', 100),
        ('Sample 2', 200),
        ('Sample 3', 300)
      `);
    }
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

    // Main testing page
    if (url.pathname === "/") {
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>ReadOnly Validator Test</title>
          <style>
            body { 
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
              max-width: 900px; 
              margin: 0 auto; 
              padding: 20px; 
              background-color: #f5f5f5;
            }
            .container {
              background: white;
              padding: 30px;
              border-radius: 8px;
              box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
            h1 { 
              color: #333; 
              text-align: center;
              margin-bottom: 30px;
            }
            .nav {
              text-align: center;
              margin-bottom: 30px;
            }
            .nav a {
              display: inline-block;
              padding: 10px 20px;
              background: #007acc;
              color: white;
              text-decoration: none;
              border-radius: 5px;
              margin: 0 10px;
            }
            .nav a:hover {
              background: #005a9e;
            }
            .query { 
              margin-bottom: 25px; 
              border: 1px solid #ddd; 
              padding: 20px; 
              border-radius: 8px; 
              background: #fafafa;
            }
            .query h3 {
              margin-top: 0;
              color: #333;
            }
            .query-sql {
              background: #2d3748;
              color: #e2e8f0;
              padding: 12px;
              border-radius: 4px;
              font-family: 'Courier New', monospace;
              font-size: 14px;
              margin: 10px 0;
              overflow-x: auto;
            }
            button { 
              padding: 10px 20px; 
              background: #0066cc; 
              color: white; 
              border: none; 
              border-radius: 5px; 
              cursor: pointer;
              font-size: 14px;
              margin-right: 10px;
            }
            button:hover {
              background: #0052a3;
            }
            button:disabled {
              background: #ccc;
              cursor: not-allowed;
            }
            .result {
              margin-top: 15px;
              min-height: 20px;
            }
            pre { 
              background: #f8f9fa; 
              padding: 15px; 
              border-radius: 4px; 
              overflow-x: auto;
              border-left: 4px solid #007acc;
              margin: 10px 0;
            }
            .success { 
              color: #28a745;
              font-weight: bold;
            }
            .error { 
              color: #dc3545;
              font-weight: bold;
            }
            .loading {
              color: #007acc;
              font-style: italic;
            }
            .query-info {
              font-size: 14px;
              color: #666;
              margin-bottom: 10px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>🔒 Read-Only Validator Test</h1>

            <div class="nav">
              <a href="/studio">Open Studio</a>
              <a href="#" onclick="clearAllResults()">Clear Results</a>
            </div>
            
            <div class="query">
              <h3>✅ Valid SELECT Query</h3>
              <div class="query-info">This should work - reading data is allowed</div>
              <div class="query-sql">SELECT * FROM test_data ORDER BY id</div>
              <button onclick="runQuery(1, 'SELECT * FROM test_data ORDER BY id')">Run Query</button>
              <div id="result1" class="result"></div>
            </div>
            
            <div class="query">
              <h3>✅ Valid COUNT Query</h3>
              <div class="query-info">Aggregate functions should work</div>
              <div class="query-sql">SELECT COUNT(*) as total, AVG(value) as avg_value FROM test_data</div>
              <button onclick="runQuery(2, 'SELECT COUNT(*) as total, AVG(value) as avg_value FROM test_data')">Run Query</button>
              <div id="result2" class="result"></div>
            </div>
            
            <div class="query">
              <h3>❌ Invalid INSERT Query</h3>
              <div class="query-info">This should be blocked - write operations not allowed</div>
              <div class="query-sql">INSERT INTO test_data (name, value) VALUES ('New Item', 400)</div>
              <button onclick="runQuery(3, 'INSERT INTO test_data (name, value) VALUES (\\'New Item\\', 400)')">Run Query</button>
              <div id="result3" class="result"></div>
            </div>
            
            <div class="query">
              <h3>❌ Invalid UPDATE Query</h3>
              <div class="query-info">This should be blocked - modifying data not allowed</div>
              <div class="query-sql">UPDATE test_data SET value = 999 WHERE id = 1</div>
              <button onclick="runQuery(4, 'UPDATE test_data SET value = 999 WHERE id = 1')">Run Query</button>
              <div id="result4" class="result"></div>
            </div>
            
            <div class="query">
              <h3>❌ Invalid DELETE Query</h3>
              <div class="query-info">This should be blocked - deleting data not allowed</div>
              <div class="query-sql">DELETE FROM test_data WHERE id = 2</div>
              <button onclick="runQuery(5, 'DELETE FROM test_data WHERE id = 2')">Run Query</button>
              <div id="result5" class="result"></div>
            </div>

            <div class="query">
              <h3>❌ Invalid CREATE Query</h3>
              <div class="query-info">This should be blocked - schema changes not allowed</div>
              <div class="query-sql">CREATE TABLE new_table (id INTEGER, data TEXT)</div>
              <button onclick="runQuery(6, 'CREATE TABLE new_table (id INTEGER, data TEXT)')">Run Query</button>
              <div id="result6" class="result"></div>
            </div>
          </div>
          
          <script>
            async function runQuery(resultId, sql) {
              const resultDiv = document.getElementById('result' + resultId);
              const button = event.target;
              
              // Disable button and show loading state
              button.disabled = true;
              button.textContent = 'Running...';
              resultDiv.innerHTML = '<p class="loading">⏳ Executing query...</p>';
              
              try {
                const response = await fetch('/query/raw?id=test-object', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json'
                  },
                  body: JSON.stringify({ sql })
                });
                
                const data = await response.json();
                
                if (data.error) {
                  resultDiv.innerHTML = \`
                    <p class="error">❌ Error: \${data.error}</p>
                  \`;
                } else {
                  const resultData = data.result;
                  let output = '<p class="success">✅ Query executed successfully!</p>';
                  
                  if (resultData && resultData.rows && Array.isArray(resultData.rows)) {
                    output += \`
                      <p><strong>Columns:</strong> \${resultData.columns ? resultData.columns.join(', ') : 'N/A'}</p>
                      <p><strong>Rows returned:</strong> \${resultData.rows.length}</p>
                      <p><strong>Rows read:</strong> \${resultData.meta?.rows_read || 0}</p>
                      <p><strong>Rows written:</strong> \${resultData.meta?.rows_written || 0}</p>
                    \`;
                    
                    if (resultData.rows.length > 0) {
                      output += '<pre>' + JSON.stringify(resultData.rows, null, 2) + '</pre>';
                    }
                  } else {
                    output += '<pre>' + JSON.stringify(resultData, null, 2) + '</pre>';
                  }
                  
                  resultDiv.innerHTML = output;
                }
              } catch (err) {
                resultDiv.innerHTML = \`
                  <p class="error">❌ Network Error: \${err.message}</p>
                \`;
              } finally {
                // Re-enable button
                button.disabled = false;
                button.textContent = 'Run Query';
              }
            }
            
            function clearAllResults() {
              for (let i = 1; i <= 6; i++) {
                const resultDiv = document.getElementById('result' + i);
                if (resultDiv) {
                  resultDiv.innerHTML = '';
                }
              }
            }
            
            // Add some helpful info on page load
            window.addEventListener('load', function() {
              const info = document.createElement('div');
              info.innerHTML = \`
                <div style="background: #e7f3ff; border: 1px solid #b3d9ff; padding: 15px; border-radius: 5px; margin-bottom: 20px;">
                  <strong>ℹ️ How this works:</strong><br>
                  This demo uses a <code>createReadOnlyValidator()</code> function that blocks any SQL statements starting with write operations like INSERT, UPDATE, DELETE, CREATE, DROP, etc.
                  Only SELECT queries and other read operations are allowed.
                </div>
              \`;
              document.querySelector('.container').insertBefore(info, document.querySelector('.query'));
            });
          </script>
        </body>
        </html>
      `;

      return new Response(html, {
        headers: { "Content-Type": "text/html;charset=utf8" },
      });
    }

    // Forward the request to the durable object
    return object.fetch(request);
  },
};
