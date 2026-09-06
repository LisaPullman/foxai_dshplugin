// External TCP probe — separate process, separate event loop
// stdout: single JSON line { result: bool, elapsed_ms: int }
const net = require('net');
const args = process.argv.slice(2);
const host = args[0] || '127.0.0.1';
const port = parseInt(args[1] || '0', 10);
const timeoutMs = parseInt(args[2] || '1500', 10);

const sock = net.createConnection({ host, port });
let done = false;
const start = Date.now();

function finish(result) {
  if (done) return;
  done = true;
  process.stdout.write(JSON.stringify({ result, elapsed_ms: Date.now() - start }) + '\n');
  process.exit(0);
}

sock.setTimeout(timeoutMs);
sock.once('connect', function () { finish(true); });
sock.once('timeout', function () { finish(false); sock.destroy(); });
sock.once('error', function () { finish(false); sock.destroy(); });

// Safety net: ensure exit even if all events missed
setTimeout(function () { finish(false); }, timeoutMs + 500);
