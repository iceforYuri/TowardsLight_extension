import { ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import * as vscode from 'vscode';
import { getProfile, getTemplateDir, stateStore } from './util';

/** 一个运行中的预览 server 的账本记录 */
export interface ServerRec {
  proc: ChildProcess;
  port: number;
  templateDir: string;
  profileDir: string;
  startedAt: number;
  /** 最近若干行输出(环缓冲),启动失败时拼进错误信息 */
  tail: string[];
  /** stdout 里 astro 报出了实际监听端口(防端口顺延时的误 ping) */
  bound: boolean;
}

const servers: ServerRec[] = [];
const panels = new Map<string, vscode.WebviewPanel>();
/** server 列表变化时通知预览区刷新 */
const emitter = new vscode.EventEmitter<void>();
export const onDidChangeServers = emitter.event;

let channel: vscode.OutputChannel | undefined;

/** 预览日志输出面板:所有 dev server 的 stdout/stderr 都逐行汇到这里 */
export function previewLog(): vscode.OutputChannel {
  if (!channel) channel = vscode.window.createOutputChannel('TowardsLight 预览');
  return channel;
}

export function disposePreviewLog(): void {
  channel?.dispose();
  channel = undefined;
}

export function listServers(): ServerRec[] {
  return servers;
}

/** 有任何 HTTP 响应即视为存活(某个页面 500 是内容问题,不代表 server 死了) */
async function ping(port: number): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch(`http://localhost:${port}/`, { signal: ctrl.signal });
    // 把 body 读完,避免悬挂 socket 堆积
    await res.arrayBuffer().catch(() => undefined);
    clearTimeout(timer);
    return true;
  } catch {
    return false;
  }
}

/**
 * TCP bind 测试:端口真空闲才算空闲。
 * 不能用 HTTP ping 判断——返回 500 的僵尸 server、Windows 保留端口段
 * 都会被 ping 误判成「空闲」,spawn 上去就是 EADDRINUSE。
 */
function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    // 与 astro 的绑定目标一致(localhost),避免「双栈探测通过、loopback 实际被占」
    srv.listen(port, 'localhost');
  });
}

/** 从 astro 输出里解析实际监听端口(端口被占时 astro 会自动顺延到下一个) */
function parseBoundPort(line: string): number | null {
  const m = line.match(/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1?\]):(\d+)/);
  return m ? Number(m[1]) : null;
}

/**
 * 把子进程输出按行写进输出面板并维护 tail 缓冲。
 * 必须持续消费 stdout/stderr:管道缓冲区写满后 astro 会阻塞在日志写入上,
 * 整个 dev server 随之停摆(此前「用着用着就卡死」的主因)。
 */
function attachOutput(rec: ServerRec): void {
  const buffers = { out: '', err: '' };
  const push = (stream: 'out' | 'err', chunk: Buffer): void => {
    buffers[stream] += chunk.toString('utf8');
    const lines = buffers[stream].split(/\r?\n/);
    buffers[stream] = lines.pop() ?? '';
    for (const line of lines) {
      previewLog().appendLine(`[${rec.port}] ${line}`);
      rec.tail.push(line);
      if (rec.tail.length > 60) rec.tail.shift();
      const bound = parseBoundPort(line);
      if (bound && bound !== rec.port) {
        previewLog().appendLine(`[${rec.port}] astro 实际监听在 ${bound},已跟随`);
        rec.port = bound;
        persistServers();
        emitter.fire();
      }
      if (bound) rec.bound = true;
    }
  };
  rec.proc.stdout?.on('data', (c: Buffer) => push('out', c));
  rec.proc.stderr?.on('data', (c: Buffer) => push('err', c));
}

function kill(rec: ServerRec): void {
  if (process.platform === 'win32' && rec.proc.pid) {
    spawn('taskkill', ['/pid', String(rec.proc.pid), '/t', '/f'], { stdio: 'ignore' });
  } else {
    rec.proc.kill();
  }
}

// ── 跨会话进程账本:Reload Window 会清空内存里的 servers,但子进程还活着 ──
const STATE_KEY = 'towardsLight.runningServers';

interface PersistedServer {
  pid: number;
  port: number;
  templateDir: string;
  profileDir: string;
}

