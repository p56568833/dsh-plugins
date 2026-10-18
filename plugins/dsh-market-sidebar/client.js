/**
 * dsh-market-sidebar 的浏览器半边。
 *
 * 手写的 loader 闭包工厂格式（没有打包器这一步）：`window.__ModuleLoader__.load`
 * 注册一个工厂，工厂里是 CJS，`module.exports` 就是一个普通的 cordis 插件。
 *
 * 它在 DSH 本体自己的槽位上登记三行（不是改别人的包）：
 *
 *   sidebar.panellist  → 侧边栏那个平级列表；「插件」那一行就是它
 *                        （ui-plugin-manager 登记 id "plugins"、order 0）。
 *                        插件市场 order 1、订阅 order 2，按「插件 / 插件市场 / 订阅」排。
 *                        账号与余额（order 3）的代码还在，但默认不登记
 *                        —— 余额已由 dsh-balance-widget 的页脚卡片显示。
 *   main               → ui-layout 的键槽；侧边栏点击后用同一个 id 来这里取面板。
 *   market.setSettingsVisible(false) → 顺带把市场从**设置**里请走，入口只留侧边栏
 *                        这一处（本插件被关掉时再放回去）。
 *
 * 「订阅」和「账号与余额」这两页同样不自己画：分别取 dsh-plugin-subscriptions 与
 * DSH 账号插件登记在 `settings.section`（id "subscriptions" / "account"）里的那个
 * 组件直接渲染。把订阅这一行做在**本插件**里比改订阅插件的包耐久得多 —— 那个包
 * 在插件市场升级时会被整包替换，而 2026-09-27 那版打在它 client.js 里的侧栏补丁
 * 就在 2026-10-03 的 0.9.4 → 0.9.7 升级中丢了一次。
 *
 * 面板本体不自己画：dshmarket 的浏览器半边把整块市场面板通过
 * `ctx.market.render()` 交出来（那是它给「宿主 shell 自己渲染市场」准备的接口，
 * 见它的 src/client/index.ts / market-element.ts）。所以市场长什么样、有哪些
 * 子页，全由 dshmarket 自己决定，这里只负责把它挂上去 —— 上游更新不会让这个
 * 包过期，也不需要跟着改一行代码。
 *
 * market 服务用**嵌套** ctx.inject 等（不是顶层必需依赖）：dshmarket 没装/没启用时
 * 这个插件照样是 active、只是什么都不登记 —— 侧边栏不会凭空多出一行，设置里那份
 * 也原样留着。为什么非要嵌套写，见下面 exports.inject 处的注释（顶层必需依赖会让
 * 整个界面启动失败）。
 *
 * @module dsh-market-sidebar/client
 */

