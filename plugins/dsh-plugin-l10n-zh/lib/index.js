/**
 * dsh-plugin-l10n-zh 的宿主插件入口。
 *
 * 两件事：
 *   1. **安装 / 更新后**：监听 `plugin-manager/changed`（manager 每次操作完成都会发），
 *      去抖后跑一遍汉化，把新装插件的中文 title / description 补进它的 `locale/`。
 *   2. **启动时**：跑一遍补齐（离线期间装的、上次没跑完的），保证下次看到的一定是中文。
 *
 * 设计约束：
 *   · 绝不阻塞、绝不抛错 —— 任何异常只写日志，不影响 DSH 主流程。
 *   · 单飞 —— 同一时刻只有一个汉化任务；运行中再来事件就排队，结束后补跑一次。
 *   · 结果落 `~/.dsh/plugin-l10n-zh/log.ndjson`，方便事后查。
 *
 * @module dsh-plugin-l10n-zh
 */

import { appendFile, mkdir } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-plugin-l10n-zh'

/** 只探测，不硬依赖：没有 pluginManager 也要能加载（例如纯 CLI 场景）。 */
export const inject = []

/** 安装状态变化后等待多久再跑（等 pnpm 落完盘、HMR 稳定）。 */
const DEBOUNCE_MS = 800

/** 上一次运行结束到下一次运行之间的最短间隔，防止连环事件把 API 打爆。 */
const MIN_INTERVAL_MS = 5_000

/**
 * 读配置：环境变量优先，其次空对象。
 * @returns {{enabled:boolean, apiKey:string|undefined, model:string, timeoutMs:number}} 配置。
 */
function readConfig() {
  return {
    enabled: process.env.DSH_PLUGIN_L10N_ZH !== '0',
    apiKey: process.env.DEEPSEEK_API_KEY,
    model: process.env.DSH_PLUGIN_L10N_ZH_MODEL ?? 'deepseek-flash',
    timeoutMs: 30_000,
  }
}

/**
 * 追加一行 NDJSON 日志；失败静默（日志永远不该成为故障点）。
 * @param {string} dir 日志目录。
 * @param {object} record 日志记录。
 * @returns {Promise<void>} 完成即写完。
 */
async function logLine(dir, record) {
  try {
    await mkdir(dir, { recursive: true })
    await appendFile(join(dir, 'log.ndjson'), `${JSON.stringify({ at: new Date().toISOString(), ...record })}\n`, 'utf8')
  } catch {
    /* 日志写不了就算了 */
  }
}

/**
 * 宿主插件主体。
 * @param {import('@deepseek-ai/cordis').Context} ctx 宿主上下文。
 * @returns {void} 无返回值。
 */
export function apply(ctx) {
  const config = readConfig()
  if (!config.enabled) {
    ctx.logger?.info?.('dsh-plugin-l10n-zh: 已通过 DSH_PLUGIN_L10N_ZH=0 关闭')
    return
  }

  const logs = join(homedir(), '.dsh', 'plugin-l10n-zh')
  const profileDir = process.env.DSH_PROFILE_DIR ?? undefined
  const logger = {
    info: (message) => ctx.logger?.info?.(message),
    warn: (message) => ctx.logger?.warn?.(message),
  }

  // 加载即写一行「我醒了」：不依赖任何定时器，用来确证插件真的进了 app 进程。
  void logLine(logs, { event: 'apply', profileDir: profileDir ?? null, pid: process.pid, node: process.version })

  /** 当前是否在跑；跑的时候来事件就置 pending。 */
  let running = false
  let pending = false
  let lastFinishedAt = 0
  let timer

  /**
   * 跑一遍汉化；单飞 + 排队。
   * @param {string} reason 触发原因，进日志。
   * @returns {Promise<void>} 完成即结束。
   */
  async function run(reason) {
    if (running) {
      pending = true
      return
    }
    running = true
    const startedAt = Date.now()
    try {
      const { createTranslator } = await import('./deepseek-translator.mjs')
      const localize = await import('./localize.mjs')
      const glossary = await loadGlossary()
      const translator = createTranslator({
        apiKey: config.apiKey,
        model: config.model,
        timeoutMs: config.timeoutMs,
        logger,
        glossary,
        cachePath: join(logs, 'cache.json'),
      })
      const report = await localize.run({
        translator,
        profileDir,
        logger,
        backupRoot: join(logs, 'backup'),
      })
      await translator.save()
      await logLine(logs, { event: 'run', reason, ...report })
      if (report.translated.length > 0) {
        logger.info(
          `dsh-plugin-l10n-zh: 已汉化 ${report.translated.map((row) => row.name).join('、')}（刷新页面即见）`,
        )
      } else if (report.failed.length > 0 || report.items > 0) {
        await logLine(logs, { event: 'noop', reason, failed: report.failed })
      }
    } catch (error) {
      const message = String(error?.stack ?? error)
      logger.warn(`dsh-plugin-l10n-zh: 运行失败：${message}`)
      await logLine(logs, { event: 'error', reason, message })
    } finally {
      running = false
      lastFinishedAt = Date.now()
      if (pending) {
        pending = false
        const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - startedAt))
        timer = setTimeout(() => void run('queued'), wait)
        timer.unref?.()
      }
    }
  }

  /**
   * 去抖后触发一次运行。
   * @param {string} reason 触发原因。
   * @returns {void} 无返回值。
   */
  function schedule(reason) {
    if (timer !== undefined) clearTimeout(timer)
    const sinceLast = Date.now() - lastFinishedAt
    const delay = Math.max(DEBOUNCE_MS, Math.max(0, MIN_INTERVAL_MS - sinceLast))
    timer = setTimeout(() => void run(reason), delay)
    timer.unref?.()
  }

  // 1) 安装 / 更新 / 卸载完成后
  ctx.on('plugin-manager/changed', (change) => {
    schedule(`changed:${change?.reason ?? 'unknown'}`)
  })

  // 2) 启动补齐：等一等，让 Loader 先把树装好
  const bootTimer = setTimeout(() => void run('boot'), 2_500)
  bootTimer.unref?.()

  // 3) 手动触发入口（也便于我在会话里直接调）
  // 必须用 provide 而不是 set：ctx.set 只能改写「已 provide 的属性」，
  // 对一个没声明过的新名字会抛 `cannot set property "..." without provide`，
  // 让整个 apply 失败 —— 插件页显示「启动失败」，而且 apply 里注册的
  // 事件监听会被 Cordis 回滚（装/更新插件后就不再自动汉化）。
  ctx.provide?.('pluginL10nZh', {
    /**
     * 手动跑一次。
     * @returns {Promise<void>} 完成即结束。
     */
    run: () => run('manual'),
    /**
     * 读最近一次状态。
     * @returns {{profileDir:string|undefined, running:boolean, lastFinishedAt:number}} 状态快照。
     */
    state: () => ({ profileDir, running, lastFinishedAt }),
  })

  ctx.effect?.(() => () => {
    if (timer !== undefined) clearTimeout(timer)
    clearTimeout(bootTimer)
  })
}

/**
 * 读术语表；文件缺失或损坏时返回空表（翻译器会退化成纯 API 模式）。
 * @returns {Promise<Record<string,string>>} 术语表。
 */
async function loadGlossary() {
  try {
    const file = fileURLToPath(new URL('./glossary.json', import.meta.url))
    if (!existsSync(file)) return {}
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return {}
  }
}