function persistServers(): void {
  try {
    const list: PersistedServer[] = servers
      .filter((s) => s.proc.pid)
      .map((s) => ({
        pid: s.proc.pid as number,
        port: s.port,
        templateDir: s.templateDir,
        profileDir: s.profileDir,
      }));
    void stateStore().update(STATE_KEY, list);
  } catch {
    /* 未激活时跳过 */
  }
}

/** activate 时调用:上次会话拉起的 server 已无人记账,按 PID 逐个回收 */
export function reapOrphanServers(): void {
  let list: PersistedServer[];
  try {
    list = stateStore().get<PersistedServer[]>(STATE_KEY, []);
  } catch {
    return;
  }
  for (const rec of list) {
    let alive = false;
    try {
      process.kill(rec.pid, 0);
      alive = true;
    } catch {
      /* 进程已不在 */
    }
    if (!alive) continue;
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(rec.pid), '/t', '/f'], { stdio: 'ignore' });
    } else {
      try {
        process.kill(rec.pid);
      } catch {
        /* 忽略 */
      }
    }
  }
  void stateStore().update(STATE_KEY, []);
}

export function stopServer(rec: ServerRec): void {
  previewLog().appendLine(`[${rec.port}] 已停止`);
  kill(rec);
  const i = servers.indexOf(rec);
  if (i >= 0) servers.splice(i, 1);
  persistServers();
  emitter.fire();
}

/**
 * 启动预览:同组合(模板+档案)的 server 还活着就直接复用;
 * 否则从配置端口起向后找空闲端口,在模板目录 spawn npm run dev。
 * 只复用自己记账的 server,不动用户终端里手动起的。
 *
 * 单预览纪律:junction(src/profiles/active)全局唯一,异档案 server 并存必然互踩。
 * 主防线在「切换档案即停旧 server」(switchProfile);这里的过滤是兜底。
 */