window.__ModuleLoader__.load({
  id: 'dsh-market-sidebar',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const react = require('react')

    /** 本插件自己的文案命名空间。 */
    const NS = 'market-sidebar'
    /** 侧边栏那一行与它打开的 main 面板共用同一个 id。 */
    const PANEL_ID = 'market'

    const zh = {
      nav: '插件市场',
      accountNav: '账号与余额',
      accountSignedOut: '还没有登录 DeepSeek 账号。登录后，这里会直接显示账号信息和余额。',
      accountRenderFailed: '账号页面没能在这里显示出来，可以先到设置里查看。',
      accountOpenSettings: '在设置里打开',
      subscriptionsNav: '订阅',
      subscriptionsMissing: '没有找到订阅插件的设置页。装上并启用 dsh-plugin-subscriptions 后，这里会直接显示它。',
      subscriptionsRenderFailed: '订阅页面没能在这里显示出来，可以先到设置里查看。',
      subscriptionsOpenSettings: '在设置里打开',
    }
    const en = {
      nav: 'Plugin Market',
      accountNav: 'Account & Balance',
      accountSignedOut: 'Not signed in to a DeepSeek account. After signing in, your account and balance appear here.',
      accountRenderFailed: 'The account page could not be shown here. You can still open it in Settings.',
      accountOpenSettings: 'Open in Settings',
      subscriptionsNav: 'Subscriptions',
      subscriptionsMissing: 'The subscriptions settings page is not registered. Install and enable dsh-plugin-subscriptions and it shows up here.',
      subscriptionsRenderFailed: 'The subscriptions page could not be shown here. You can still open it in Settings.',
      subscriptionsOpenSettings: 'Open in Settings',
    }

    /**
     * dshmarket 的品牌标记（8 格 + 斜插的那一块），几何数字抄自它自己的
     * `src/client/market-mark.ts`（MARK_BLOCK_* / MARK_VIEW_BOX / MARK_PLUG_BLOCK）。
     *
     * 为什么要抄：侧边栏这一行和设置里那一行指的是同一个东西，就该长同一个样。
     * dshmarket 把标记同时画成 React 组件和 CSS mask，但那个组件是它 bundle 的
     * 内部实现，不对外导出；模块系统的 external 只能解析到「包」这一级，拿不到
     * 它的内部符号。所以这里按同一份几何重画一次 —— 纯静态图形，抄错了最多是
     * 图标略有出入，不会影响功能。
     */
    const MARK = {
      viewBox: 16,
      block: 3.3,
      radius: 0.53,
      grid: [
        [1.96, 3.36], [5.71, 3.36],
        [1.96, 7.11], [5.71, 7.11], [9.46, 7.11],
        [1.96, 10.86], [5.71, 10.86], [9.46, 10.86],
      ],
      plug: { x: 10.74, y: 2.09, degrees: 9, originX: 12.39, originY: 3.74 },
    }

    /**
     * 侧边栏那一行的图标。槽位把 `{ size, active }` 传进来，和「插件」那一行
     * 的组件收到的是同一组 props。
     * @param {{ size?: number }} props - 槽位给的尺寸，折叠时 18、展开时 16。
     * @returns {unknown} 16×16 的 currentColor SVG。
     */
    function MarketPanelIcon({ size = 16 }) {
      const block = (x, y) => react.createElement('rect', {
        key: `${x},${y}`,
        x, y,
        width: MARK.block,
        height: MARK.block,
        rx: MARK.radius,
      })
      return react.createElement('svg', {
        width: size,
        height: size,
        viewBox: `0 0 ${MARK.viewBox} ${MARK.viewBox}`,
        fill: 'none',
        xmlns: 'http://www.w3.org/2000/svg',
        'aria-hidden': 'true',
      },
      react.createElement('g', { fill: 'currentColor' }, ...MARK.grid.map(([x, y]) => block(x, y))),
      react.createElement('rect', {
        x: MARK.plug.x,
        y: MARK.plug.y,
        width: MARK.block,
        height: MARK.block,
        rx: MARK.radius,
        fill: 'currentColor',
        transform: `rotate(${MARK.plug.degrees} ${MARK.plug.originX} ${MARK.plug.originY})`,
      }))
    }

    /**
     * 页面外壳：市场自己的根节点是 `height:100%` 的 flex 列、内部自己滚动，
     * 所以要给它一个有界高度，再补上和 Plugins 页同一档的左右留白与顶部
     * 安全区（macOS 隐藏标题栏时 `--dsh-frame-top-clearance` 由框架给出）。
     */
    const PANEL_STYLE = {
      boxSizing: 'border-box',
      height: '100%',
      minHeight: 0,
      display: 'flex',
      flexDirection: 'column',
      padding: '0 clamp(24px, 4vw, 48px) 0',
      paddingTop: 'calc(24px + var(--dsh-frame-top-clearance, 0px))',
    }

    /* ── 账号与余额（2026-09-27 加；2026-10-03 默认关）──────────────────────
     *
     * 把设置里第一栏「账号与余额」也挂到侧边栏：「插件 / 插件市场 / 订阅」下面一行，
     * 点一下主区域直接是账号页。和市场一样**不自己画**：账号页是 DSH 自带的
     * @deepseek-ai/dsh-client-ui-settings-account 登记在 `settings.section`
     * （id "account"）上的那个组件，这里从槽位账本里取出来直接渲染 ——
     * 余额格式、充值 / 查询用量按钮、登录态全部由它自己负责。
     *
     * 账号插件只在「已登录」时才登记这一栏，没登录时这里显示一句提示和
     * 「在设置里打开」按钮，不会是一片空白。设置里那份原样保留。
     *
     * 2026-10-03：侧栏这一行默认关（accountRowEnabled = false）。装了
     * dsh-balance-widget 之后，余额/费用已经常驻在侧栏页脚（用户名上方），
     * 两个入口指的是同一份数据，用户要求把外面这个撤掉。下面这段实现保留。
     */

    /**
     * 侧栏「账号与余额」入口的开关。
     *
     * 2026-10-03 按用户要求关掉：余额已经由 dsh-balance-widget 的侧栏页脚卡片常驻
     * 显示（就在用户名上方），再留一个入口是同一份余额重复出现。实现
     * （registerAccountPanel 连同图标、主区域面板）原样留着 —— 想恢复改这里，
     * 或从控制台 `__testing.setAccountRowEnabled(true)`，不用重写一遍。
     *
     * @type {boolean}
     */
    let accountRowEnabled = false

    /** 侧边栏行 id = main 面板 key。不用 "account"，免得和别人的 main key 撞。 */
    const ACCOUNT_PANEL_ID = 'account-balance'
    /** DSH 账号插件在 settings.section 里登记的 id。 */
    const ACCOUNT_SECTION_ID = 'account'
    /** 订阅占了 order 2（插件 0、插件市场 1），所以账号与余额排到 3。 */
    const ACCOUNT_ORDER = 3

    /** 订阅那一行的 id = 它的 main 面板 key。 */
    const SUBSCRIPTIONS_PANEL_ID = 'account-subscriptions'
    /** dsh-plugin-subscriptions 在 settings.section 里登记的 id。 */
    const SUBSCRIPTIONS_SECTION_ID = 'subscriptions'
    /** 订阅是 order 2：紧跟在「插件市场」下面、排在「账号与余额」上面。 */
    const SUBSCRIPTIONS_ORDER = 2

    /**
     * 侧边栏图标：和设置里「账号与余额」同一个意思的人形轮廓。
     * @param {{ size?: number }} props - 槽位给的尺寸。
     * @returns {unknown} currentColor SVG。
     */
    function AccountPanelIcon({ size = 16 }) {
      return react.createElement('svg', {
        width: size,
        height: size,
        viewBox: '0 0 16 16',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.3,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        xmlns: 'http://www.w3.org/2000/svg',
        'aria-hidden': 'true',
      },
      react.createElement('circle', { cx: 8, cy: 5.4, r: 2.6 }),
      react.createElement('path', { d: 'M2.9 13.6c.6-2.5 2.7-4 5.1-4s4.5 1.5 5.1 4' }))
    }

    /**
     * 订阅那一行的图标：一张卡片（订阅 / 套餐的通用意思），
     * 和「插件市场」的品牌标记一样用 currentColor 跟随主题。
     * @param {{ size?: number }} props - 槽位给的尺寸。
     * @returns {unknown} currentColor SVG。
     */
    function SubscriptionsPanelIcon({ size = 16 }) {
      return react.createElement('svg', {
        width: size,
        height: size,
        viewBox: '0 0 16 16',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.3,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        xmlns: 'http://www.w3.org/2000/svg',
        'aria-hidden': 'true',
      },
      react.createElement('rect', { x: 2, y: 3.6, width: 12, height: 8.8, rx: 1.6 }),
      react.createElement('path', { d: 'M2 6.7h12' }),
      react.createElement('path', { d: 'M4.4 10.1h3.4' }))
    }

    /** 两页共用的外壳：自己滚动，内容限宽，卡片不至于拉得太长。 */
    const PANEL_PAGE_STYLE = {
      boxSizing: 'border-box',
      height: '100%',
      minHeight: 0,
      overflowY: 'auto',
      padding: 'calc(24px + var(--dsh-frame-top-clearance, 0px)) clamp(24px, 4vw, 48px) 48px',
    }
    const PANEL_INNER_STYLE = { maxWidth: 760 }
    const PANEL_TITLE_STYLE = { margin: '0 0 20px', fontSize: 24, fontWeight: 600 }
    const PANEL_NOTE_STYLE = {
      margin: '0 0 16px',
      fontSize: 14,
      lineHeight: '22px',
      color: 'var(--dsw-alias-label-secondary, inherit)',
    }
    const PANEL_BUTTON_STYLE = {
      height: 36,
      padding: '0 16px',
      border: '1px solid var(--dsw-alias-border-l2)',
      borderRadius: 'var(--dsw-radius-md, 8px)',
      background: 'transparent',
      color: 'var(--dsw-alias-label-primary)',
      font: 'inherit',
      fontSize: 14,
      cursor: 'pointer',
    }

    /**
     * 某一页渲染出错时只影响这一块：换成提示 + 「在设置里打开」。
     * @param {{ fallback: unknown, label?: string, children?: unknown }} props - 兜底元素与出错时的日志名。
     */
    class PanelBoundary extends react.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }

      static getDerivedStateFromError(error) {
        return { error }
      }

      componentDidCatch(error) {
        console.warn(`[market-sidebar] ${this.props?.label ?? '页面'}在主区域渲染失败，改为显示「在设置里打开」`, error)
      }

      render() {
        return this.state.error ? this.props.fallback : this.props.children
      }
    }

    /** cordis 插件名。 */
    exports.name = 'dsh-market-sidebar'
    /**
     * 顶层只依赖一定存在的 slots / locale。
     *
     * `market`（dshmarket 提供的服务）**故意不写在这里**：DSH 的 web 启动审计要求
     * 每个 Loader entry 最终都必须是 active，任何「在等一个永远不会来的服务」的 entry
     * 都会让整个界面启动失败（`web boot: N entry did not activate` → 桌面端判 fatal）。
     * 用嵌套的 ctx.inject 就只是「服务来了再登记」，插件本身照常 active ——
     * dshmarket 自己处理可选服务用的也是这个写法。
     */
    exports.inject = ['slots', 'locale']

    /**
     * 打开设置弹窗并直接停在某一栏。设置外壳把自己的 store 挂在
     * `sidebar.settings` 那一行上，actions.openSection(id) 就是它自己用的入口。
     * @param {any} ctx - 浏览器端插件上下文。
     * @param {string} id - settings.section 的 id。
     */
    function openSettingsSection(ctx, id) {
      try {
        const shell = ctx.slots.entries('sidebar.settings')[0]
        const actions = shell?.store?.create?.()?.actions
        if (typeof actions?.openSection === 'function') actions.openSection(id)
        else if (typeof actions?.open === 'function') actions.open()
      } catch (error) {
        console.warn('[market-sidebar] 打开设置失败', error)
      }
    }

    /**
     * 两页共用的兜底提示：一句话 + 一个「在设置里打开」按钮。
     * @param {{ text: string, action: string, onOpen: () => void }} props - 文案与动作。
     * @returns {unknown} 元素。
     */
    const Notice = ({ text, action, onOpen }) => react.createElement('div', null,
      react.createElement('p', { style: PANEL_NOTE_STYLE }, text),
      react.createElement('button', { type: 'button', style: PANEL_BUTTON_STYLE, onClick: onOpen }, action))

    /**
     * 把 `hooks` 里的一个外部 store 变成槽位运行时会给的 `use<Name>(selector)`。
     * 不用 useSyncExternalStore：theme 的 getSnapshot 每次可能返回新对象，
     * 那样会被 React 当成无限更新；这里改成「订阅到变化就重渲一次」。
     * @param {{ getSnapshot: () => any, subscribe: (fn: () => void) => () => void }} store
     * @returns {(selector?: (value: any) => any) => any} Hook。
     */
    const hookCache = new WeakMap()
    const hookOf = (store) => {
      if (hookCache.has(store)) return hookCache.get(store)
      const useStore = (selector) => {
        const [, bump] = react.useReducer((n) => n + 1, 0)
        react.useEffect(() => store.subscribe(() => bump()), [])
        const value = store.getSnapshot()
        return typeof selector === 'function' ? selector(value) : value
      }
      hookCache.set(store, useStore)
      return useStore
    }

    /**
     * 按槽位运行时的规则，把某一栏登记时给的 inject() 拼成组件 props：
     * 普通字段原样传，`hooks.xxx` 变成 `useXxx`；`t` 优先用它自己给的那个
     * （每一栏都带着自己命名空间的 t），没给才退回本插件的兜底文案。
     * @param {any} entry - settings.section 里的那一行。
     * @param {(key: string) => string} fallbackT - 兜底文案。
     * @returns {any} 该栏组件的 props。
     */
    function slotProps(entry, fallbackT) {
      const { hooks = {}, ...rest } = entry.inject?.() ?? {}
      const props = { ...rest, t: rest.t ?? fallbackT, close: () => {} }
      for (const [name, store] of Object.entries(hooks)) {
        if (store && typeof store.getSnapshot === 'function' && typeof store.subscribe === 'function') {
          props[`use${name[0].toUpperCase()}${name.slice(1)}`] = hookOf(store)
        }
      }
      return props
    }

    /**
     * 登记「账号与余额」这一行和它的主区域面板。不依赖任何可选服务，
     * 所以不会影响 DSH 的启动审计。
     * @param {any} ctx - 浏览器端插件上下文。
     * @param {(key: string) => string} t - 本插件的文案。
     */
    function registerAccountPanel(ctx, t) {
      /** @returns {any} DSH 账号插件在设置里登记的那一栏（没登录时不存在）。 */
      const accountEntry = () => ctx.slots.entries('settings.section')
        .find((entry) => entry.options.id === ACCOUNT_SECTION_ID)

      /** DSH 账号插件的文案命名空间（它登记 settings.section 时用的 locale）。 */
      const accountT = ctx.locale.bind('settings.account')
      /** 兜底提示里的按钮：跳到设置的 account 栏。 */
      const openAccountSettings = () => openSettingsSection(ctx, ACCOUNT_SECTION_ID)

      /**
       * 主区域的账号页：直接拿 DSH 账号插件登记在 settings.section 里的那个组件
       * （AccountSection）来渲染，props 按槽位运行时的规则拼好。
       *
       * 为什么不用 renderSlot：DSH 的 renderSlot 只允许渲染「自己这一行声明过的子槽」，
       * 越界会抛 SlotOwnershipError（slots 包里写明了）；settings.section 是设置外壳
       * 声明的，主区域这一行渲染不了，第二版就是这样渲出一片空白的。
       * @returns {unknown} 页面元素。
       */
      function AccountPanel() {
        const [, bump] = react.useReducer((n) => n + 1, 0)
        // account 栏会随登录 / 退出登记或撤掉，跟着重渲。
        react.useEffect(() => (typeof ctx.slots.subscribe === 'function'
          ? ctx.slots.subscribe('settings.section', () => bump())
          : undefined), [])

        const entry = accountEntry()

        // 打开这一页时读一次最新余额（和打开设置时一样）。
        react.useEffect(() => {
          if (entry === undefined) return
          try {
            const pending = entry.inject?.()?.refreshAccount?.()
            if (pending && typeof pending.catch === 'function') pending.catch(() => {})
          } catch {
            // 用已有数据显示即可。
          }
        }, [entry === undefined])

        let body
        if (entry !== undefined && typeof entry.component === 'function') {
          body = react.createElement(PanelBoundary, {
            label: '账号页',
            fallback: react.createElement(Notice, {
              text: t('accountRenderFailed'),
              action: t('accountOpenSettings'),
              onOpen: openAccountSettings,
            }),
          }, react.createElement(entry.component, slotProps(entry, accountT)))
        } else {
          body = react.createElement(Notice, {
            text: t('accountSignedOut'),
            action: t('accountOpenSettings'),
            onOpen: openAccountSettings,
          })
        }

        return react.createElement('div', { style: PANEL_PAGE_STYLE },
          react.createElement('div', { style: PANEL_INNER_STYLE },
            react.createElement('h1', { style: PANEL_TITLE_STYLE }, t('accountNav')),
            body))
      }

      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: ACCOUNT_PANEL_ID,
        order: ACCOUNT_ORDER,
        label: () => t('accountNav'),
        locale: NS,
      }, AccountPanelIcon))

      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: ACCOUNT_PANEL_ID,
        locale: NS,
      }, AccountPanel))
    }

    /**
     * 登记「订阅」这一行和它的主区域面板（order 2，落在「插件市场」下面）。
     *
     * 页面本体是 dsh-plugin-subscriptions 登记在 `settings.section`（id
     * "subscriptions"）里的那个组件，这里按同一套槽位规则取出来直接渲染 ——
     * 登录 / 登出、代理、用量全由它自己负责。那一栏登记得比本插件晚也没关系：
     * 面板会订阅 settings.section 的变化，来了就重渲；一直没来（插件没装 /
     * 没启用）就显示一句提示 + 「在设置里打开」。
     *
     * 这一行**故意做在本插件里**而不是改订阅插件的包：那个包在插件市场升级时会被
     * 整包替换，打在里面的补丁留不住（2026-09-27 那版就是这么丢的）。
     * @param {any} ctx - 浏览器端插件上下文。
     * @param {(key: string) => string} t - 本插件的文案。
     */
    function registerSubscriptionsPanel(ctx, t) {
      /** @returns {any} 订阅插件在设置里登记的那一栏（没装 / 没启用时不存在）。 */
      const subscriptionsEntry = () => ctx.slots.entries('settings.section')
        .find((entry) => entry.options.id === SUBSCRIPTIONS_SECTION_ID)

      /** 兜底提示里的按钮：跳到设置的 subscriptions 栏。 */
      const openSubscriptionsSettings = () => openSettingsSection(ctx, SUBSCRIPTIONS_SECTION_ID)

      /**
       * 主区域的订阅页：渲染订阅插件登记的那个组件（SubscriptionsSection），
       * props 按槽位运行时的规则拼好（它的 inject() 带着 rpc
       * 和自己命名空间的 t，正是它要的那两个）。
       * @returns {unknown} 页面元素。
       */
      function SubscriptionsPanel() {
        const [, bump] = react.useReducer((n) => n + 1, 0)
        // 订阅插件比本插件晚登记 / 被关掉时跟着重渲。
        react.useEffect(() => (typeof ctx.slots.subscribe === 'function'
          ? ctx.slots.subscribe('settings.section', () => bump())
          : undefined), [])

        const entry = subscriptionsEntry()

        const body = entry !== undefined && typeof entry.component === 'function'
          ? react.createElement(PanelBoundary, {
            label: '订阅页',
            fallback: react.createElement(Notice, {
              text: t('subscriptionsRenderFailed'),
              action: t('subscriptionsOpenSettings'),
              onOpen: openSubscriptionsSettings,
            }),
          }, react.createElement(entry.component, slotProps(entry, t)))
          : react.createElement(Notice, {
            text: t('subscriptionsMissing'),
            action: t('subscriptionsOpenSettings'),
            onOpen: openSubscriptionsSettings,
          })

        return react.createElement('div', { style: PANEL_PAGE_STYLE },
          react.createElement('div', { style: PANEL_INNER_STYLE },
            react.createElement('h1', { style: PANEL_TITLE_STYLE }, t('subscriptionsNav')),
            body))
      }

      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: SUBSCRIPTIONS_PANEL_ID,
        order: SUBSCRIPTIONS_ORDER,
        label: () => t('subscriptionsNav'),
        locale: NS,
      }, SubscriptionsPanelIcon))

      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: SUBSCRIPTIONS_PANEL_ID,
        locale: NS,
      }, SubscriptionsPanel))
    }

    /**
     * @param {any} ctx - 浏览器端插件上下文。
     */
    exports.apply = function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-market-sidebar: dictionaries')
      const t = ctx.locale.bind(NS)

      // 先登记订阅（order 2）再登记账号（order 3）：显示顺序只看 order，
      // 这里只是让登记顺序和侧边栏顺序读起来一致。
      registerSubscriptionsPanel(ctx, t)
      // 账号入口默认关（见 accountRowEnabled 的注释）。关掉时这一行不在侧边栏，
      // 设置里那份「账号与余额」原样保留。
      if (accountRowEnabled) registerAccountPanel(ctx, t)

      ctx.inject(['market'], (scoped) => {
        const market = scoped.get('market')
        if (market === undefined || typeof market.render !== 'function') {
          // dshmarket 在，但形状变了（老版本没有 market.render()）。
          // 宁可这一行不出现，也不要登记一个点开是空白的面板。
          console.warn('[market-sidebar] dshmarket 没有暴露 market.render()，侧边栏入口未登记')
          return
        }

        // 让市场从设置里退场。dshmarket 留了 setSettingsVisible() 给「自己渲染市场
        // 的宿主外壳」用（它的 section-gate 注释写的就是这个场景），目的正是别让
        // 同一个东西在设置列表里再出现一次。调用早于槽位就绪也不会闪一下。
        // 包在 ctx.effect 里：本插件被关掉/卸载时恢复原状，市场就回设置里。
        if (typeof market.setSettingsVisible === 'function') {
          ctx.effect(() => {
            market.setSettingsVisible(false)
            return () => market.setSettingsVisible(true)
          }, 'dsh-market-sidebar: 市场只在侧边栏出现')
        }

        /**
         * 每次渲染都重新向市场要面板：`render()` 返回的元素带着当时的语言和主题，
         * 缓存下来会把第一次调用时的状态冻住。
         */
        const MarketPanel = () => react.createElement('div', { style: PANEL_STYLE }, market.render({}))

        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          // 「插件」是 order 0，所以 1 = 紧跟在它下面。
          order: 1,
          label: () => t('nav'),
          locale: NS,
        }, MarketPanelIcon))

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
          locale: NS,
        }, MarketPanel))
      })
    }

    /**
     * 离线验证用的钩子：让 verify.mjs 能把「账号与余额」那一行打开，
     * 继续覆盖 registerAccountPanel 的登记形状（默认关，见 accountRowEnabled）。
     */
    exports.__testing = {
      /** @param {boolean} value - 是否登记侧栏「账号与余额」入口。 */
      setAccountRowEnabled(value) {
        accountRowEnabled = value === true
      },
      /** @returns {boolean} 当前开关。 */
      accountRowEnabled() {
        return accountRowEnabled
      },
    }

    return module.exports
  },
})
