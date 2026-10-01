/**
 * 预览启动逻辑冒烟测试:复刻扩展新版 spawn 链路在真实模板上跑一遍。
 * 验证:端口 bind 探测 / stdout 持续消费 / Local URL 端口解析 / ping 就绪 / 进程回收。
 * 用法:node scripts/smoke-preview.mjs
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const PROFILE = path.join(ROOT, 'personal');
const PORT = 4399;

function portFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port);
  });
}

async function ping(port) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch(`http://localhost:${port}/`, { signal: ctrl.signal });
    await res.arrayBuffer().catch(() => undefined);
    clearTimeout(timer);
    return true;
  } catch {
    return false;
  }
}

const assert = (cond, msg) => {
  if (!cond) {
    console.error(`  ✗ ${msg}`);
    process.exit(1);
  }
  console.log(`  ✓ ${msg}`);
};

assert(await portFree(PORT), `端口 ${PORT} 空闲(bind 探测)`);

const proc = spawn('npm.cmd', ['run', 'dev', '--', '--port', String(PORT)], {
  cwd: ROOT,
  env: { ...process.env, SITE_PROFILE_DIR: PROFILE },
  shell: true,
  windowsHide: true,
});

let lines = 0;
let bound = null;
let exited = null;
let spawnError = null;
let buf = '';
proc.stdout.on('data', (c) => {
  buf += c.toString('utf8');
  const parts = buf.split(/\r?\n/);
  buf = parts.pop() ?? '';
  for (const line of parts) {
    lines++;
    const m = line.match(/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1?\]):(\d+)/);
    if (m && !bound) bound = Number(m[1]);
  }
});
proc.stderr.on('data', () => lines++);
proc.on('error', (e) => (spawnError = e));
proc.on('exit', (code) => (exited = code ?? -1));

const deadline = Date.now() + 30_000;
let ready = false;
while (Date.now() < deadline) {
  if (spawnError) break;
  if (exited !== null) break;
  if (bound && (await ping(bound))) {
    ready = true;
    break;
  }
  await new Promise((r) => setTimeout(r, 400));
}

assert(!spawnError, `spawn 无错误${spawnError ? ':' + spawnError.message : ''}`);
assert(exited === null, 'server 未提前退出');
assert(lines > 0, `stdout 持续有输出并被消费(${lines} 行)`);
assert(bound === PORT, `解析到实际监听端口 ${bound}`);
assert(ready, 'ping 就绪');

spawn('taskkill', ['/pid', String(proc.pid), '/t', '/f'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1500));
assert(!(await ping(PORT)), 'taskkill 后 server 已回收');
console.log('冒烟测试通过');