export async function startPreview(): Promise<ServerRec> {
  const templateDir = getTemplateDir();
  const profile = getProfile();
  const log = previewLog();

  const existing = servers.find(
    (s) => s.templateDir === templateDir && s.profileDir === profile.dir,
  );
  if (existing && (await ping(existing.port))) {
    log.appendLine(`[${existing.port}] 复用运行中的 server`);
    return existing;
  }
  if (existing) stopServer(existing);

  for (const stale of servers.filter(
    (s) => s.templateDir === templateDir && s.profileDir !== profile.dir,
  )) {
    log.appendLine(`[${stale.port}] 档案已切换,停止旧 server(${stale.profileDir})`);
    stopServer(stale);
  }

  const preferred = vscode.workspace
    .getConfiguration('towardsLight')
    .get<number>('devPort', 4321);
  let port = preferred;
  while (!(await portFree(port))) port++;

  const cmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  log.appendLine(`—— 启动 dev server:模板 ${templateDir} | 档案 ${profile.dir} | 端口 ${port} ——`);
  const proc = spawn(cmd, ['run', 'dev', '--', '--port', String(port)], {
    cwd: templateDir,
    env: { ...process.env, SITE_PROFILE_DIR: profile.dir },
    // Windows 上新版 Node 直接 spawn .cmd 会抛 EINVAL,走 shell
    shell: process.platform === 'win32',
    windowsHide: true,
  });
  const rec: ServerRec = {
    proc,
    port,
    templateDir,
    profileDir: profile.dir,
    startedAt: Date.now(),
    tail: [],
    bound: false,
  };
  attachOutput(rec);

  // 装在对象里:TS 不会把回调里的赋值纳入控制流分析,裸 let 会被窄化成 null/never
  const status = { spawnError: null as Error | null, exitCode: null as number | null };
  proc.on('error', (e) => {
    status.spawnError = e;
  });
  proc.on('exit', (code) => {
    status.exitCode = code ?? -1;
    log.appendLine(`[${rec.port}] 进程已退出(code=${status.exitCode})`);
    const i = servers.indexOf(rec);
    if (i >= 0) servers.splice(i, 1);
    persistServers();
    emitter.fire();
  });

  /** 启动失败:带上输出末尾几行,并亮出日志面板,不让错误石沉大海 */
  const fail = (reason: string): never => {
    kill(rec);
    const tail = rec.tail.filter((l) => l.trim()).slice(-6).join('\n');
    log.show(true);
    throw new Error(
      tail
        ? `${reason}(详见输出面板「TowardsLight 预览」)\n—— dev server 输出末尾 ——\n${tail}`
        : `${reason},输出面板「TowardsLight 预览」里没有任何日志`,
    );
  };

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (status.spawnError) fail(`无法启动 npm:${status.spawnError.message}`);
    if (status.exitCode !== null) fail(`dev server 启动后即退出(code=${status.exitCode})`);
    // 就绪 = astro 自报端口(防顺延时的误 ping)+ 该端口确有 HTTP 响应
    if (rec.bound && (await ping(rec.port))) {
      servers.push(rec);
      persistServers();
      emitter.fire();
      log.appendLine(`[${rec.port}] 就绪:http://localhost:${rec.port}/`);
      return rec;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return fail('dev server 启动超时(30s)');
}

/** 通用 iframe 预览面板 */
function openPanel(key: string, title: string, port: number, route: string): void {
  const existing = panels.get(key);
  if (existing) {
    existing.reveal(vscode.ViewColumn.Beside);
    return;
  }
  const panel = vscode.window.createWebviewPanel(
    'towardsLightPreview',
    title,
    vscode.ViewColumn.Beside,
    { enableScripts: false, retainContextWhenHidden: true },
  );
  panel.webview.html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src http://localhost:* http://127.0.0.1:*; style-src 'unsafe-inline';">
<style>html,body{margin:0;height:100%;overflow:hidden}iframe{border:0;width:100%;height:100%;display:block}</style>
</head>
<body><iframe src="http://localhost:${port}${route}"></iframe></body>
</html>`;
  panel.onDidDispose(() => panels.delete(key));
  panels.set(key, panel);
}

/** 预览整站首页 */
export async function openSitePreview(rec: ServerRec): Promise<void> {
  openPanel('site', `预览:${path.basename(rec.profileDir)}`, rec.port, '/');
}

export async function openPostPreview(file: string | undefined): Promise<void> {
  if (!file || !file.endsWith('.md')) {
    vscode.window.showInformationMessage('先在文章树里选一篇文章,或打开一篇 .md');
    return;
  }
  const slug = path.basename(file).replace(/\.md$/, '');
  const rec = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: '正在连接 dev server…' },
    () => startPreview(),
  );
  openPanel(`post:${slug}`, `预览:${slug}`, rec.port, `/posts/${slug}`);
}

/** 扩展停用时回收所有自己拉起的 server */
export function disposeServer(): void {
  for (const rec of [...servers]) kill(rec);
  servers.length = 0;
  persistServers();
  emitter.fire();
}

// ── junction 变更感知:外部进程(终端 dev/build)重指向时可见 ──
let watchTimer: ReturnType<typeof setInterval> | undefined;
let lastLinkTarget: string | null = null;

/** 读 active junction 的实际指向;切换的 unlink/symlink 窗口期返回 null(下一拍再看) */
function currentJunctionTarget(): string | null {
  const link = path.join(getTemplateDir(), 'src', 'profiles', 'active');
  try {
    return path.resolve(path.dirname(link), fs.readlinkSync(link));
  } catch {
    return null;
  }
}

/**
 * 每 2s 读一次 junction 指向。指向变化:始终记输出面板;
 * 与扩展当前绑定不一致(终端起了别的档案、手动跑了 use-profile)再轻提醒。
 * 扩展自己起的 server 换档前会先同步绑定,所以变化与绑定一致时静默。
 */
export function startJunctionWatch(): void {
  stopJunctionWatch();
  try {
    lastLinkTarget = currentJunctionTarget();
  } catch {
    return; // 模板未识别,预览区会引导
  }
  watchTimer = setInterval(() => {
    let target: string | null;
    try {
      target = currentJunctionTarget();
    } catch {
      return; // 模板突然不可用,跳过本拍
    }
    if (target === lastLinkTarget) return;
    lastLinkTarget = target;
    const log = previewLog();
    log.appendLine(`[watch] 档案指向变为 ${target ?? '(缺失)'}`);
    if (!target) return;
    let bound: string;
    try {
      bound = path.resolve(getProfile().dir);
    } catch {
      return;
    }
    if (path.resolve(target) === bound) return; // 与绑定一致,自己人换的
    void vscode.window
      .showWarningMessage(
        `档案指向被外部改为「${path.basename(target)}」,与当前扩展绑定不一致,预览内容可能已变化`,
        '查看日志',
      )
      .then((a) => {
        if (a) log.show(true);
      });
  }, 2000);
  watchTimer.unref?.();
}

export function stopJunctionWatch(): void {
  if (watchTimer) clearInterval(watchTimer);
  watchTimer = undefined;
}
