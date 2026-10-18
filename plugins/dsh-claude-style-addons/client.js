/**
 * dsh-claude-style-addons —— dsh-claude-style 皮肤的「补丁合集」，浏览器半边。
 *
 * 由两个独立补丁合并而来（2026-10-04）：
 *   一、中文问候语（原 dsh-cn-greeting）：把皮肤首页那句英文问候语换成鲸鱼娘语气的中文台词；
 *   二、皮肤修补（原 dsh-skin-fixes）：余额卡片留在侧栏页脚 + 去掉账号弹层里那份重复的余额 +
 *       DeepSeek 品牌下的行内代码配色。
 * 两部分的代码原样搬了进来，分别包在 createGreetingPart() / createSkinFixesPart() 里，
 * 原来的逻辑、注释和离线自检（verify/greeting.mjs、verify/skin-fixes.mjs）全部保留。
 *
 * 合并后新增的两件事
 * ------------------
 *   三、偏好：四个选项存在本插件自己的设置命名空间里（profile 条目 id = claude-style-addons，
 *       host 半边 index.js 导出的 Config）。读写走宿主的 configForms 服务 —— 皮肤存它自己的设置
 *       用的也是这条官方通道，最后落在 ~/.dsh/profiles/<profile>/cordis.patch.yml。另外在
 *       localStorage 里留一份缓存：首屏在配置读到之前就按上次的选择来，宿主的设置服务不在时
 *       也不至于把设置弄丢。
 *   四、设置页：把这几项**画进皮肤自己的「Claude Style」设置页**（设置弹窗里那一页，以及插件页上
 *       皮肤卡片展开的那一份），排在皮肤自己那些行的后面。
 *       用的是皮肤的 class（dsh-claude-settings-row / -switch / segments），所以长得一模一样；
 *       但**一行皮肤代码都不改**：皮肤的设置页是 React 渲染的 `.dsh-claude-settings` 容器，本插件
 *       只在观察到它出现后往末尾追加一个自己的块。React 只管它自己建的子节点，末尾多出来的块它不认识
 *       也不会去动；页面卸载时块跟着一起消失，下次打开再补上。
 *
 * 为什么仍然是「皮肤之外的插件」
 * ------------------------------
 * dsh-claude-style 是 npm 包，`dsh plugin update` 会整包替换它的 lib/client.js，任何直接改它的
 * 补丁都会在升级时消失（2026-10-03、2026-10-04 各撞过一次）。本插件不属于那个包，升级冲不到它；
 * 它只依赖皮肤留下的「契约」（body 上的属性名、几个 class 片段、设置页容器的 class），
 * 契约一变 verify.mjs 会在离线状态下直接报红。
 *
 * 手写的 loader 闭包工厂格式（没有打包器这一步），与 dsh-market-sidebar 一致。
 *
 * @module dsh-claude-style-addons/client
 */

window.__ModuleLoader__.load({
  id: 'dsh-claude-style-addons',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports

    /** 包名：style 标签上的 data-plugin、exports.name 都用它。 */
    const PACKAGE_NAME = 'dsh-claude-style-addons'
    /** 本插件在 profile 里那一行的 id（cordis.patch.yml 的 insert 行）—— 也就是设置命名空间。 */
    const ENTRY_ID = 'claude-style-addons'

    // ══ 一、中文问候语（原 dsh-cn-greeting） ════════════════════════════════════════

    /**
     * dsh-cn-greeting 的浏览器半边 —— 把皮肤写上去的英文问候语，换成鲸鱼娘语气的中文台词。
     *
     * 为什么是「皮肤之外的子插件」而不是改皮肤代码
     * ------------------------------------------------
     * dsh-claude-style 是 npm 包，`dsh plugin update` 会整包替换掉它的 lib/client.js，
     * 任何直接改它的补丁都会在升级时消失（2026-10-03、2026-10-04 各撞过一次，皮肤自己
     * 的注释里也记着这笔账）。这个插件不属于那个包，升级冲不到它。
     *
     * 它只做一件事
     * ------------
     * 英文问候语只是**触发键**，中文才是真正要显示的文案；两者含义可以完全无关
     * （`Fresh start, {name}?` → 「新的一天。别想了，先干五分钟，干不动再说。」）。
     *
     * 分工：
     *   · 皮肤仍然全权负责「什么时候换哪句」—— 按小时分时段、随机抽一行、跨小时重抽，
     *     这些逻辑一个字都没重写，也不 hook 它的 pickHeroGreeting、不读它的私有变量。
     *   · 本插件只负责「它写了哪句英文，我就写哪句中文」。
     *   · 它写英文 → 本插件在**同一帧内**（MutationObserver 回调是微任务，早于浏览器绘制）改成中文。
     *
     * 为什么不会跟它抢 DOM
     * --------------------
     * 1. 它写文本是 `if (span.textContent !== greeting) span.textContent = greeting`（文本相同就不写），
     *    所以它下次 pass 看到中文会主动放手。
     * 2. 它的 MutationObserver 只监听 childList + `aria-label`/`aria-selected` 两个属性，
     *    **不监听 characterData**，所以本插件改文本根本唤不醒它。
     * 3. 它另有一个 60 秒定时器给「问候语跨小时滚动」兜底；那一刻它会写英文，但那一次写入
     *    同样立刻被本插件在绘制前改掉，肉眼看不到英文。
     *
     * 只在 Claude Code Style 皮肤模式下生效（门禁）
     * --------------------------------------------
     * 它是那个皮肤的子插件，所以**进来先判断，判断不到就不动手**：
     *   · 判断依据只有一条 —— `<body>` 上有没有皮肤自己打的接管标记 `data-dsh-claude-style`
     *     （皮肤 `apply()` 里打上、`teardown()` 里摘掉；`skin.json` 的 `bodyAttr` 就是它，
     *     verify.mjs 拿 skin.json 与皮肤源码现场核对，不靠人肉看界面）。
     *   · 判断不到 → **零动作**：不注入字体样式、不探账号名、一个英文都不改。
     *   · 皮肤后到（本插件与皮肤是两个各自独立加载的客户端插件，谁先 `apply()` 不保证）
     *     → 那个盯属性的观察者当场发现，立刻挂上。
     *   · 皮肤中途关掉（标记被摘）→ 立刻放手：样式与印记收干净，不留下没人认领的覆盖。
     *
     * 字体样式是「自愈」的
     * --------------------
     * 样式标签每一轮 DOM 变动都确认一次（`ensureStyles`）：DSH 换代时会回收「这条 entry 的样式」，
     * 标签一旦被回收，旧写法（只在挂载那一刻插一次）就永久没有字体了 —— 表现正是
     * 「中文还在、像素字体没了」。标签上还记着归属（`data-cn-greeting-owner`），
     * 新旧两代实例重叠时，旧实例的清理摘不到新实例正在用的那一份（HMR 接力掉棒）。
     *
     * 关掉本插件会怎样
     * ----------------
     * `ctx.effect` 的清理函数一跑，观察者断开 + 样式与印记摘掉；之后它下一次写英文就没人翻译，
     * 界面自己回到英文。不需要我们写任何「还原文本」逻辑。
     *
     * 手写的 loader 闭包工厂格式（没有打包器这一步），与 dsh-skin-fixes / dsh-market-sidebar 一致。
     *
     * @module dsh-cn-greeting/client
     */
    function createGreetingPart() {
      const module = { exports: {} }
      const exports = module.exports

      /**
       * 皮肤认的那个「首页标题组」class 片段。皮肤自己用 `[class*="titleGroup"]` 找它，
       * 本插件用同一个片段 —— 契约只有这一个片段 + 那句英文长什么样。
       */
      const TITLE_GROUP_HINT = 'titleGroup'
      /** 皮肤在标题组里会跳过这个徽标（不参与问候语改写），本插件也跳。 */
      const PREVIEW_BADGE_HINT = 'previewBadge'

      /**
       * 「现在是 Claude Code Style 皮肤模式」的唯一依据：皮肤打在 `<body>` 上的接管标记
       * （皮肤 `skin.json` 里声明的 `bodyAttr`）。
       *
       * 皮肤在 `apply()` 里 `body.setAttribute('data-dsh-claude-style', BUILD_ID)`、
       * 在 `teardown()` 里摘掉它 —— 所以「这个属性在」就等于「父插件这一代正在接管页面」。
       * 与 dsh-skin-fixes 用同一条契约；verify.mjs 会拿 skin.json 和皮肤源码现场核对
       * （它要是改了名或不再自己打/摘，这里当场报红，而不是某天界面悄悄变回英文）。
       */
      const SKIN_ATTR = 'data-dsh-claude-style'

      /**
       * 现在是不是「Claude Code Style 皮肤模式」。
       *
       * 子插件只在父插件活着的时候干活：皮肤不在，本插件连字体样式都不该注入 ——
       * 否则停用/换掉皮肤之后，页面上会留下一份没人认领的中文问候语字体覆盖。
       * @returns {boolean} true = 皮肤这一代正在接管页面。
       */
      function skinModeOn() {
        const body = typeof document === 'undefined' ? null : document.body
        return !!(body && typeof body.hasAttribute === 'function' && body.hasAttribute(SKIN_ATTR))
      }

      /** 打过自己印记的属性名：带它的元素是本插件写过的（也方便在 DevTools 里一眼认出）。 */
      const STAMP = 'data-cn-greeting'

      /** 注入的 style 标签 id（供重复注入时复用、卸载时摘掉）。 */
      const STYLE_TAG_ID = 'dsh-claude-style-addons/greeting.css'

      /** 包名；官方约定里样式标签上的 `data-plugin` 写的就是它。 */
      const PLUGIN_ID = PACKAGE_NAME

      /**
       * 本实例的随机标识，写在样式标签上，用来认「这份样式是不是我这一代的」。
       *
       * 为什么需要：DSH 的客户端插件会**原地换代**（改文件触发的 rebuilt 帧、插件停用/启用），
       * 换代时新旧两个实例可能短暂重叠。旧实例的清理如果无条件摘标签，就会把新实例刚插进去的
       * 那份一起摘掉 —— 表现是「中文还在、像素字体没了」，而且它自己不会回来（挂载早返回了）。
       * 有了归属，旧实例只摘自己写的那份（见 releaseStyles）。
       */
      const INSTANCE = 'i' + Math.random().toString(36).slice(2, 10)

      /**
       * 要用的字体。**改这一个词就能换字体**，然后刷新页面（不用重启）：
       *   'pixel' 点阵 GB18030 Bitmap（默认，和像素鲸鱼标同一套视觉语言）
       *   'song'  宋体 Songti SC      'kai'   楷体 Kaiti SC
       *   'ping'  苹方 PingFang SC    'hei'   兰亭黑 Lantinghei SC
       *   'yuan'  圆体 Yuanti SC
       * 名字写错或不认识的系统字体会自动掉到后面的兜底字体，不会白屏。
       */
      const GREETING_FONT = 'pixel'

      /**
       * 当前生效的字体。合并之后它由 Claude Style 设置页的「问候语字体」决定（见 setFont）；
       * GREETING_FONT 只是默认值。
       */
      let currentFont = GREETING_FONT
      /** 现在有没有挂着（皮肤在 + 问候语开着）：换字体时只有挂着才当场改样式。 */
      let mountedNow = false

      /**
       * 字体注册表。`stack` 第一顺位是主选，后面跟兜底 ——
       * 中文兜底栈抄皮肤的（Noto Sans SC / Source Han Sans SC / PingFang SC），
       * 这样即使某个字体没装，也只会退到形态相近的中文字体，不会退成拉丁字体渲染方块。
       */
      const CJK_FALLBACK = "'Noto Sans SC','Source Han Sans SC','PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif"
      const FONTS = {
        pixel: {
          label: '点阵 GB18030 Bitmap',
          stack: `"GB18030 Bitmap",${CJK_FALLBACK}`,
          // 点阵字体只有一种字重（皮肤写的 500 在它身上是空转），显式写 400 免得浏览器加粗描边；
          // 关掉抗锯齿，让格子保持锐利 —— 这正是要像素感的代价与好处。
          css: 'font-weight:400 !important;font-synthesis:none;font-smooth:never;-webkit-font-smoothing:none;',
        },
        song: { label: '宋体 Songti SC', stack: `"Songti SC","STSong",Georgia,serif`, css: '' },
        kai: { label: '楷体 Kaiti SC', stack: `"Kaiti SC","STKaiti",Georgia,serif`, css: '' },
        ping: { label: '苹方 PingFang SC', stack: `"PingFang SC",-apple-system,sans-serif`, css: '' },
        hei: { label: '兰亭黑 Lantinghei SC', stack: `"Lantinghei SC","Heiti SC",sans-serif`, css: '' },
        yuan: { label: '圆体 Yuanti SC', stack: `"Yuanti SC","Hiragino Maru Gothic ProN",sans-serif`, css: '' },
        skin: { label: '跟随皮肤（不改字体）', stack: '', css: '' },
      }

      /** 鱼标与问候语之间要留多大空（皮肤给的是 8px，中文方块字旁边显得贴脸）。 */
      const MARK_GAP = 13

      /**
       * 生成问候语的样式表。管两件事：
       *
       * ① 字体 —— 必须带 `!important`：皮肤用
       *    `body[data-dsh-claude-style][data-dsh-claude-home-hero] [class*="_headline"] [class*="titleGroup"] > span`
       *    给这行字定了 font-family/size/weight/line-height，优先级比单纯的 `[data-cn-greeting]` 高得多。
       *    本插件的选择器带着同一个属性名，但只有 `!important` 能稳定压过去。
       *
       * ② 鱼标与文字之间的间距 —— 宿主把鱼标和标题做成 `headline` 容器下的两个兄弟，
       *    间距就是这个容器的 `gap`（官方 12px，皮肤在首页压到 8px，同时把鱼标缩到 21px）。
       *    21px 的标 + 8px 的缝，在中文字旁边贴得太近。这里只给**含本插件改写过的那一行**
       *    的 headline 加宽，不动工作室布局或别处的 headline。
       * @param {string} key - FONTS 里的键。
       * @returns {string} CSS 文本。
       */
      function stylesFor(key) {
        const font = FONTS[key] || FONTS.pixel
        const gapRule = font.stack
          ? `
  /* 首页这一行：鱼标和中文之间多留一点空（皮肤是 8px） */
  [class*="headline"]:has([${STAMP}]) {
    gap: ${MARK_GAP}px !important;
  }
  `
          : ''
        if (!font.stack) return ''
        return `/* dsh-cn-greeting —— 只作用于本插件改写过的那一个 span */
  [${STAMP}] {
    font-family: ${font.stack} !important;
    ${font.css}
  }
  ${gapRule}`
      }

      /**
       * 确保字体样式在 `<head>` 里（幂等 + **自愈**）。
       *
       * 为什么每一轮 DOM 变动都要调一次：DSH 的客户端插件是**会原地换代的**（改文件触发的
       * rebuilt 帧、插件停用/启用），而换代时 DSH 会回收「这条 entry 的样式」。原来的写法只在
       * 挂载那一刻插一次，标签一旦被回收就永久没了 —— 表现正是「中文还在、像素字体没了」。
       * 官方插件的写法也是「查不到才插」，这里再往前一步：掉了就在下一轮自己补回来。
       *
       * 归属（`data-cn-greeting-owner`）解决另一件事：新旧两代实例可能短暂重叠，旧实例的清理
       * 不许摘掉新实例正在用的那一份（HMR 接力掉棒）。见 releaseStyles。
       * @returns {boolean} 这次有没有一份可用的样式（GREETING_FONT='skin' 表示不覆盖字体，返回 false）。
       */
      function ensureStyles() {
        if (typeof document === 'undefined' || !document.head) return false
        const css = stylesFor(currentFont)
        if (!css) {
          // 「跟随皮肤」：不覆盖字体 —— 之前插过的那份（自己的）也收回来。
          releaseStyles()
          return false
        }
        const existing = document.querySelector(`style[data-plugin-css="${STYLE_TAG_ID}"]`)
        const tag = existing || document.createElement('style')
        tag.dataset.plugin = PLUGIN_ID
        tag.dataset.pluginCss = STYLE_TAG_ID
        tag.dataset.cnGreetingOwner = INSTANCE
        // 内容变了才写（同样的字符串再写一遍没有意义，还会白白多一次 DOM 变动）。
        if (existing === null || existing === undefined || existing.textContent !== css) tag.textContent = css
        if (existing === null || existing === undefined) document.head.appendChild(tag)
        return true
      }

      /**
       * 摘掉**自己那一份**样式。归属不是自己的就放手 —— 那说明它在另一代实例手里正被用着。
       * @returns {boolean} 摘掉了没有。
       */
      function releaseStyles() {
        if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return false
        const tag = document.querySelector(`style[data-plugin-css="${STYLE_TAG_ID}"]`)
        if (!tag || !tag.parentNode) return false
        if (tag.dataset ? tag.dataset.cnGreetingOwner !== INSTANCE : false) return false
        tag.parentNode.removeChild(tag)
        return true
      }

      /**
       * 换字体（设置页「问候语字体」）。挂着的话当场把样式换掉，不用刷新。
       * @param {string} key - FONTS 里的键；认不出来就回默认。
       * @returns {boolean} 是否真的换了。
       */
      function setFont(key) {
        const next = Object.prototype.hasOwnProperty.call(FONTS, key) ? key : GREETING_FONT
        if (next === currentFont) return false
        currentFont = next
        if (mountedNow) ensureStyles()
        return true
      }

      /** @returns {string} 当前字体键。 */
      function getFont() {
        return currentFont
      }

      /**
       * 兼容旧测试钩子：插一次，返回「摘掉自己那份」的卸载函数。
       * @returns {() => void} 卸载函数。
       */
      function installStyles() {
        ensureStyles()
        return () => { releaseStyles() }
      }

      /**
       * 摘掉自己打在界面上的印记。
       *
       * **不还原文本**（这是既定口径）：皮肤自己还会写英文，界面会跟着回到英文；这里只把
       * 「本插件改写过」这个标记收干净 —— 字体 CSS 的选择器认的就是它，留着就等于留一份覆盖。
       * @returns {number} 摘掉了几处。
       */
      function releaseStamps() {
        if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return 0
        let count = 0
        try {
          const stamped = document.querySelectorAll('[' + STAMP + ']')
          for (let i = 0; i < stamped.length; i++) {
            const node = stamped[i]
            // 只摘「自己写的那句话」的印记：另一代实例写进去的内容不许碰
            // （它还要靠印记拿字体，摘了就是别人掉字体）。
            if (WRITTEN.get(node) !== node.textContent) continue
            node.removeAttribute(STAMP)
            count += 1
          }
        } catch (error) {
          // 摘不掉印记不影响功能。
        }
        return count
      }

      /**
       * 「这个节点上，我写进去的是哪句话」——判断"已处理"的唯一依据。
       * 不用节点属性判断，是因为皮肤会复用同一个 span 写下一句：那时属性还挂着，
       * 只看属性会把新句子误判成已处理。WeakMap 让节点被回收时记录自动消失，不留泄漏。
       * @type {WeakMap<Element, string>}
       */
      const WRITTEN = new WeakMap()

      /** 星期映射：英文 → 中文。键取自英文原文，取不到才退回本机日期。 */
      const WEEKDAYS = {
        Sunday: '周日',
        Monday: '周一',
        Tuesday: '周二',
        Wednesday: '周三',
        Thursday: '周四',
        Friday: '周五',
        Saturday: '周六',
      }

      /** 按本机日期兜底时的顺序（Date#getDay()，0 = Sunday）。 */
      const WEEKDAY_BY_INDEX = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

      /**
       * 账号名 → 中文称呼。皮肤把 `{name}` 填成账号名（本机是 andychen），
       * 中文台词里要说「烁丞」。换成别的账号时，在这里加一行即可；
       * 对不上号就不带称呼（比硬塞一个陌生名字强）。
       */
      const NAME_ALIASES = {
        andychen: '烁丞',
      }
      /** 设置里默认的中文称呼（英文台词里带了名字、但认不出是谁时用它？—— 不，宁可不带，见 chineseNameFor）。 */
      const DEFAULT_CN_NAME = '烁丞'

      /**
       * 台词表：key = 皮肤的英文原文字面量（`{name}`/`{weekday}` 都还是占位符的形态）。
       * value = 中文台词；`%N` 是中文称呼占位符，`%W` 是星期占位符。
       *
       * 这张表是整份契约的另一半：verify.mjs 会把皮肤从已装包里**现场抽出来的每一条模板**
       * 都拿来这里对一遍，缺一条就报红 —— 皮肤作者改了或加了问候语，我们当场知道，而不是
       * 某天在界面上撞见一句漏网的英文。
       */
      const LINES = {
        // ── 05:00–12:00 ─────────────────────────────────────────────────────────
        'Good morning, {name}!': '早啊主人 本鲸等你半天了',
        'Happy {weekday}, {name}.': '%W好呀 谁也别想偷懒',
        'What are you working on?': '我游上来了 先啃哪块',
        'Morning, {name}. What’s first?': '醒了就干 这才对',
        'Fresh start, {name}?': '别想了 先干五分钟',

        // ── 12:00–14:00 ─────────────────────────────────────────────────────────
        'What’s on the agenda today?': '先泡杯茶 活跑不掉',
        'Good afternoon, {name}.': '中午了 主人你吃了吗',
        'Midday check-in, {name}?': '过一半了 别慌',

        // ── 14:00–18:00 ─────────────────────────────────────────────────────────
        'Coffee and Claude time?': '我陪你 不许摸鱼',
        'How’s the day going, {name}?': '犯困就摸摸鱼 我准了',
        'Afternoon, {name}. What’s next?': '那个问题 还在脑子里吧',

        // ── 18:00–22:00 ─────────────────────────────────────────────────────────
        'Evening, how are things?': '天黑了 累不累',
        'Good evening, {name}.': '夜里好 %N 我陪你游',
        'How was your day, {name}?': '今天就这样 明天再说',
        'Winding down, or just getting started?': '该收工了 别硬撑',

        // ── 22:00–05:00 ─────────────────────────────────────────────────────────
        'You are here!': '这么晚还醒着 咱俩都不正常',
        'Hello, night owl.': '月亮不睡我不睡',
        'Burning the midnight oil, {name}?': '又熬夜 你上次也这么说',
        'Still up, {name}?': '睡了没 没有就陪我聊',

        // ── 通用池（任何时段都可能抽到）─────────────────────────────────────────
        'Back at it, {name}?': '欢迎回来 主人想我没',
        'Welcome back, {name}.': '活儿还在原地 我没动',
        'Hey there, {name}.': '今天想搞点什么大事',
        'What shall we build?': '闲着也是闲着 干点没用的',
      }

      /**
       * 从英文原文里抠出账号名，换成中文称呼。
       * 皮肤已经把 `{name}` 换掉了，这里把它认出来：
       *   · 原文里的名字在 NAME_ALIASES 里 → 用对应的中文称呼；
       *   · 原文里没有名字（理论上不会，但留着兜底）→ 用主机账号名再试一次；
       *   · 名字认不出来 → 返回空串，中文台词会把称呼那一小句整个去掉。
       *     **绝不退回默认称呼**：否则换个账号就会把「烁丞」安到一个陌生人头上。
       * @param {string} english - 皮肤写上去的英文原句。
       * @param {string} accountName - 账号名（宿主 userInfo().username），仅作兜底。
       * @returns {string} 中文称呼，认不出时返回空串。
       */
      function chineseNameFor(english, accountName) {
        for (const template of Object.keys(LINES)) {
          if (template.indexOf('{name}') === -1) continue
          const [head, tail] = template.split('{name}')
          if (english.indexOf(head) !== 0 || english.length < head.length + tail.length) continue
          if (english.slice(english.length - tail.length) !== tail) continue
          const captured = english.slice(head.length, english.length - tail.length)
          if (!captured) return accountName && NAME_ALIASES[accountName] ? NAME_ALIASES[accountName] : ''
          return NAME_ALIASES[captured] || ''
        }
        return ''
      }

      /**
       * 从英文原文里抠出星期，翻成中文。取不到就按本机日期兜底。
       * 这样做的好处：星期永远是皮肤自己算好的那一天，本插件不引入任何日期逻辑，不可能算错。
       * @param {string} english - 英文原句。
       * @returns {string} 中文星期，如「周日」。
       */
      function chineseWeekdayFor(english) {
        const hit = /Happy\s+([A-Za-z]+day)\s*,/.exec(english)
        if (hit && WEEKDAYS[hit[1]]) return WEEKDAYS[hit[1]]
        return WEEKDAY_BY_INDEX[new Date().getDay()] || ''
      }

      /**
       * 把模板编译成正则：`{name}` / `{weekday}` 各成一个捕获组，其余部分原样转义。
       * 编译结果缓存，避免每次 DOM 变动都重新构造。
       * @type {Map<string, {re: RegExp, cn: string}>}
       */
      const COMPILED = new Map()

      /**
       * @param {string} template - 带占位符的英文模板。
       * @returns {{re: RegExp, cn: string}} 编译结果。
       */
      function compile(template) {
        const cached = COMPILED.get(template)
        if (cached) return cached
        const source = template
          .split('{name}')
          .map((part) => part.split('{weekday}').map((piece) => piece.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('([A-Za-z]+day)'))
          .join('(.+)')
        const entry = { re: new RegExp('^' + source + '$'), cn: LINES[template] }
        COMPILED.set(template, entry)
        return entry
      }

      /**
       * 把一句英文问候语翻成中文台词。
       * 先按模板匹配（模板里 `{name}`/`{weekday}` 位置固定，所以匹配是严丝合缝的全文匹配），
       * 匹配上之后：`%W` 填中文星期（优先用捕获到的那个词，取不到才退回本机日期），
       * `%N` 填中文称呼；称呼认不出来时，把带 `%N` 的那一小句整个去掉（而不是留个空位）。
       * @param {string} english - 皮肤写上去的英文原句（已做 {name}/{weekday} 替换）。
       * @param {string} accountName - 账号名，用于兜底认名字。
       * @returns {string|null} 中文台词；这句不在表里就返回 null（不认识的英文一律不碰）。
       */
      function translate(english, accountName) {
        const text = String(english == null ? '' : english).trim()
        if (!text) return null

        for (const template of Object.keys(LINES)) {
          const { re, cn } = compile(template)
          const hit = re.exec(text)
          if (!hit) continue

          // 捕获组顺序跟着模板里占位符出现的顺序走。
          let name = ''
          let weekday = ''
          let group = 1
          const nameAt = template.indexOf('{name}')
          const weekdayAt = template.indexOf('{weekday}')
          if (nameAt !== -1 && (weekdayAt === -1 || nameAt < weekdayAt)) {
            name = hit[group++] || ''
            if (weekdayAt !== -1) weekday = hit[group++] || ''
          } else if (weekdayAt !== -1) {
            weekday = hit[group++] || ''
            if (nameAt !== -1) name = hit[group++] || ''
          }

          const cnName = name ? chineseNameFor(english, accountName) : ''
          const cnWeekday = weekday && WEEKDAYS[weekday] ? WEEKDAYS[weekday] : chineseWeekdayFor(text)

          let out = cn
          if (cnName === '') {
            if (cn.indexOf('%N') !== -1) {
              // 认不出称呼：只把称呼本身和它前面那个逗号去掉，**保留后面的标点**，
              // 于是「夜里好，%N。这个点还醒着…」→「夜里好。这个点还醒着…」。
              out = out.replace(/[，,、]?\s*%N/g, '').trim()
              if (!out) return null // 整句就靠称呼撑着，那不如不翻
            }
          } else {
            // 用函数式替换：替换串里的 `$&`、`$1` 在 String.replace 里有特殊含义，
            // 万一称呼里带 `$`（用户自定义账号名）就会把 %N 原样吐回去。
            out = out.replace(/%N/g, () => cnName)
          }
          out = out.replace(/%W/g, () => cnWeekday)
          return out
        }
        return null
      }

      /**
       * 皮肤可配置的账号名（它自己也可以被用户在设置里改成别的）。
       * 本插件只读它一次，用来把英文里的名字对到中文称呼上；拿不到就退化成「认不出来就不带称呼」。
       */
      const USERNAME_ROUTE = '/dsh-claude-style/username'
      /** 账号名缓存：一次探测，不轮询。 */
      let accountName = ''

      /** 探一次账号名。失败无所谓，不带称呼而已。 */
      function probeAccountName() {
        try {
          if (typeof fetch !== 'function') return
          fetch(USERNAME_ROUTE, { credentials: 'same-origin' })
            .then((res) => (res && res.ok ? res.json() : null))
            .then((data) => {
              if (data && data.ok === true && typeof data.username === 'string') {
                accountName = data.username.trim()
              }
            })
            .catch(() => {})
        } catch (error) {
          // 读不到账号名不影响主流程。
        }
      }

      /**
       * 从任意节点往上找「首页标题组」。
       * @param {Node|null} node - 起点。
       * @returns {Element|null} 标题组元素。
       */
      function titleGroupOf(node) {
        let el = node && node.nodeType === 1 ? node : node && node.parentElement
        while (el && el.getAttribute) {
          const cls = el.getAttribute('class') || ''
          if (cls.indexOf(TITLE_GROUP_HINT) !== -1) return el
          el = el.parentElement
        }
        return null
      }

      /**
       * 找出标题组里「承载问候语」的那个 span：跳过多出来的徽标，
       * 并优先认本插件自己写过的那个（皮肤复用节点时也能跟上）。
       * @param {Element} group - 标题组。
       * @returns {Element|null} 问候语节点。
       */
      function greetingNodeIn(group) {
        const spans = group.children || []
        let fallback = null
        for (let i = 0; i < spans.length; i++) {
          const span = spans[i]
          if (span.nodeType !== 1) continue
          if (WRITTEN.has(span)) return span
          const cls = span.getAttribute('class') || ''
          if (cls.indexOf(PREVIEW_BADGE_HINT) !== -1) continue
          fallback = span
        }
        return fallback
      }

      /**
       * 一次翻译：把标题组里那句英文换成中文。
       *
       * 「这句已经是我写的」不能看节点属性 —— 皮肤会复用同一个 span 写下一句，
       * 那时光看属性会把新句子误判成已处理而漏掉。所以比对的是**我实际写进去的那串字**：
       * 一致就放手，不一致就是新内容，该翻就翻。
       * @param {Element} group - 首页标题组。
       * @returns {boolean} 是否真的改写了。
       */
      function translateGroup(group) {
        const node = greetingNodeIn(group)
        if (!node) return false
        const current = node.textContent || ''
        if (WRITTEN.get(node) === current) {
          // 就是我写的那句，别碰。但「皮肤关掉 → 又开」那一路会把印记摘掉，
          // 而字体 CSS 认的就是印记 —— 补回来（幂等，不动一个字）。
          if (!node.hasAttribute(STAMP)) node.setAttribute(STAMP, '1')
          return false
        }
        const cn = translate(current, accountName)
        if (cn === null) return false
        node.setAttribute(STAMP, '1')
        try {
          node.textContent = cn
          WRITTEN.set(node, cn)
        } catch (error) {
          node.removeAttribute(STAMP)
          throw error
        }
        return true
      }

      /**
       * 扫一遍全页面的标题组。
       * @param {Document|Element} root - 扫描根。
       * @returns {number} 改写了几处。
       */
      function sweep(root) {
        if (!root || typeof root.querySelectorAll !== 'function') return 0
        let changed = 0
        const groups = root.querySelectorAll('[class*="' + TITLE_GROUP_HINT + '"]')
        for (let i = 0; i < groups.length; i++) {
          try {
            if (translateGroup(groups[i])) changed += 1
          } catch (error) {
            if (typeof console !== 'undefined' && console.warn) {
              console.warn('[dsh-claude-style-addons·问候语] 改写失败（已跳过）：', error)
            }
          }
        }
        return changed
      }

      /**
       * 挂上翻译 —— **只在 Claude Code Style 皮肤模式下**。
       *
       * 「进来先判断一下」（思路抄 dsh-plugin-l10n-zh：东西进来时先看一眼，再决定干不干）：
       *
       *   ① 进来先判断 `<body>` 上有没有皮肤的接管标记（见 skinModeOn）；
       *   ② 有 → 立刻挂：探一次账号名、注入字体样式、观察 DOM 开始改写；
       *   ③ 没有 → **零动作**：不注入样式、不探账号名、一个英文都不改，只留一个盯
       *      `data-dsh-claude-style` 的观察者；
       *   ④ 皮肤后到 → 那一刻立刻亮；皮肤中途关掉 → 立刻放手（样式与印记收干净）。
       *
       * 为什么不把「判断不到」做成彻底退场：本插件与皮肤是两个各自独立加载的客户端插件，
       * 谁先 `apply()` 不保证（profile 里的顺序只是注册顺序，模块是并行拉的）。一次性判断要是
       * 正好撞在皮肤之前，界面上会一直留着英文直到下次刷新 —— 那才是真 bug。而这个观察者是
       * 零成本的：皮肤不在时它不写 DOM、不翻译、不联网。
       * @returns {() => void} 卸载函数（断开观察 + 摘掉样式与印记）。
       */
      function installGreeting() {
        if (typeof document === 'undefined' || !document.body) return () => {}
        if (typeof MutationObserver !== 'function') return () => {}

        /** 皮肤模式现在开着吗 —— 也就是「我们有没有真的挂上去干活」。 */
        let mounted = false
        /** 账号名只探一次（皮肤开关来回切也不重复问）。 */
        let probed = false

        /** 皮肤在：这才开始干活。样式与改写都在 runNow 里做（那里每一轮都自愈一次）。 */
        const mount = () => {
          if (mounted) return
          if (!probed) {
            probed = true
            probeAccountName()
          }
          mounted = true
          mountedNow = true
        }

        /** 皮肤走了（或本插件被停用）：把样式与印记收干净。 */
        const unmount = () => {
          if (!mounted) return
          mounted = false
          mountedNow = false
          releaseStyles()
          releaseStamps()
        }

        /** 跟着皮肤的出现 / 消失走。 */
        const syncMode = () => {
          if (skinModeOn()) mount()
          else unmount()
        }

        let scheduled = false
        const runNow = () => {
          scheduled = false
          try {
            syncMode()
            if (!mounted) return
            // 自愈：样式标签掉了（DSH 回收旧 entry 的样式、换代重叠）就在这一轮补回来。
            ensureStyles()
            sweep(document)
          } catch (error) {
            // 一轮失败不影响下一轮：观察者还在，下次 DOM 变动会重新走一遍。
            if (typeof console !== 'undefined' && console.warn) {
              console.warn('[dsh-claude-style-addons·问候语] 这一轮没跑完（下一轮会重来）：', error)
            }
          }
        }
        const schedule = () => {
          if (scheduled) return
          scheduled = true
          // 观察者回调本身就在微任务里（早于绘制），这里再排一次只是合并同一批变更。
          Promise.resolve().then(runNow)
        }

        const observer = new MutationObserver(schedule)
        observer.observe(document.body, {
          childList: true,
          subtree: true,
          characterData: true,
          // 皮肤的开 / 关就是这个属性：上面三样是「翻译」，这一样是「门禁」。
          attributes: true,
          attributeFilter: [SKIN_ATTR],
        })

        /**
         * 样式的「当场自愈」：`<head>` 里那份标签被谁回收了（DSH 换代时会），就在同一次回调里补回来。
         * 只盯 head 的增删（很少发生），不轮询；body 那一轮里的 ensureStyles 是第二道保险。
         * 挂载前 `mounted` 是 false，所以这条路径不会在门禁关着的时候把样式塞回去。
         */
        let headObserver = null
        if (document.head && typeof MutationObserver === 'function') {
          headObserver = new MutationObserver(() => {
            if (!mounted) return
            try {
              ensureStyles()
            } catch (error) {
              // 下一轮 body 变动还会再试一次。
            }
          })
          headObserver.observe(document.head, { childList: true })
        }

        // 进来先判断一次：皮肤在就立刻干活；不在就只留着上面这个观察者等它。
        runNow()

        return () => {
          observer.disconnect()
          if (headObserver) headObserver.disconnect()
          unmount()
        }
      }

      /** 不需要任何服务：只是观察 DOM 并改文本。 */
      exports.inject = []
      exports.name = PACKAGE_NAME

      /**
       * @param {any} ctx - 浏览器端插件上下文。
       */
      exports.apply = function apply(ctx) {
        // 样式不再单独无条件注入：它跟着改写一起，挂在「皮肤模式在不在」这个门禁下面
        // （皮肤不在时注入，就等于在别人的界面上留一份没人认领的字体覆盖）。
        ctx.effect(() => installGreeting(), 'dsh-cn-greeting: 中文问候语（仅 Claude Code Style 皮肤模式下）')
      }

      /** 离线验证用的钩子：把表与判定函数露出来，免得 verify.mjs 去抠源码。 */
      exports.__testing = {
        LINES,
        WEEKDAYS,
        WEEKDAY_BY_INDEX,
        NAME_ALIASES,
        DEFAULT_CN_NAME,
        TITLE_GROUP_HINT,
        STAMP,
        STYLE_TAG_ID,
        PLUGIN_ID,
        INSTANCE,
        SKIN_ATTR,
        GREETING_FONT,
        setFont,
        getFont,
        MARK_GAP,
        FONTS,
        WRITTEN,
        stylesFor,
        ensureStyles,
        releaseStyles,
        installStyles,
        skinModeOn,
        releaseStamps,
        translate,
        chineseWeekdayFor,
        chineseNameFor,
        titleGroupOf,
        greetingNodeIn,
        translateGroup,
        sweep,
        installGreeting,
      }

      return module.exports
    }

    // ══ 二、皮肤修补（原 dsh-skin-fixes） ════════════════════════════════════════

    /**
     * dsh-skin-fixes 的浏览器半边：往页面注入一段 CSS，再加一个「页脚守卫」。
     *
     * 为什么是「皮肤之外的插件」而不是「改皮肤代码」
     * ------------------------------------------------
     * dsh-claude-style 是 npm 包，`dsh plugin update` 会整包替换掉它的 lib/client.js，
     * 任何直接改它的补丁都会在升级时消失（2026-10-03、2026-10-04 各撞过一次）。这个插件
     * 不属于那个包，升级冲不到它；它只依赖皮肤留下的「契约」：几个属性名 + 一个 class 前缀。
     * 契约一旦变了，同目录的 verify.mjs 会在离线状态下直接报出来（不靠人肉看界面）。
     *
     * 它管三件事
     * ----------
     *   1. CSS：让侧栏页脚那张余额卡片（dsh-balance-widget）留在原地 —— 皮肤的
     *      「折叠侧边栏设置区」会把 footerActions 压成 0×0、把条目镜像进账号弹层。
     *   2. CSS：DeepSeek 品牌下给行内代码补上品牌蓝的底色与字色（皮肤故意写回了正文墨色）。
     *   3. 守卫（JS）：那张卡片**不该被镜像**。皮肤给「这一条别管」留了一个现成的信号 ——
     *      条目上带 `data-slot-error` 时，它的 footerEntriesOf() 会整条跳过（既不折叠、
     *      也不镜像）。这个信号是宿主的「该槽位崩了」标记，宿主只写不读、也没有任何 CSS
     *      依赖它，所以拿来当开关是安全的。守卫同时会把皮肤已经镜像出去的那一份清掉。
     *      （不这么做就得跟皮肤的镜像逻辑抢 DOM，那才是真会打架的路子。）
     *
     * 手写的 loader 闭包工厂格式（没有打包器这一步），与 dsh-market-sidebar 一致。
     *
     * @module dsh-skin-fixes/client
     */
    function createSkinFixesPart() {
      const module = { exports: {} }
      const exports = module.exports

      /** 注入用的 style 标签标识，供重复注入时复用与卸载时定位。 */
      const STYLE_TAG_ID = 'dsh-claude-style-addons/skin-fixes.css'

      /** 皮肤接管页脚时打在 <body> 上的属性。 */
      const TAKEOVER_ATTR = 'data-dsh-claude-footer-takeover'
      /** 皮肤认这个属性：带它的条目整条跳过（宿主只写不读、无 CSS 依赖）。 */
      const SKIP_ATTR = 'data-slot-error'
      /** 余额卡片侧栏那一面（dsh-balance-widget 的根 class），用来认出「哪一份是它」。 */
      const CARD_SELECTOR = '[class*="dshbw_sideWrap"]'
      /** 皮肤镜像进账号弹层的两种节点。 */
      const MIRROR_SELECTOR = '.dsh-claude-popover-item, .dsh-claude-popover-embed'

      /**
       * 两段补丁 CSS。
       *
       * 选择器都比皮肤那几条同目标的声明更具体（多一个 :has() / 多一层 html），
       * 所以不依赖「谁后加载谁赢」这种脆弱顺序 —— 皮肤先注入还是后注入都压得住。
       */
      const CSS_FOOTER = `
  /* ── 1. 余额卡片留在侧栏页脚（用户名上方）────────────────────────────────
   * 皮肤的「折叠侧边栏设置区」在 <body> 上打 data-dsh-claude-footer-takeover，然后：
   *   · 把 [class*="footerActions"] 容器压成 0×0（width/height/font-size 全 0）；
   *   · 把槽里的条目标成 [data-dsh-claude-footer-entry]（盒子归零）
   *     和 [data-dsh-claude-footer-hidden]（display:none），再镜像进账号弹层。
   * 下面只把「装着余额卡片」的那一份盒子还回来，其余条目的接管行为一点不动。
   * dshbw_sideWrap 是 dsh-balance-widget 侧栏卡片的根 class。
   * 守卫那条路（给条目打跳过标记）会让皮肤先一步别碰它；这几条是守卫跑起来之前的兜底。 */
  body[data-dsh-claude-style][data-dsh-claude-footer-takeover]
    [class*="footArea"] > [class*="footerActions"]:has([class*="dshbw_sideWrap"]) {
    width: 100% !important;
    height: auto !important;
    line-height: inherit !important;
    font-size: inherit !important;
  }

  body[data-dsh-claude-style][data-dsh-claude-footer-takeover]
    [class*="footArea"] :is(
      [data-dsh-claude-footer-hidden]:has([class*="dshbw_sideWrap"]),
      [data-dsh-claude-footer-hidden][class*="dshbw_sideWrap"],
      [data-dsh-claude-footer-entry]:has([class*="dshbw_sideWrap"]),
      [data-dsh-claude-footer-entry][class*="dshbw_sideWrap"]
    ) {
    display: block !important;
    width: auto !important;
    height: auto !important;
    min-width: 0 !important;
    min-height: 0 !important;
    margin: 0 !important;
    padding: 0 !important;
    border: none !important;
    background: transparent !important;
    box-shadow: none !important;
    line-height: normal !important;
    font-size: inherit !important;
    overflow: visible !important;
  }

  `

      /** ② DeepSeek 品牌下的行内代码配色（设置页「DeepSeek 品牌的行内代码配色」单独开关）。 */
      const CSS_CODE = `/* ── 2. DeepSeek 品牌下的行内代码配色 ────────────────────────────────────
   * 皮肤的 Claude 品牌给行内代码配了「暖红字 + 5% 灰底」的芯片；DeepSeek 品牌那两块
   * palette 里 --dsh-claude-inline-code-fg 被写回正文墨色，于是代码看着和普通文字一样。
   * 这里换成品牌蓝：浅色画布 10% 底 + 深蓝字，深色画布 16% 底 + 浅蓝字。
   * 字色刻意不用链接色（皮肤的 --dsh-claude-link），否则一段代码和一条链接分不清。
   *
   * 压过皮肤那两条声明靠的是优先级，所以得跟着皮肤的选择器形状走：皮肤从 0.10.5 起
   * 把 Claude 调色板也写进了 DeepSeek 品牌那两条（body[style][palette][brand]…，
   * 四个属性），本插件原来「html + 三个属性」就压不住了——代码于是又变成正文墨色。
   * 下面把品牌属性写成两份：带 palette 的那份跟皮肤现在的写法对齐（属性数相同、多
   * 一层 html 取胜），不带的那份留给旧皮肤和 palette="host"。两份必须是同一组值，
   * 所以用 :is() 合成一条：改色只改一处，不会改漏。 */
  html body[data-dsh-claude-style]:is(
    [data-dsh-claude-brand="deepseek"][data-dsh-claude-palette="claude"],
    [data-dsh-claude-brand="deepseek"]
  ):not([data-ds-dark-theme]) {
    --dsh-claude-inline-code-bg: rgba(77, 107, 254, 0.10);
    --dsh-claude-inline-code-fg: #2f4bd0;
  }

  html body[data-dsh-claude-style]:is(
    [data-dsh-claude-brand="deepseek"][data-dsh-claude-palette="claude"],
    [data-dsh-claude-brand="deepseek"]
  )[data-ds-dark-theme] {
    --dsh-claude-inline-code-bg: rgba(106, 132, 255, 0.16);
    --dsh-claude-inline-code-fg: #a9bcff;
  }
  `

      /** 两段合起来（旧接口与 verify 用）。合并后两段可以分开开关，见 cssFor。 */
      const CSS = CSS_FOOTER + CSS_CODE

      /** 已经由本插件打过跳过标记的条目（只在接管开着时保留标记）。 */
      const markedEntries = new Set()

      /**
       * 把文本压成可比较的形状：去掉所有空白。
       * @param {unknown} text - 原始文本。
       * @returns {string} 归一化结果。
       */
      function normalizeText(text) {
        return String(text ?? '').replace(/\s+/g, '')
      }

      /**
       * 两份文本是不是同一份余额。
       * 长度门槛避免把「¥1」这种短串当命中。
       * @param {unknown} a - 文本 A。
       * @param {unknown} b - 文本 B。
       * @returns {boolean} 相同即 true。
       */
      function sameBalanceText(a, b) {
        const left = normalizeText(a)
        const right = normalizeText(b)
        return left.length >= 4 && left === right
      }

      /**
       * 从卡片节点往上找出「皮肤眼里的那一条」：footerActions 的直接子节点，
       * 或者它里面那个 [data-slot] 锚点的子节点（皮肤两种形状都认）。
       * @param {any} card - 卡片节点。
       * @param {any} actions - footerActions 容器。
       * @returns {any|null} 条目节点，找不到返回 null。
       */
      function entryNodeFor(card, actions) {
        let node = card
        while (node !== null && node !== undefined && node.parentElement) {
          const parent = node.parentElement
          if (parent === actions) return node
          if (parent.hasAttribute('data-slot') && parent.parentElement === actions) return node
          node = parent
        }
        return null
      }

      /**
       * 按皮肤 footerEntriesOf() 的规则列出它眼里的条目（带跳过标记的不算）。
       * 守卫用它判断「标记之后这张卡片是否已经出列」。
       * @param {any} actions - footerActions 容器。
       * @returns {any[]} 条目节点列表。
       */
      function collectEntries(actions) {
        const entries = []
        const kids = actions.children
        for (let i = 0; i < kids.length; i += 1) {
          const kid = kids[i]
          if (kid.hasAttribute(SKIP_ATTR)) continue
          if (kid.hasAttribute('data-slot')) {
            const slotKids = kid.children
            for (let j = 0; j < slotKids.length; j += 1) {
              if (!slotKids[j].hasAttribute(SKIP_ATTR)) entries.push(slotKids[j])
            }
          } else {
            entries.push(kid)
          }
        }
        return entries
      }

      /**
       * 跑一遍守卫：接管开着时给余额卡片那一条打跳过标记，接管关着时撤掉自己打的标记，
       * 并清掉皮肤已经镜像出去的那一份重复。
       * @param {any} doc - document。
       * @returns {{marked:number, cleared:number, pruned:number}} 本次动作计数。
       */
      function runFooterGuard(doc) {
        const report = { marked: 0, cleared: 0, pruned: 0 }
        const body = doc === undefined || doc === null ? null : doc.body
        if (body === null || body === undefined || !body.hasAttribute('data-dsh-claude-style')) return report
        const takeover = body.hasAttribute(TAKEOVER_ATTR)

        const footArea = doc.querySelector('[class*="footArea"]')
        const actions = footArea === null || footArea === undefined
          ? null
          : footArea.querySelector('[class*="footerActions"]')

        let cardText = ''
        if (actions !== null && actions !== undefined) {
          const cards = actions.querySelectorAll(CARD_SELECTOR)
          for (let i = 0; i < cards.length; i += 1) {
            if (cardText === '') cardText = normalizeText(cards[i].textContent)
            const entry = entryNodeFor(cards[i], actions)
            if (entry === null) continue
            if (takeover) {
              if (!entry.hasAttribute(SKIP_ATTR)) {
                entry.setAttribute(SKIP_ATTR, '')
                report.marked += 1
              }
              markedEntries.add(entry)
            } else if (markedEntries.has(entry)) {
              entry.removeAttribute(SKIP_ATTR)
              markedEntries.delete(entry)
              report.cleared += 1
            }
          }
        }

        // 皮肤可能已经把它镜像出去了：按文本认出那一份并摘掉。标记生效后皮肤不会再补回来。
        const mirrors = doc.querySelectorAll(MIRROR_SELECTOR)
        for (let i = 0; i < mirrors.length; i += 1) {
          const mirror = mirrors[i]
          if (!sameBalanceText(mirror.textContent, cardText)) continue
          if (mirror.parentNode !== null && mirror.parentNode !== undefined) {
            mirror.parentNode.removeChild(mirror)
            report.pruned += 1
          }
        }
        return report
      }

      /**
       * 挂上样式表；返回卸载函数。再调一次会复用同一个标签、按新的 parts 换内容。
       * @param {{footer?: boolean, code?: boolean}} [parts] - 要哪几段（缺省 = 两段都要）。
       * @returns {() => void} 移除自身 style 标签的函数。
       */
      function cssFor(parts) {
        const want = parts || {}
        return (want.footer !== false ? CSS_FOOTER : '') + (want.code !== false ? CSS_CODE : '')
      }

      function installStyles(parts) {
        if (typeof document === 'undefined' || document.head === undefined || document.head === null) {
          return () => {}
        }
        const existing = document.querySelector(`style[data-plugin-css="${STYLE_TAG_ID}"]`)
        const tag = existing ?? document.createElement('style')
        tag.dataset.plugin = PACKAGE_NAME
        tag.dataset.pluginCss = STYLE_TAG_ID
        const css = cssFor(parts)
        if (tag.textContent !== css) tag.textContent = css
        if (existing === null) document.head.appendChild(tag)
        return () => {
          if (tag.parentNode !== null && tag.parentNode !== undefined) tag.parentNode.removeChild(tag)
        }
      }

      /**
       * 挂上页脚守卫：观察 DOM 变化并合并到一次微任务级别的重跑。
       * @returns {() => void} 卸载函数（断开观察 + 撤掉自己打的标记）。
       */
      function installFooterGuard() {
        if (typeof document === 'undefined' || document.body === null || document.body === undefined) {
          return () => {}
        }
        if (typeof MutationObserver !== 'function') return () => {}

        let scheduled = false
        const runNow = () => {
          scheduled = false
          try {
            runFooterGuard(document)
          } catch (error) {
            // 守卫坏了也不能影响界面：只报告一次，别抛出。
            if (typeof console !== 'undefined' && console.warn) {
              console.warn('[dsh-claude-style-addons·皮肤修补] 页脚守卫出错（已忽略）：', error)
            }
          }
        }
        const schedule = () => {
          if (scheduled) return
          scheduled = true
          setTimeout(runNow, 0)
        }

        const observer = new MutationObserver(schedule)
        observer.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: [TAKEOVER_ATTR, 'data-dsh-claude-style'],
        })
        runNow()
        return () => {
          observer.disconnect()
          for (const entry of markedEntries) {
            if (entry.isConnected === false) continue
            entry.removeAttribute(SKIP_ATTR)
          }
          markedEntries.clear()
        }
      }

      /** 不需要任何服务：只写一个 style 标签 + 观察 DOM。 */
      exports.inject = []
      exports.name = PACKAGE_NAME

      /**
       * @param {any} ctx - 浏览器端插件上下文。
       */
      exports.apply = function apply(ctx) {
        ctx.effect(() => installStyles(), 'dsh-skin-fixes: stylesheet')
        ctx.effect(() => installFooterGuard(), 'dsh-skin-fixes: footer guard')
      }

      /** 离线验证用的钩子：把 CSS 与守卫的判定函数露出来，免得 verify.mjs 去抠源码。 */
      exports.__testing = {
        css: CSS,
        cssFooter: CSS_FOOTER,
        cssCode: CSS_CODE,
        cssFor,
        styleTagId: STYLE_TAG_ID,
        selectors: { CARD_SELECTOR, MIRROR_SELECTOR, SKIP_ATTR, TAKEOVER_ATTR },
        installStyles,
        installFooterGuard,
        runFooterGuard,
        normalizeText,
        sameBalanceText,
        entryNodeFor,
        collectEntries,
      }

      return module.exports
    }

    const greeting = createGreetingPart()
    const skinFixes = createSkinFixesPart()

    // ══ 三、偏好 ═══════════════════════════════════════════════════════════

    /**
     * 默认值 = 合并之前两个插件的行为（全开、点阵字体），所以升级过来界面上什么都不变。
     * host 半边 index.js 的 Config 里是同一份默认值，verify/settings.mjs 会对一遍。
     */
    const PREFS_DEFAULT = Object.freeze({
      greeting: true,
      greetingFont: 'pixel',
      mascotVariant: 'deepy',
      keepBalanceCard: true,
      deepseekInlineCode: true,
    })
    const PREF_KEYS = Object.keys(PREFS_DEFAULT)

    /** 设置页上「问候语字体」给的五个选项（FONTS 里的 ping / hei 仍然认，只是不上页面）。 */
    const FONT_CHOICES = [
      { value: 'pixel', label: '点阵' },
      { value: 'song', label: '宋体' },
      { value: 'kai', label: '楷体' },
      { value: 'yuan', label: '圆体' },
      { value: 'skin', label: '跟随皮肤' },
    ]

    const MASCOT_CHOICES = [
      { value: 'deepy', label: '原版 Deepy' },
      { value: 'whale-maid', label: '鲸鱼娘' },
    ]

    /** localStorage 里那份缓存的键（只是缓存，真值在宿主的设置命名空间里）。 */
    const CACHE_KEY = 'dsh-claude-style-addons.prefs'

    /**
     * 把任意来源的值收成偏好的形状。字段在 host 半边故意写得宽松（string / boolean），
     * 真正的取值范围在这里收口：认不出来的一律回默认。
     * @param {unknown} value - 宿主表单的值、缓存、或一次改动合并后的结果。
     * @returns {{greeting:boolean, greetingFont:string, keepBalanceCard:boolean, deepseekInlineCode:boolean}}
     */
    function normalizePrefs(value) {
      const v = value && typeof value === 'object' ? value : {}
      const fonts = greeting.__testing.FONTS
      const font = typeof v.greetingFont === 'string' && Object.prototype.hasOwnProperty.call(fonts, v.greetingFont)
        ? v.greetingFont
        : PREFS_DEFAULT.greetingFont
      return {
        greeting: v.greeting !== false,
        greetingFont: font,
        mascotVariant: v.mascotVariant === 'whale-maid' ? 'whale-maid' : 'deepy',
        keepBalanceCard: v.keepBalanceCard !== false,
        deepseekInlineCode: v.deepseekInlineCode !== false,
      }
    }

    /** 读缓存；没有、坏了、或者 localStorage 不让用都返回 null。 */
    function readCache() {
      try {
        if (typeof localStorage === 'undefined' || localStorage === null) return null
        const raw = localStorage.getItem(CACHE_KEY)
        return raw ? normalizePrefs(JSON.parse(raw)) : null
      } catch (error) {
        return null
      }
    }

    /** 写缓存；写不进去就算了（真值在宿主那边）。 */
    function writeCache(value) {
      try {
        if (typeof localStorage !== 'undefined' && localStorage !== null) localStorage.setItem(CACHE_KEY, JSON.stringify(value))
      } catch (error) {
        // 隐私模式、配额满了……都不影响功能。
      }
    }

    let prefs = readCache() || normalizePrefs(PREFS_DEFAULT)
    const prefsListeners = new Set()

    /** 两份偏好是否一样。 */
    function samePrefs(a, b) {
      return PREF_KEYS.every((key) => a[key] === b[key])
    }

    /**
     * 采纳一份偏好：记进缓存，有变化才通知（功能开关、设置页都订阅它）。
     * @param {unknown} next - 新值（会先 normalize）。
     */
    function adoptPrefs(next) {
      const value = normalizePrefs(next)
      writeCache(value)
      if (samePrefs(value, prefs)) return
      prefs = value
      for (const listener of Array.from(prefsListeners)) {
        try {
          listener(prefs)
        } catch (error) {
          if (typeof console !== 'undefined' && console.warn) console.warn('[dsh-claude-style-addons] 偏好订阅者出错（已忽略）：', error)
        }
      }
    }

    /** 当前偏好（只读）。 */
    function readPrefs() {
      return prefs
    }

    /** 订阅偏好变化；返回退订函数。 */
    function subscribePrefs(listener) {
      prefsListeners.add(listener)
      return () => { prefsListeners.delete(listener) }
    }

    /*
     * 宿主的设置表单（configForms 服务）。
     *
     * 照抄皮肤绑它自己设置的做法（皮肤 src/core/prefs.js）：
     *   · `ctx.get('configForms')` 拿服务；`forms.describe()` 是「宿主在供哪些命名空间」的目录；
     *   · 只绑目录里**真的有**的命名空间 —— 浏览器这边的 loader 条目 id 是随机生成的，拿它去要表单
     *     会得到一个没人认领的命名空间（读永远是默认值、写永远被拒）；
     *   · 目录是一次远程读，冷启动时可能比本插件晚到，所以订阅目录，到了再绑。
     * 绑上之后：`form.getSnapshot()` 读值，`form.subscribe()` 跟变化，`form.set(字段, 值)` 写。
     */
    let prefsForm = null
    let formOff = null
    let mirrorOff = null
    /** apply 时拿到的 ctx：设置页打开时、写之前都会拿它再试着绑一次。 */
    let bindingCtx = null

    /** 候选命名空间，好的在前：profile 里那一行的 id、包名、本条目自报的 id（去掉 "<kind>:" 前缀）。 */
    function namespaceCandidates(ctx) {
      let entryId = null
      try {
        const id = ctx && ctx.fiber && ctx.fiber.entry ? ctx.fiber.entry.id : null
        if (typeof id === 'string' && id !== '') entryId = id.slice(id.lastIndexOf(':') + 1)
      } catch (error) {
        // 动态门面可能把 fiber 藏起来：前两个候选还在。
      }
      return [ENTRY_ID, PACKAGE_NAME, entryId]
    }

    /** 宿主的 configForms 服务；没有就 null。 */
    function configFormsOf(ctx) {
      try {
        const forms = ctx && typeof ctx.get === 'function' ? ctx.get('configForms') : null
        return forms && typeof forms.get === 'function' ? forms : null
      } catch (error) {
        return null
      }
    }

    /** 候选里第一个宿主真的在供的命名空间；目录还没到就 null。 */
    function servedNamespace(forms, candidates) {
      let namespaces = null
      try {
        const mirror = typeof forms.describe === 'function' ? forms.describe() : null
        const snapshot = mirror && typeof mirror.getSnapshot === 'function' ? mirror.getSnapshot() : null
        namespaces = snapshot && snapshot.view ? snapshot.view.namespaces : null
      } catch (error) {
        return null
      }
      if (!Array.isArray(namespaces)) return null
      for (const candidate of candidates) {
        if (typeof candidate !== 'string' || candidate === '') continue
        if (namespaces.some((served) => served && served.ns === candidate)) return candidate
      }
      return null
    }

    /** 表单当前的值；还没就绪就 null。 */
    function readFormValue() {
      if (prefsForm === null) return null
      let snapshot = null
      try {
        snapshot = prefsForm.getSnapshot()
      } catch (error) {
        return null
      }
      if (!snapshot || snapshot.status !== 'ready') return null
      return snapshot.value && typeof snapshot.value === 'object' ? snapshot.value : null
    }

    /** 从表单读一次真值并采纳；读不到返回 false。 */
    function loadFromForm() {
      const value = readFormValue()
      if (value === null) return false
      adoptPrefs(value)
      return true
    }

    /** 绑一个宿主已经在供的命名空间；成功返回 true。 */
    function bindServedForm(forms, ctx) {
      const namespace = servedNamespace(forms, namespaceCandidates(ctx))
      if (namespace === null) return false
      let form = null
      try {
        form = forms.get(namespace)
      } catch (error) {
        return false
      }
      if (!form || typeof form.getSnapshot !== 'function') return false
      prefsForm = form
      if (typeof form.subscribe === 'function') {
        try {
          formOff = form.subscribe(() => { loadFromForm() }) || null
        } catch (error) {
          formOff = null
        }
      }
      loadFromForm()
      return true
    }

    /** 关掉目录订阅（绑上了就不用再盯目录）。 */
    function stopWatchingMirror() {
      if (mirrorOff === null) return
      const off = mirrorOff
      mirrorOff = null
      try { off() } catch (error) { /* 已经断了 */ }
    }

    /**
     * 绑宿主的设置表单（幂等，可以反复调）。
     * @param {any} ctx - 插件上下文。
     * @returns {boolean} 现在是否已经绑上。
     */
    function bindPrefs(ctx) {
      if (prefsForm !== null) return true
      const forms = configFormsOf(ctx)
      if (forms === null) return false
      if (bindServedForm(forms, ctx)) return true
      if (mirrorOff !== null) return false
      let mirror = null
      try {
        mirror = typeof forms.describe === 'function' ? forms.describe() : null
      } catch (error) {
        mirror = null
      }
      if (!mirror) return false
      const attempt = () => {
        if (prefsForm !== null || bindServedForm(forms, ctx)) stopWatchingMirror()
      }
      if (typeof mirror.subscribe === 'function') {
        try {
          mirrorOff = mirror.subscribe(attempt) || (() => {})
        } catch (error) {
          mirrorOff = null
        }
      }
      if (typeof mirror.ensure === 'function') {
        try { mirror.ensure() } catch (error) { /* 下次再试 */ }
      }
      attempt()
      return prefsForm !== null
    }

    /** 放开表单与目录的订阅。 */
    function unbindPrefs() {
      if (formOff !== null) {
        try { formOff() } catch (error) { /* 已经断了 */ }
      }
      formOff = null
      stopWatchingMirror()
      prefsForm = null
    }

    /**
     * 写一处改动。界面先变（乐观更新 + 本地缓存），宿主随后落盘；宿主拒绝就重读它的真值。
     *
     * 每个字段一次 `set()`、串起来：表单自己管写队列和版本栅栏，连点几下也不会互相覆盖或丢字段
     * （皮肤也是这么写的）。
     * @param {Record<string, unknown>} patch - 要改的字段。
     * @returns {Promise<'saved'|'local'|'refused'>} saved = 写进了配置文件；local = 宿主的设置
     *          服务不在，只记在了本机缓存里；refused = 宿主拒绝了，已恢复成它的值。
     */
    function savePrefs(patch) {
      const next = normalizePrefs(Object.assign({}, prefs, patch))
      adoptPrefs(next)
      if (readFormValue() === null && bindingCtx !== null) bindPrefs(bindingCtx)
      if (readFormValue() === null) return Promise.resolve('local')
      const keys = Object.keys(patch).filter((key) => PREF_KEYS.includes(key))
      let run = Promise.resolve(true)
      for (const key of keys) {
        run = run.then((ok) => {
          if (!ok || prefsForm === null) return false
          let pending
          try {
            pending = prefsForm.set(key, next[key])
          } catch (error) {
            // set() 对 Config 里没有的字段会在发出去之前直接抛：这就是拒绝。
            return false
          }
          return pending && typeof pending.then === 'function'
            ? pending.then((accepted) => accepted === true, () => false)
            : true
        })
      }
      return run.then((ok) => {
        loadFromForm()
        return ok ? 'saved' : 'refused'
      })
    }

    // BEGIN GENERATED WHALE MAID — tools/build-maid.mjs
    const MAID_ASSETS = {"version":5,"name":"鲸鱼娘","frameSize":128,"displaySize":72,"edgeY":97,"sheets":{"idle":{"file":"idle.png","frames":4,"url":"data:image/png;base64,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"},"blink":{"file":"blink.png","frames":2,"derived":true,"url":"data:image/png;base64,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"},"face":{"file":"face.png","frames":2,"derived":true,"names":["sleep","think"],"url":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAACACAMAAADTa0c4AAAAS1BMVEVMaXE2fuohRp7s6fT/+fD/5MsXJlAsWcgQFjMpqfMVHkjMy+YmN3T/qaH/z7Tu9/9jyv8nJT5DWJSGSVOgpM7mgIh7kctogMK24f84LnnIAAAAAXRSTlMAQObYZgAAAAlwSFlzAAAD6AAAA+gBtXtSawAADKhJREFUeJztnIt24roOhn2LLefaBGjP+z/pWb8kOwHm7M2cQlNavNZ0Sih8P7Ity5KDMa/2aq/2aq/2aq/2an/TqDTzG/lElFKyNufc76Fhf35Cyzlna7P7cgW78/vKh4SUvljB7ny64KcU6dfxXdtSGyNLSV/aB3vzDTk2ubS2Kvg1fAMBjs6H41cq2JtvIGClVQX0W/gGzA3t6wXszTcIQ7aPduiBffkXbW8BX84njcBrMM6r0m/ihxACUU8f3nuvAr5uHd6RTzC88KGgk1+OBPt/xb5sb/4sFMGGqZv0F0qJZumMH80nMXkREIqAQLUzHqpgb74R8jT/QUC59lgDfAt+CJ1aO3RT13Xe+/UK+oJo/pl8sw49OF4i0v+IOr8K+Ph4f1A37M3vqYy4WdIRuvzgl3d9yhOG5WME7MwnmmdWsHwI3vUxpd5hY5pSS4fjxi8/QMH+fB/C3MHGYvYoOSnXa0YCI3IqQ3Gin8cPPPlmxfeClxZbzkm5uhaxL/pRfAP7Q0Dhb/CMLnOx9sCd07R78428c6+gmoarjeSSFT81IU911yTl3nzDb+xJ8q/urAPEC5U+YKG8PN11c7I7n2gOPeWsHWCvBFQF5CUquevOZG++oRCmhfk5W+dUCA+6rAJ0XFpaih+6Y4Jidz7B/+Sck83Z9vgl8Wi02WZ3piBn2gign8JvZ09goxTjogjQokzu0SG4Eh1f1RWL/fV9FOzPt4lgf3CyPROQkoWAjBotPwEFmwXrHgr25+csAmTcuZ5HXy3KOQf74xHGZobY4Ltp6nhpoh/Bt/CxVvyt0yCsOiKdgypA1iIOyVnApzOV34Rv64LjTtswxKV0OqkXsk41kYQj1OIJ+gn8JGln6YBhG4a45E6DsxdLMgvotGpJz823zBc2/xhGwZSfbhyXshDp/xGbEk/yqk/5oVv4zQP5hjj4jBJl4f3caVCcmN0l547jhYBkqev8RC3Xrj9ngCv++JV8QxbTSgsv/GN0x49krbWiwCV3dMcyC0tMYmmePYLRjJfSw/nDw/hOBtG2A8ZmYAE2WaxJbmyacdTofBWAeISwQH9KwDV/GMdmvOQ3j+IbLbmlcwGNs0WBda5B0y6oUSlcF4cuLICelW+AjpqDcM4mNzQNBDiFWzuIgGZ0yeFKFfCm4dmnAtKb+ePwEL5h82kPqK1h7tFZ7gSX7Ngc9aJzaSPg7S1nDMG3zxpgw7fuIJ92yx8/xsfxDQS4koWqBmjGMQ2i4GOpF0+DcxsBOVPbknTfpwyw8vv+IFWAsUlj5Y9aGngE32yK77bvxdTcPt5HnFJ1YzOsF4cFvcDeiNKCA2z9Zw1wxm9QARELfHw0ysdFohYnxu7PN0QUI4fU1vZrZ2MMjCcYfB0VOgbgmyRHHWOMfd/zOkR34R+Iuo5iDEQrX671oZUxcFc+wYgxUpvgc/q2+dfWFwGph4AeLVJ7Jz4+qyeHWbEive9C6yw5WojuyicxInqAF50+/rsBpAdYgwqQTrgPn9P+bc4xbaQgCdrm3KfYEd2RT2L9rQDMQWbqf9rqIyL2jFigkrXyenTBsix/n5/8E59TPZz02My8UK71/o58IurjtQHU41z2u7oqXh41PLGWFjih0v5Swv/gc86b80DnBghY8FMY78Y31EYI6GM/Y9pJ4OXGsTmgXRqALx4OzYgpCH9lnc3wTQUPJcvfKPgzvxnl01q7gUsC1Fo7iQu6C9+IgDa++67rOspsV9chDK3t7IEsDNIBSNuxgG4qjogl9PRpPn/cyZ9xpSruPaLRe/ENarEeRy+896oAdl3GYRjkc9NIh0DFBgPvUbD34NycgwB+fecXdkWyJH+a3wxDjTsqnPkcjd+PbwzRUvg4eiWmdQOa8ptDcQYwyzC8c3JWBFh8AL++Qdf54z34p5Xf0FLn4gP4Bn5IXi8HEXNOzm0NsB38fNlZmJ75SQRoF3ILd+fTquQRfCMSJs9FNg6tMOZ0AlxbANcFn3sMwE0X6FnOz/PxUbfUiylwb76pobhux66WvwsrNMjP5+x6lKeI6Fjx/2co9Jf88e58boA7ZKVdovd/EtBhDOYE+0OAw9HVMPkJ2xfzxHwSAZx/o8M/dECPzaiLUrIh3qloD85fwW8eyE8O2SWkIdvrMLA2HqzihbMlhwwWZCRqr96THsAfH8S3vLGQ9Jotd2qdmChOaGwaOZ2JDDZGH9/JWlJ0XJo551GyNy/J/8Rf2+P4hoPQGLkHpBYre21pvPoMA1F3pLb+jQxAEaDei67ek56Db/DHmFnaBVhi9Tha16kA/h2PVnzhy1FO4OjqQ9FT8A3htmQuTJBMLs0weRAphGGgeeKQswogajepuQj/ZbcZCY7qUMJ+Br7h0hwvQokWFSDHEbHdpne4WC7EcayWc440dbUDYHsHBVt7Cz9d+6bvyDdcm9OsLBMQlUTkJTjhQi0nbSgc30WAnOXZCmiRm96YWzvg1jzd3nzDS4u8RAiJYo8jWxRji05A1oFCF96Ribc4zqtJXMlMWAg742Njd+2Zvi8/8gpsUxS+g81LD7ArjrGliaYwv+W3zMrOFVi64kvakp6B78ryI4sMkQXfHyfyM347oQLdhyNL6t/eErLWUsxmTnVMVYDlcu+NAr4NnxxiBywp/P4+fHDGlo5H/DdPfCxL7t6IGwFVgUVQup2AtwnYnU/6cslH4GePVCuFcDgiaUU8FWMvAkoWG5MSAAlc+KcGLgY123rIlb473yifxG5oWRgE4sxJ6ndZkzycb03jSheIeLyIX5/xPScb/g0G2JlvtL4eExZj8ScFAD/MR5I936LR0hSOax5bx6DG79QLH7/mOgNvNsB+fKN+RxYgCxHVyBSCh8fVjGxLkz8XoOlZvEFb5h3Xs1c+fXe+weFc2XqwKYsAXn6D93A7+OG7rm3JY2FqWzyJdah6IJm/pdUY9SYD7Mw35ZsphM8CqG/55BV+bBqYnvhQFj+nq5BELtuj/es5rvYJ+IYXnipAgwr0AkgLF+C1gNf2uKtZ52eZgTwG6/ebnAvovz+fdOUs7lQ0lJIll6o5DGth8kUeqILigeTs+vodL1WBS0/ATxw/1V2mCNB1CFzq6p3LYQqo4KkXYmR5DbqgnHGp89C1359vKL9V/1PeiwXIpEMPeB/K/aqcekfxiSgSsvBbAeWg4+qIbvHAO/MNH7PCv40AvB3fpe6xEZ0UjLILKpZEuHc1LDT7yfPKpS/ZHHRi/k37sL35ht60nfGznEP3ntpya1JpnmbtD/zNzFEnv8Th0HZVcKP9d+cb2ijQKcUehTOwuHu9gNPkBHyc+bkQuJfgwKtql6l3OK7EPvg2A+zMNxsFm3RbJMJRCNI7EphrwzRxVEo083Ot7NepLQIkk1Nu7rzx7O7efMOHlPiE0YqPPR2kEFBHXrIuBMedsHClYEBYwouSZDO4vdFmGt6Yk96bb7Q2qX7IaZghRSDEn2BOvKj+x8lixE+OvFNHuDr72ovb1fgvkvI781dnnN9gTl5juQaGynuH3dgkp1P1lm0+s8ECdMMSVMFZNJIzPRUfzVKHm9Bg1QZlZw0/sBUVPuR4LyWrk/aV3LaE8tzZMowEx9PwjQqghVcWitTgztyJ8/GIv7yfJlmNoUcqlyxAv9ZE4pbNJpTvdqOn4RtVgMXF4wur8AUF04JTucMBnlgsD1+8fCBTV8u0Uwjd0iNi28IlT/NXh6V25huZRAzmPsBC3BIOxIwD52UkCOFnjgsEjCPRxA6Kd2sXAtidPxHfmJ5Ts5GWMOvbRz4sJArK9/lIklaL92OH+TfJSnSGt8/HN5uv7JNi/EDcAXzjCBEdpER94oWnHODgeIxTExfTjz/Lk/G1gT8z9lSPB45E84joYxwHjj+a5jSemhOmoezTt/wSzpin5BtD4xiaA/jliOaAk3Pld/bRUBMOOEXKbcXrvuS8UP9cfEOHoRloPBF1WwHaGycmHoZhHA5jEaAzUJLSUp94Xr4pc9FQ1xU+D0x9sPmTlXOeu/wUfnc+Gg6czYSvsGOj88CsZ7Q2X3l51u5G35/PTXbiXdctLEA8MjJS5mva3nxTtuKeFmPMMvMRJdTnfgnf0NJ6PwWv39dWduaP/jbT78MnzkqH7kLAg7/M9BvxCdXYGBfNrfP2JASPWzd/Bb9nF4SalApAbSbGI+Lun883FCP241ybKle4IMt7kZ/PN+spDMVR5G9u440n/Xy+qbdzFhyhMh/eN13yo/kGuywuTa4j8ELRz+Ybw9tM3mmWx7Va+yv45jKyhiDpEfodfCMKNg/Pe+Tn86/afbdaz8d/tVd7tVd7tVd7NfP07b9fAnkLFhZbpQAAAABJRU5ErkJggg=="},"look-head":{"file":"look-head.png","frames":8,"renderScale":1,"derived":true,"url":"data:image/png;base64,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"},"turn-v2":{"file":"turn-v2.png","frames":8,"renderScale":1,"drawn":true,"url":"data:image/png;base64,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"},"lower-a-v2":{"file":"lower-a-v2.png","frames":8,"renderScale":1,"drawn":true,"url":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAABAAAAACACAMAAACiPOt6AAAASFBMVEVMaXEXJlAVHkjMy+Y2fur/+fAhRp4QFjMsWcgpqfPs6fQnJT7u9///5MsmN3SgpM7/z7RDWJSGSVNogML/qaF7kcvmgIhjyv8U5MTiAAAAAXRSTlMAQObYZgAAAAlwSFlzAAAD6AAAA+gBtXtSawAAIABJREFUeJztfQt3q7rObYGAEqCQZ+///6d3zCnJNoSsnQAhZ4wvPmevpmkbGVuaelr++fmO7/iO7/iO7/iO7/iO7/iO7/iO7/iO7/iO7/iO7/iO7/iO7/iO7/iO7/iO7/iO7/iODw7x8d2F7/iOD4yPyh8oV9V+v/9iwHd8xwf170cwAER3+92O/+VfK+A7vmPTISI5hQ9je/kD9WTss68f8B3f8TEB3BoCRPZ7R5+9ju0RwK2f/FNu0AcNsO/4nxgf234RFz+TQVjhW5KH7z9EgGrrdRCRQ1iAD+wCtx5rUH09oE+NjwLwJ31wyQbiv7UGpgFACNhXnWSVxQI3Xv0hBG68ByLSBQj8CAB9x8ejYHvqXjXAt7fAXQVX1eYC6PJvGQDZYwLdxkswlP+NEcBDoAn+fBFg46E6gGKwfQxqpIC29cGDAt7jwSGA+wo2+Pb0+di5SPYBG2RsAm33/I7+A/pfANh2yMAKhgRuS70aKaAtffCRAGb2/XYAkI8CfzqBz0DgXiTvOpggW+5AZbbfJ6Og8n85AHkXBdvUBru3Pzflf1W41P8+nw8BQHhHNgaAsQ+yrQkwxB/1gDZ3QZKxIeHJGWxPPb+3ADdVAMoAgX61Lf0ogHnyzgf4H5uf+zsfMoFAf3MTaIQ/G5P/oQti/PeZ8AN3XulXn4CAJAq277r9xlGwRAEwB61h8M8IYHxHtjZBuPM6hU8BQPUREyjFnw+Q/0kDUBaE3op0mIBo9E1Ht/0EdgMI3tMI+wAAgP2zzTVA7lG/KIDVlk+PAYJS13V5ETltbQomCBhXZMMV6AL+ZJH8lgCw/2QGJAKQQ8D+I4VoLoFVt7UEahnMh4JgZnNWlUhf1nV5s1I4EWk2on86YwbSlBw1SZclYGCLCXASAwu80zdk8xhMeGDqoA31zy6oX0ci+WgAbnMIGkkgizI+AQBd8s42DCAifXERqXJR+StLyEC5lQCKlG1ZtiXgx0YhN0WC23Y62KIu0hSFggDzof8nYiASqrB2sAG3r8IaVKG4Kb4xBAUJTOe0JQNUqQWoE9qEvEjrWrd2AeztZbvBDER6TqAs+sImUPcBCrbZAQ+85dLqXMz+aTaDAM86uOcDe2g74tVEBHLDIog0BcIl0EK0fGMbJIbg9B1MxmPi7x6dJn6cAdQCzeT0fsoijfJ8femLAABbCSCf1sWemregAlYDoCzbegtPBDaQUjcfhAhQl23bbmQDMQSC7a+xGW5+bAQB8uEIZAoAMIDyzUNgUQXbqucUya0MAIuBVVUmUrRt2Yt0m+y/klD5L+uiv1zOkP7L2eXPVeFb6Qtwh089GIpGhTTQw2+agE9DadX+YksI1GW43cABjsWwvKQt27J996MPDQAvAsm38z+HE3CJ67ZPgjAKtoc5WsMb3bIiAVROcLf3clMGwL5L93YnXI3csypgROEGQ98W6d42CQQa2rYsCgv7dSERwxiwNGVbFhTE926DnE3uSAzxiLaO1tDb2UDk5LZO4oMZEmyBABLjX7mavNvmYDXjMYz7bQkA0LYXSOA+aENqo64s8aN3k8+5/2V7FumMPOQBjMgXzXsZr4b88Xk1E7+DL8KzaHKBcBYan3vPBMjwdQHwCUogtQYF5N8ai6B0m7ARb8PoTBoRIj29kQ1C7LPo+wgAA/x5G+0J95fkNo1ApC5IfG9DG8QZIHBCWZaNXLgZ7fszYQF1imh2FoEBivdNwB63KJoof6kYMiKuq1C/gxmCwnOXL4kExYCQLs75TbyQ+CAwwrEOVYa+hBqNKQCBlqJ4C/1m4INdCLucyAlkMS3zjH7eOE7u/jbYEE5iwwhEWgURSaIQdTMP3Na6LPragsB1b5HpN1ufXGQX+7rvqXChdgMUvM8CtYATKYTMy50OfmM2QBhyb2F6jQQ/vqgMpc7vgUGYeW1d9K26fSMUohdiNkj/nhUIQZiWMDwcMAjbvqEWeKcFggH3N2W5Hqi3VTmex/x88J1NzsIpPTe8uAcnuuMSVHCY09vIq7C3pxEH6NuFyA1K4B3EzdaZkD9/tTP2fJMFYJIVqd77AUCAlrvwxuhf0TdTPohigPpi74DABiGnFqCven64+mQCNUAYDPp5yxBWX5LlXeWVfdRJ2+VAgEDIuwSJe5/YjUjLZWBrxaHvAwveFInRDHhhgX9nAG2NRX+sxk9VAcp75K+1gqex/MVXZAwEqNanL00xkP/UAEknUOjevM/76qbF39USf+ldO0B/r7EIzOjpoyJ6VxBERErqv0a64t4Bbd8vhi5tVXSFAEcnSMYGWTDEmUMUjDVIg5qI3i3AN/nAfGTNfN+JAGdQmBNerD4Byl87MHtT4qkAlj005MoTAL71fR+OIT4EAKRmivYtYQjF+FoGkxhPQL2Qt0CgZR8mQ6CRBcgAzbsAoAxC3/cIQsEQPd0MAfDUb9j7wQSCIWoeaVkWnZVjIDD+NsqgrVm3glHo3fTyA4nepgD0s5kBnGQ/WOBqAq6uAUTOdd9PP/a9ALbt6hCkG2+oezd2YQI8nKrMsH76B4xWp+L3wAa5FCyWXnsPyv+IwRhxTPI9ANB4FeZdFQaUH9wTMw/eJocBgW63kAJJouFvBgAN+cHOGe96zIwaML0DABR/7py/wQtHyNXFr2kRf8vQBXeS+wYIgGjUujPQddUzIJRyyPzucFCKh8O+Ql+23cEQQOvj1tc+Bdyr7BkbpERV4KrkG9/Zf5MHTNFGXDsMKiH+VUPJD60gViJabeh7kkA2Bw2xqAlyg+D3t4uVw1hBzPuIN2Pxv4+CYfNRkVO8DQCmyceXORFg7WwgC80KPYMZ5G9/cCzYUQD3+8O+0v4QgOiVAYC5NR7+qHaAIdA6hIGKBP3KCXSM07/hEFTRpJw/wMABAjA7s+oMwNnFQ/lP5yFN3+OI5uo6oCyaogAbTPlAVD4aByuLN8XAYu21HcAKQ2tR20be4X46/eax/CcBMerg9RF4Yv+n6asTvjIQJvIHGd/tDgfI4eFAUTz4u3o+e7+HrbQ2APTJBFTmUwCwdzkPmgBIF/6sbYPgqawP7CMAUHx0h2VN8lK22Nfp/R8igEUh1re9ayZA7ggmBjCt8foNWVgROZ8RBy5bFFoFDAJtVmH0dRsicO/JAUlRPxTA5HUuUvRr+8AAueedcAQCTutyHyxa1b97iDzkL4qfmeAGD5gBz8qsOgEp7BA4JwDrv9KJOADsiUa0RPZyo4pYXQJqwyDDAD6sDjRHdyfEIGhVFnDyiQ/2YKAss2+ZsFmTfBE07z39gAAZEYAuwnq0bQJcgL5HJNpTUakGhP3hx0PfE4PvKYAP191T4byjARNZWwVrDAza9l7m97uh/lnXB4YsnWoVP5V0eN37EQDsKRf8Cgxa0xuj/NdCEpjAQUUQi0HhhzNiNwU5Btb1ylE4RkEac4JAlf4GqYNuYoMoAlwKnNFajTpVK1pBg6DShMsV8cecMK4MDTaEqlfmvxYg/A/m1/rAoqAFuhrtZAJlgeBqNkmdRRg63hACpVatT7yJA/8zukEYzQk25WAu85rkdf9pb1MANAhm9FUfHgIbEAH69cQvk7ps9BYS5bxAVeUAk1EBDFUpKJRY64A2S1zaS0h9RrU7wYP6FekYnJFd+Ri0doLHk2PA6Lh3QtwE6Fmjuxp5Vb+OP2oKadTDbS98JSqpC9KgT9O6AbD6oQWaRMOIPqunQb3Y6J85WNGK/LZ+UxEGZYDCBx2oJig3XFUgtAIN1H2FIqU1nTCQbwupQEL1TgiCcfuDR+wmQIEi7bVoVwju3OHuUP7GAnhe71wKJtDVrU/gkec7pC9lLfl6TWLoZLY48+0WQIiCjJwQRyiA8GoIABNMDUAynJHfqwXk5CtnBFCvYa2uhwBiRuX02sfVNwfwDXkot0Amtz9xQTRTvnoMQvEfG4B9393vPy1TFUBFYJig65HHuWMnv58IgikAWTSO3LeWEw7Ilbbt09KjyTLYwVfYDGwVuMoMVJpGhB4FwflvJ2WJkzqrgeBeuqJgJ2xF/GDzm/wlTkiAoPaGma9EXvqLmMvhQRh7YQBgcVhdBdSEiax2X5UgA6IBkLjOCf5r5INKiV26169EYZz/UR3oIAtXAvvekALCI+2GGzAQQH7rAoj9WtsH7ml/EH80COYGKKcTo3Cqf3qe0lqFND4tgP/DGthRSYSUJzmswv/abK2/pQDA/0ZTGR5QlMuKTdoIgiUNAA5vhKlpD61GcC8ozuDUntY5Jw/5P8EBsCAHKHKnGYnwIEhMQ+j6ty2bVK0DQE1ZFCcBQc8CqymkJG0ymoTBNXmrV2JqA+jHOZBogRCqVtW+JoA3qCCIHoF3PwEAKf7nUq/XnoPyX8D50ehP2AUKP/eBUbiBE76SAQrDWyr5b/1rkZjA/o0cVukTYXIc069PAoAcDmshAJ+jaGFSTFEM345nUPMPVlkBilRS7RheuNIPABAZoF2tT6RoBCKn/lGfUx3fof+TGKColvV2latM4NT3hcjhvwFAPZB1DRCEc2lRcelVxe5GCuDOCW3YIG4tA7AtaX8O938yCOb0C3DMSuJ3ONyJ3wMACGKQy4ESuHgK2urhcAjsPyI0noB9yQwA1mgTQwm8IAQ8tdKPZsDkdA5vRJZTPzEC9e8xAoC6ZrxsFQuk1ACAlmF5xdUgC2TqyA3g06pRQNaBtifLgSrgabJFxcB8D0sCs3HNmjlYNt+q73Xgv9Z/X0lZd+jVtwp5qcM5nIfkx1GwupZs6fZbr7VJAHikDocAsNYMYvSn+ucEkqIUxYzlO8ApVBIM0P8CgGgC7Fa4LoRUO+xm9RJ5aS8aMF8JAG4eAKUBYCkIc0H9cjoYBvbo7ZpWOKtra1yHq+5OnIBHRM0fognQsWZ2zSx41QlSwNOc/nD7+1IOK8ShtflCtD+fjMJVUjfZAZd3LCPORzkMDPCRpNn7Pj1/IVIRABbG4Ug3Qzwxec6HgYg0JdSIdESARfTDGoTLX14AAMtZLdoD7jvKez0D9ywAoGgIBTMrcKAAf+JlAPtYjaEyeOeAIASxXkGeVrZZDHw/FYI3AAhZcJ7WX4c4o2BIwoTqo0dG8NgJxg4sj4KZDe4XcA8yrv9mv1sGAVy2C956ZUL8HjjA4QVvC+KLZc+vxnSezmB6AqOvktuNaYv530zqMIPnAcCWYMkW2BryCuCXyBv/LW+VJ/Ak+7EHmhbBTFHv63alFIiXQVsOPuTghoVolgNR7rM6tFWIqwuWRsGetAAyyWgDLzWBEcg5TNng/wUAWCfeFrCEupY2T4jfI+oJAGQ57faFz5+z+WwurwMAG8YvzkR6EDKuwX9IYFihTLIsUwNuIfm7IOhTAAC7aQUTTJDWu/N/7oywMXUmjleKgeVyZiE4P9oOnQAAiAGMww1j8KjDWa8KBfKfCuBDHZj8AtcAs1u6CB6EqwYxsH/Rjyb4Ck44p59BkgOVUaz7nhuj/qMILgIgtT+zIQBUzy1/nueQvzUAwK6fGBN7BAA+JCcCLErGm/zneSjEemSBjkQw9xszli1ALp1mQCaJpNSHfCE3luyuEgNTCyRLQvAckxaI4Q9idisBgIny0wCQOMGHw6FbCgDcSwSUEzL/FsEQhrfW3YvYD+o/G4rfNAck37oOcAlcLP/Z5AwemiC2/CS/HAIowM1TNsh4YjqFZSdjNJECYb7TAP/lgSgA58uuqxJASFm/DgB7Uz9LiNsMpiyQuzEgn7NsZ60U8L4CBiUA8JQAQm1kS30wv3btCQAYO+EVhFc9oiX0IX4DC+Duxd13EQDwt4sgAKeq+SHZfwHAnWcmktufAgoXLQGeI/GCHkLQyAbbS6YrsGQJJJhACZl/GSCBvq5/vuxcuqgNyZKmIZER8cB2YwBYIQYrpzpUov+XA+TkUYm0iv3BDx31YB0+6oP1XyUGxEufCeP/7YRP2MALo2Am/goA1dMAYPqp079doIMD/SxrLnczGH5NXBBzA08mfTaDmauAs6e2BndL/R8MsJeeU8d/sycAJ2oIgI8MkPHW+NotA+D9fQRC17f6DwBYLQTJqH6IQf4XAPjS31g5ukIO2JJQ6faP93l6JaCCEYheDAAPnfBHIhgBYBHrB/lrmtiL/47KFDvQS6qkODkGzOF/9n9xCe77UIZ754OYwI9XQqTvswBCM+3wCEG5H4Z4rAXveBMdhMIU8mUTuO+G/lgCPBQe7Y/5ELw3AMieBIAYAV0nCaRijDr4lxwgtC1YxwCp4ExPG4APBTDY4ESAZTEABJHAPfnzTvjYBFyqfpuiuL8JaGBwWDeCUJulDFgUhUlwkzWv8j/IN1mD/zcnHDAP9O56EpIn4szCaRxcmKIy0ADFZG4Agp+Q5MEe7EDihDgEF0VRd3wELMSrG6EN7nQJpX8BAGz9G11+kd+/v795XCD8IFigAQAeUB+jYiamtZYnwfaCbrfpZj8DAPtVDJDIA8/jfzBKVQKXtUgNTnj2Hzb4hAo0H3wWBET125yKIf46IySv/BvN0Fg2FvqvqHv9mO7VmkjQJwDkXV2gE/rd4wMJtDtPVXk/FCOvz48/K4oeAbz8ZfpDDwRTeCEMEsxgzqAueDDsVUaQ5u/3eP3lPvRxC+5CQFP8WDl1GIG/x+Pv9TqrS7J4NPc/4efeA9Yc6DIJtBDcqAPY5AR8WtEFMfRaQj81wUYL8E8BNC80McEWUs9jI4a7FZjYENUAJ7eg5xjgED9T/wVSMPq53oBEG2BB+JiSdeIOABRBnJ8tirou69PpVMywAC6nU13jExLxI1nStdOPRm6AQP78Sp9jRodAW/su43MUZw9C3BeC3NvErgLqOF6tjJXz7+/x9/jbSHbhVRBjy2fMf2P6ucJPI78cf3Pa5AhOMkzqv4cAED3QNVIwmsaSLHaj+I8ISMSfXDuHLXVBTIa6x1GwRwJoMaAFEBBVUBICe4q+aoBA//VuydJ0TZOrDI+kj+LnrxOBmzABIvvPigHEPw+tqOIM4HlEBBiaILb+ih4Ys8wwuJ44WqoIdJlwg9LlHszAvTD78xkLINffKwX3/EdPIh4FugOAKYHg+mPaPYCE4yhrGsDVgNxUFmZB6CXSr+4tkCcBILdCtIUWiIVwun/lwe5dEovCnGCBLYmCpQ7oQ/bDC+9GYe9QAjIpilOXxOFeI96XrQlf6MbpHSdM5qP8DX4UTQDRT5h5aRPTv0F+qAFM7asJ4o2IXeKCRZIUhJJ6Wd/m4q9DGEDQS8HtRBpPvumiczWmIKjiDGqti38RAI4mt79XsT14yH949tQAsBUggp7NAPj9/ZsThpWzuoL/VYUx4YGq5ltYBaFjMgb/YAIRABoSX5aBjQKY1mHdb4Cvi/fGNh+gKG6uhF/MxiQx8PxUFLegfrwtX3oXTqSfTgDki6LvAEJd173YoBKXPwflFRr+uvo1EbhDgCCTZoMoAMxsjMBOoHoThXckjgYARWw8gbEJwNtj5p9KYR/6sAruAHAC2gZYe0CqQaS+iU8gxKLqUhegOb7IAK64f/+Io34aMtl1xXxDv5EXZiZAXd8cAI6vBgFEjtff4/EoedaEMoD/lL8IAEWWyfn3+vt3ne8Bn/+Ox79fK6iJ0jYxgXsPJJfmeP39+515Xxgk0NV/USRnMXWffSLkhhCEGu0/w2CX3LXwawDQpB5oLIOIJnDiBIfU4EgDuxOMQNSry2A9VtmJLBVu70GRqPsom+MFwAUB8zvE2l0IAYLc7fBz6UMEGJgAKiN4hNmdmUSav/NZ71oLh+HSKQxsEEfAIQShSS610PF6/P1tZiFAAzn2IGikb5Dj1NwCTBFYu+ioKVG/LP/Ho/5lw240D+TMzc77CIhcPPxwPM+7pg3L9vv3e0UY5PkcSAIAv8ff3+vvzPCnMHPjUTD3wBIBTBVQMACGTnCO65qhAi+nU/9aGEqNjyaHAoL/6Q8/0IAp+6n0D8JwlZE3J/r1JQADeR+Ind4DEFQeNCDbEfmJcAUAtC11ANihP9Oy7uB+8Yt9Jr+gF5qJ2uBqEPzULyvhegT680iff/+uR6gvAGFQwL7j4x0Y20BJQQwM6bJERO8lVjTJPcqpDt0gEvwZU4/7EhFYT8Wdj3MiAOIWyBkScFeImwhcwPsQpiTtU938hc94kbjPgGGQGsbTmPBjC8StP4lPMCv6wfRtfiuoP70f8yP8D8ZpNdKAbkDi1rLX6Mst8YDx/CMjfJJ+YoMnJvjM6xpN+FSi/fglrgTAYPfH9ECmMULSIxVjjcM4wQQx0qEn726XziD9HiaR0Z9N17jXVqEbLK9bQfdbwDOrCQJwBvJb0ph/KRsvjUYAdGgDnAAv0y7QmAHYHrpt5Ph7bF4tCBaNQWLW5wgA3hI/Fbjo8Zh3ZOBTh4+YCQDhz6cA4D7oOQSAXtdvLgBoCHgUBXMDb0IAPTw9XP/KHGm0M3o9DZbIv9obqRGeaKN/OOG9XpUyOxIThG9XmWyFnvh8c4AA1LxRAvXvlreGcwiK4OJf9IaS2BPiEAHAmmTPR4AQhDufT2EZKr2W0LdZKxFCWxx95IkVkKiMXjIBrscjggg8225aJXIAjsVNMEDECEMAdvOaYYRLCB7IyasQ3AFmzDN4g4hApCd1XfuUYQ1n+mBBgv8mruMdBCOCCx7ekZsj+Dz5HwjgyVXQUAOPJDCFiJgI0vtUZwggIlDQ3uFOzCF5x95I33YjIBLJX9q6XHBFDk80UrgCAIQODGMEgHCE79GRm23qD8uLwa3pVDUGAHyfIkCFKfhc9lWuL+dC35/rnyNuwxtBkNJhGGJkg6QAEBCgvMAJKK9/r/GiHOXS4kK+kIbRpcAK2E1k/JYAZDviczROQGMqttOfsQJHBwDPwgYGrMbxD53LwP+ABRAA4HXq6QwSAEgKUGNdRExExwi8SDAg5p6GYhpKL0MemVcWhAqAnEBvIoC8QmgHBJh5UyshQO8DUvKqaJT77G4oVY4mcymPGiAs9cHtw/IAAEHE9RqEBAGqXSKADEHoXy89jev8HCUrgEwCSAo6iSjqcezZ9CXkz64u/4l9E1c8RQB10+ISZCaggms6yvJXXszEid0I3vqtbGFvzQUawM8OJljqhIEVNYxazLkosjknAMBCvGBc7Kft35ED2gsin0DQmZcUNr1vQTyM6PgCH8/McvOHRkUYEiyARXlAXjms/l9gdu1DQic4uZnhzglOLcD5E5gwwqO6GbRFggl8BwAgP/f5owEgFbvsKpMHegM8wISCgHAtKpFO//pnhRnIvhsDgL6KM4CBHl5FBJhpgoiH4a8GQXQAfKUjEKRCWCXXhUFFhdn3bSPl36uqyO66w5WwE/ijec+EAfSpIwPiHhHJMmESY84KXDWG31gMKjggKnFTHnCaA7Hw5/Hl/ONEHDRcSxOM3QSBYv1vQn0vhf31y/UPcWSTAmgS6JdkDhE4dYINNxaeBVC+Tz85ytgQAWiD37mgSzrysK2YNkNxAIjiN5a/qKOVFdFFYTkAZDaDSjssDRU9rY70m/CKANAto68mwB8DoYcDmoKmDx72IsXA9Efao15lFU36X6/Ek6Ko2dhC+c8R0DSR5aJSBkg3oUIrMtTjsp5qFgCckUPnlUQZLOvUANa7KdX4TOxfxmWCCF7KsmjkusAAZSbyeBXLwiWBrqkc7MD9lr65/vXA79nkOQW9DkgX1NY/UcFjJzhRALggxS3AJfSjQCdM50I2QAAIRgoAgntjFgGQKzBu55j5TePFb7KhKkYnxWwxAOgEBMeLw8oORS5STegbAGlbtrm0wX1nqVvcNcX+KneU+DJuQdwkTVLsxXBTyqKf4YpKUbfS6JXEu7C+DoAU/pEB0jlKHOCGW08kXKkx4/mbM45Us47CrjyMhr7GpAfM7+aHA8Au2C8zaPsCHM8i58ajMImdYUfBBggwSIFCe+MPF94UHDY9GoBBAg3z4hrsI2toJsR6qC/Jg9vn4YKJ4fYb1gzlMRECAJBObikAVHom7J77QTF6BJ2tj2A3+MKDAMsBAO3NowUwWvTxK98pA6D5UUgEAnkpJlrsQ5XGGQT6u2QJEgxU7tgFIwSZpBkTkPrSZB3TIJ1YVDNhsnEQJF0NAoD3c5oZBy/bWAkWfQvlu5H20wiERyDVPMUFHagDn0M8CYQjhxVM/7QOLPFB1B4f+gAnxt8X3hCCfqB86mh4DlVxwgvwi9L1xzEG3f75LGgf6J0JUwBwVzBhgGAl0gOtcCh6GXljX20wZh/dpfseZ+Pz4wVKfJXp7Bd2xedHVOzMZ5SyJNiQQu49fTUAZnflbOQPYfgWaVQWc4eNTpYghaOw/GaEOAbupJ8ThoMJgHoUAEAwJlL8wYvkhp4Um1EnZEfJ5zZGFs0h1659B2ynajjhBGDPEINxRU87kMCXq1ELm4EBwGEIAAEB4CGnczTpA3bPdH/ijA/3PuggGDttAGpuQvYLRSAJgQUASFad9FINkBrh8P6XOuGdurA7HMdM+H+AOYEXE3PBbmsx+DnNJZ9AEAXQieaIAYeV9hcWcdQLbCKnshB3dkMMmrFn78oVhWsganHXB+uPmfr0ZwbCoALzHJfyhYjGwADBqwkwpAjsdtqScC4ANBeIX9taEnwQ9/DVTYGwSp8/gzsM5C3qIhrhL59JBYAgDD8IwqnY3ZnfuxgPUoOAV4QhiZqQf3URLATHpty+/vuRBxhDT8kPOD9YrsoAr9INM1aKqRM+lD8Wxk7wH32x5VG4YMVrW7IQB9ASwYQDsvCbYE/P1Gf6i2fEkmYRdzp2tMyXgC1ibALm5vj3LJnzddC//zviXP2sbJA0rOLw81z+wd0+MfaTKIQ7QZmDkOH/fEeUZ2EbqQ67BAAHgZ9EA4Q52c3hGRsDp/L/yj7Ipa55kkKjfFG5eAyM1QjpMiQB0DxsWp8IYIXU0CsPb6dRPPagD2dB+JARD4sfZqP2wEEuZxxpdYroEvZyQbTtKE24mJSBAAAgAElEQVSKoQ3kMpcAQHjhKTirRpl9JtmFikeBovilwJeog8CU5gTvzGxfmIUMAggIsM/HZa3wzNQdgJhfLgEr7NJq/aYS+b3+Hq+v16I3Zz1JljTmcp9qz+p6VFfqnos057KkuSV6SZyDAA+UMJl3nRMOlqZAGCuc6AzPpW1qsmTfkSWwlEWHGDkXwaBy0WkIEs7wzEEFDfzOJPehX7uM/IeZjOSfHeaepnyqG2m6TsVvAn6G5kdqANNc9k4C0QTHJ70EAHVb1o2X4YQ0uNmXvBf7gS6sKix/jsDtLQJA9XpWfBAGnzaB7wEgcwNQqsVOuNYc2OU04x3Qb9Kn1tl6ecKiShyUgp6P6K18SCVQeZ1H5LRGlYkiLVdRcjBVUx1sxVxqBD8tDCJXnp/hYZwogf5IZ06AEWqWa7Qtrq9Uil1C/5DJmXX4mMKsVcC97JF8eK5KOmKg6T1C4MWCjrzBPa5A2o1sTlsIveIIUZgYhkqijeGFRSB4hY5d4TsCH/jST09ATibBvBQ8OCAJ++1wK30iCvFVt3f5T1oh0pN/pUcXQ6dNY2Zw8ACSIyGJBbJPC0HNXNZ2mjKTvP6RftBAAEfBljv5C1EosAe/vkRzij4UaZqGGtgg/spe8kGTqc2U/98SreRwEEuK0BrXw2qMzaBK+VSW0lAYiQcMS+N3Ev73Y60syJBnjUAcBTv+lsernN0HT5SwTaBspS8LuWi0qjSnYED/cJATi0n+jnMAAJ1RvLkin9/VEJ0DvYCKg/7yhaS5DAM/JP24We2RecuLezkWFXX31Cckue1/WqAyJIcfPS8CYvc68HMiAKRx732UwCwNQPNSNl2yAACaynulS58qHjc7wymUNAif2kJJcE4vpwYAdFmu9AR68fUmgSGyxYjGWNZTDHIvSQE4EcBFV4RbJckhGzjhhyrzB0/qE3eOVqE4mFfazjJC5ay18Nc/HOkPl3OA2P+zTgFlXRSUgqJQg6A0PtXZRAGkBj7+wQl4+p6EcHrmiDteEvk3BNIAb1EgztPXhUaLEyHRChXbEKJP6Avx6kqE9tqIxsXyRkOgFqIfMDDgdYoACQO8pILTKYCr6HcEueYRwRASi0+e6SWaTj7FW6qm50VAkiVHEPhe0oLSwW/4V0hqbKeam/wp+rB+/3kEUvfHKY0BAKyfOAGpBbJXvNKOHgYAmR2hm2UCHLpBHij1w4NnsrOcXzAAEYbnVr1E8V9OeDSBdcez1O4AkxgABAWIG7LRGOUYCiKfnE7Tqtge+6ZsTxpOduFr6gAAYgCgKhgsifDvEAGk4JHus3ShzfQTj362Wvxb35bSKQI5Au5HABDoN4XHPTUgZibQb1qOOgMM2Rce5DvUw9gOkGRb1Ke2LPtWOxe5FyRjI2SJFRqPQ/GSGPvAtuUZH8ky8lhRtm0dqqZgtAf6+yH150VAnOlQYDTQf+NUtNtdZFRAz84vZgshCELYAgCo9s5ZiQc8qMLyOhStwdESNOWa8PCvkfdJEPJ3fkOdEYEqUB7zusxgnWIFDH8XdUUVuV6Pf7D+8TmGp7YNOZUwGMCCDGgfYCYwghWhWtGOoh7R2kk/dWQVPhhXPcfx+wv3+pQ7AiCgje5CTM+A4dkz1L8RNK7yUGXcGIEe7xIWfAoBLHrQ9/A0Gr9lTJ+2dBegvNRFcTYPoOUVUqF4OExDjklH3Bk3tdDepiFO6bFt5kO3RXFq29YhqLX+P6a0xgiARvmvGcE6Y2d8kjdQ1TVHr7FGC3YIwPbsuynqtIFfEQGJ90JZTi98YDBFfJs7n5jZn3YxHMIXYd2N+v75wjjYXuZ7uFIfXgyeVGGFGkg9BJXIvwzk/5U+wSq+IFwl9yzZg9pOaxjcfDT/kcN/JXt8zqAdx9MG2LFFRxQ64TUNkIEM1MyQehiucxHUGQx8cIuCaxQOCxGMsn9Rv5rvTuaK8NOUbV02xnF1IU3fy4lzAfW+PgcjNcqf/J61DDbswpMMeDYXoOXlnOzyylGbCVLWxakvCjEDABGJ+hyMZJ/AoCO/XjL9WnMmWHa4V0Dbe3hph0ch0C/HgxCl1O1FqsytwvCPmqHzrFB7oBy345oFkPnzlx1mwEOrDEGwg/YgOaFsyM+x0tUXTIAsaHE7VTD0QNz+TJkfQWkGwHmhYShCjOjzkgmgl1vZYoZCsEESxF95WLSDUQIFaFfqGACEh3/BBUInN5GfE9bURcBtABihbHfHa0N5brd1+aMAmv+Jm1lRBpKEQp+0we1A+vUqfVtHL3jIf20hl7LnqXFTCM4AEQFUkM0EeNoG9fxZgwfVfDJ2k1VxAgXEltNdI3Jr0IGf55bxpMEl0e1Q9rCPtFLup1UQWuNLzwPxyoWsTgOf85S7XriBQEfBKADzASFza3UKaUcSrSl9UQKnMkE4YaNrXjeEIAeAti3PIysIu2Fa6GUjOI0Ds7mKe/zugwH5cf+BAkDTSx4yBEodiei5OlDYW1u3Xi+a9MkUZdn2Zu2gcyqYf+B/cNuj/KcGwGs+QI5+1rYDLuPZqOJF14Rfdnp2p+ogszZ12l7x4Z/dfbRSYxs3OFghE5S7oc/Ml/ba8aAY289aHsoFkEJx/MOhEj0LItVTUSC/zuF4PJ7a0gFALNQaw3C1coC6oGWP0qNq7INrGuzveLZ9eHYHcBbreMSJaApgLnJWicsELee1WWQuuDlMcH0PgTLULsVgRdjNl0FYDVy2VlUYkbrEhmSN1AWafeOYi3T46aWoFamDvFhKYBiCt+vLXslFmc5FoYk5AKhHAAOwWyNAt08gqK+ROVWl7Ty6wAo1+ggG43yjuX/YFCZecHVKsIAuTYvu5UadbrAZiAb9r0qgeCURtjFjMYyurpp8JSr1nflt4XOIqXWKTHSdaMOQlyRQbRDST2WchvU4JR9mBgtPE4FBayXhjxfIy7GmAj5C66V5sIEGrtsGQfJgAVJNKRS5+FlnVPPByYJPrL801pOVNnif+w21BBgk5sokCoabYzwR52GiOImsqaFI0RUq2uDPrAF6WV/PEPbejEvUxNO308wXmkXmBAO0PIGVxAVIFHAacJhjhdk8QhpDGqiVjvguDaL/LDdl21aRruuw4VlydlekSj7Hm6m95geSl7mcHgwQxGJKWiBcApoiNVpH6uYkbhBOZdrcZ0gg/06BVKPKpnClRuFDWbYnAG9gvxt0BW/mVsxKUkADEXhBBWNkbDSx3+WZpkAsBlvUSH6gZ57pQpPORP0ITWC3PGcAgCOQgbmH5LEQXQIA0TXPQw4s7JUBwGvkGzRkg/xhrUuxO15duFwDFyqAZw+EIRfb2aGt3VABXxmIsvbGzyBA6oQbACkYA3bbaIFCF5s5QuM4nNvlPzCHGsi/NE2ig55sEkBqto7IOzSYA6fSoVcdEmBZJkVZoOtRw6RrTotNAqtw/IytsLnHU5gRxyUHXcfrMnQC8AbaWt+3ohmPBPpYgECIAfADmXuHF+jRIEJPLbkAgWEJIFerC6DMKIsl0JMAxnk7XlTQCQuhWoU9ToNhGA2PpI66dcniL80jL0a4QxTO+0OQ+eq6IAAAfs0GoHqKCVgNgssCAEgTYQfJI653cD4RhLAnRb2gvkScxWzQMLLXASDkoUs8rTQWDqEhRE/To1Do+nk2C7wVtA8bxUe9tSFMAAaSn9TAeCq2NISHJfDFlOuw2HWkL6e+8N6frfTtKAqHLcFJmGbkh73EgX6ohhiEqwq6jl6gHpPRMxftCYq5y6gcRVPFWPvO1PV8AUiXBA6hXXOCCwNwTiTLqPjg/4CWTYABYkzE6lg5gf18CcxCPaTJP2YCDVDSCCrrAtERZitdYeGptWA9SGDgwRctoBBTkUarHxtQLE7Ie+YC+wsqSP0zSwaCfHJcdjZ50Y9DbwtTLTH+Qeb3HGxZCvEoBD6i/QFETgHgdfvPjLkKNxUyrmX6VocdOvSEGHOg6ePPWXwcIIsAAO3iCICMW116DKDE0kcbDBfIOEweBibA9cxwwktRMDZEgRNeXmgKscdBXbc3uN+WiOcC4A4/9A8FJ1qhijnhxO0QhJsHAPhDL+3IKX2du0CSAYotCQXx4zIFAbCeSGwPNl8A4jSaLlNnqDMrFMiYSecT0BmqoQaSAwHwGPwMAFAJtKsazBtssOu1zaDF/T+tA0Dw1CJ9+tFzn9/scNbjWX4Nm47oC+yPvugRDulhHoVisUDcDs1m8XpZNAp4nvYBI+eJZLNoOj0ihQgEAqCehG3gl8RsgCX+J+DnZQBw715v/EyqsOAJh5y0HUYhTA3RDxN4mfngM9MHkEsLHyBkwou2bcsb2h0xDaVrUtMEK1gZG6LGZgoBAI5nPRIXbNAnTfCGlQB1gWtFuPQ4G80zolQBIifAPl8AAohOZv0qXqfxhtQGfyYVGAcPupDrPRfhiKfGOHdDI5UdTAQVgGHf+gUCYNPHyZQm4z1L1i2zbNXC0G/s0I5ljhL44XN7Keh8CRysQLIE9ILIDskEsoT/nQdnioDaPmZTGCPi1j2Y3oy86iWgDFR72iyNOGLgaOocE/zHvW/eCSOudGn6W8iDHoh6AKgRC/bH4PHj7b4vZ0E98mJtBtNC0JYRsDrWodHnp7HgCSfrFNjNIS/oanr8QxAw5KHg9qvjpTdG8uqV/syrqDmDpgnxD3UEctTzqP//ehjcfKATSaohCWcATSIo7Lw1jGFy/Vk4MeBRkeyBE/riAUW/qcwvPDcVAMsosH/r/SdoISQaSPcgueF8FgDoFBrKv2EOaNIf8W8Yq4GNzuUa8QAb282XwGYk/7oECnu5lgL7CmjV9EAAEfrdL3l+FjSYiCv9Fq53710//cCE2h9Dk1sRIALAy1lIcWVC/oP9R8Q5kesgDzUckCQJFMTfVz+9yON1/6eS3EJXhzQIOQqB4zIgVqIZ9eTh5z+9IZx2RqsEhS4qhNIgD9oXteAWXiSi+j6phfcweJQ/vet4VhRMT2LEKByFgL0WGAUTaXEFGNi/S+xPd0PjFVmzAUDPA3VZTv7vWA+EJdf6JPcHGoHkQ/4aa2SbMmB6d8OMRqV6UyPNX4j8xVtFcClYB4EsLH6GKMAw6mNMmF4e8bL816VWtoV0kBkA6hIEc8D9pNTc8RHpv2Z/6Qz2yQpQBk3rMQiqZUAGABRE9vGepv+iBs70gCflHwUBxHcoICaBcnxpmK6NSaCK7tZgByIAvNafxNxJnm7Ys/CVMThXQMyCuj+gIeLU0J54+lm8py6Yyn6uNQFYBARATtIhCY5rWDVIpkFgSqDGPzQKlg8joa9NA379IAZFGWhL3vtEbxQxOdrjnIAdE1G317Zi6Ie9VgrDNUZrGgjeibuNyAu1H6bStqxBgmHelqdTW7bnxOK8F4BZBkAHy5+2b8MQMPPujEh2EAFkQBro5V70Yuh/0H+9HlydTPWxCcOsxgfXpf5AL+ALwQTWf/7gXyQEmfrwMiQLQWgQZgIB4nWFLxLeIaCF86hMsmoMCMyPJGxGXxTegMIPaKv8P6A+oxB6R3YON02Koy+EH1VYan5BRyv43T15svzzWtPw4BFhgEtAtm+aukbTVqxB29IjwttaueTy7wIINyabDwAoJnYG8DTcLeocjcNbspAyUqnxP3BCZ9vgdt4fBUdWAH+5QMIa4/4OhTCABP21FjkJv81yBRawOcD4zzGVti5PamoVdMAJAFigRgMzZSl93d6mJGCmBNr1TkDbGxLwtTTEwMLVbsbKRKxCh1M56p89pj9P/jUKrfnoEPdk7YNFYd3+gFcmA697JAKv0xbTPxYIoQtW4InR8KMsC0T/YvwjTbeMqb/UEojU6VBYio8nMnPSZBZEq7D0KIab5nQBHiCA12S8OiBRvgOq/zUMbWXyPBMHfUgDlP556gd5ECo1C18EgHi82m3QuOldZwDAgPQ4DhS94L2E25ReBYCGNnbR26kf4kCBohz1i3ORpq/L2rKRPYrkpjahmm8AS1F2qDq0/BMuvqcMhvosrEFr0aBei/IeA8CMCAAz3/xgYlyvEbCCM4AM8vuTBQPxexM2gCHgjB6lQf6HBoCJncXBW15orekqydCW4H4C1cwGqTLEn1D9Z4Jgr3WCj3RwNUf+YQLIDpkttzFyZmBgezP6zX+6osBa4DdU/07SR03W8/mPwehgTpPZ/dLwNA6e2mOdnV/IUvmzMHAymZfNsOBeGgeYtr3Q8Tc0oKPuibihy69hoJkSoNqWQSdNPtqzF5RB0e6RZHxoA/SR0pzFIxaYAQBM/BZmifgEchYfdVnDK9T4Az0ihd8rHiPALB2I6wEM4WwivPHVJVKnYL9QwyDopm2gec8vbcF99e23a+uUPK1B+MAKAJQQcuA9/dkaUFL/Y5gEiswXPJAJB0iffp7xgzM/utQNkkxWhcXYd8a4vPIborFZ8xAB8PRzHt4mMYwCC46BUwC7JBOeBIGlG9pBbBE4HwDqsi1ylKGpCeaYUyImk3iEtEHYRnJgb4wEYAYA5MJ6E7kx0qqHj2ozCRwZ/GCENrBhJ+W7LahwcHLG8idyB2/fEo9FAcvLVH6JczjSnU7FpeGJgQkB4D/zmFDk1MlJr4u+2Wncsj9hPZpTRAa9DPpS4zKRiQWYRd2ev0HoWfcfRhfPRQSBhAWiEVLsPjJSTMWtIwESPPyBAaBpz6E14tnyaQSYWf/Bh9FPDr1pWAgKXdO3qILSkrM8b7g0ODBxT/3VZiCDKdR1GgXO9TguA28TQWAg8NQCzJZ/E7AczqfG4Vn+hF4ZCIPx7lkHIMIgtuzxDF43gS3Hg8GChg6I5ILPRCxQmBZB3mksuJpEgLn9gVH4V1w6q7sABrWt+yRqEqjM++j4/2qCB2brwMHg/rvTYxBotXjpWOXxf8zeQ7kHsLdreCQixoX4EnEJ/LTg3GqpfoYLUFEDz3z2QsXLgr56FKHVpoF+FtWyENa6ajIIuUQDF5rkshgEi5BZ/s0saJA9rEJ5ko51YKOtX1SCriQogKhFwck4Ol7WdIh8wDAgtoEAMOUDz9fAOG2M855o/II4N3X8mUEgC0ggKmfom594NvlBNHSuHdZdLpcTemwfi0ILEzzopv7w+XhkC0/PhN6rIDphL5M28n4qAWSOuLIbw4BXa0DOx+v1+qfJMkZtEDZeRQBtCjmzDwaBKMoPzhDysCUcn+ZfCAADaG4NJF0gD0EURdsW1rPTgjCIhRsc8ddaENLaPZhduN55tgQI1lmtjpvGf5kO8jYRevuoZikbJEqgj1H4dc/9c1cfqe62b7wMMzrgUfvSBYH5Q3bYaQWMolCVm+TNvSbPo8C+wQbAfVlr8RkOplAKgMGsEypgp04gwDwJ9MSHHbuij8lMV+KCqvhLU7RtTcUI23R6BvMuiqCzf8Eh6aJu25Z5z2gVoDMPmogG8UclBFPHKfvv991sAFDR6prrlQiACknzA7UyC8h0PF6vwu5VqMeWHSzBpABuPgD5JOQkV53AX3IU3nuDnkH/DIETT55FJsRYcAoCbVccAAoPNWhhMGeR8gd+TKQLd/T6KsySAPEkp+J9W1wKYp1lQCwHgwK1oq5PejBl7IEswZ84BcaWcFeaRcCYlDRjnFUgairCEsNZ7HAeyCYx+55M93qJ+DB+UHGnATAFgGzQmEeDxVPyZ0A0wwKnxhmYvDx84pHJHIZHd7MoNX1lHEuanMFcJWjPeGSova153aWuwR8gAb7x8arcz5NAaFIbUrd4fwkGUwQ6udxQV2mXRgd7A51b/D0KJnJBwDqW4OMAl4vffC8wLMHZAAhok+j78B6elJEOLQXzFVisgwiBNZa5bCzm2RKK21IRH3nauq21JAMUf354o1uCgfMkQPT0Tzj1o/ATysN5QqWri8B8+DF7w8fVcfyZkQCyKSjAFbCDm2YQdc+sJvMmzYW6UftkIXGvVRnx8ec26HdrM4a/e7R+AgZYSAAv6+CT6tdJBABbzskCwfhsvALWo+HtSXLWxtrhIFcBNQoUNXJyDwALdCDXISxCaV0ArBac+/NH9of6Q+k7+S1bBYNNBJpLAwH8/QXcXK9y6k6nE7Ty8VebmF4l72wKMATwOuXAmU5wMho9IcJeiMWfQ+D1WBSFgZKiTbgSZOgILHv+1OZKPBAthr8PQIxoMxA9k/Slrc3ucDukbXtB4Snu3oA60twLk7DhTFA2kv8l8I8mVC5f7vyZA67dme29HmwZD2InQRCU48wj/8PEFipvtQ1DMLUagAB4oLObMjQWVPdoYjVc/GAJzYyCNSH8pSMAkRKMGXp0DzDieiJnSH6uER5m4gFvULdThvEdanpjfu3GMyzNWnRZOWWtQ6OGI0qf675v5MRl+YP8FT19EJe/5Dx4ZIL5LBAXAE4QJa5WBAQD9MhHFEVxvCoEmsUxUL+Lnz8K/x8Dno3XfyAlrj+Ij3zP/6A+ow4WA590OYlcbgz+sBC8haEL+6N0dWSmoZ5c8UsxlxsgYQZFb1knnEFEFEIr0RtB6hk9GTgN7IlHPAZjt4h8kD88sPtcJRPDLQ4L6fcXNsnUcRJeEXGvgGc7gXL9BdxciqLWtnjDMLwH40z5ZbRAU/Fb6IfZRLwYBtc26REHPxldlvUpsP/aGByWQc6/hrMIwejotSFG0cMrCOb+/Vgkf2EOR++DbAvw07hPWvTwSoL8r8qD/vjAOzg8gdFsFAhMKAI8oL9MAobj3FruFcvOijjtUxCcIg0ADZJRcw2QdAaovlX4Jb2QA0Eaiv45JOPR08+EP6V+ssC3DR5GSQQQHJHuCLGfUYhU/PfQS7Ofv0GbsKPWPSLaEoIOqL4hPzTS/J15aJr6Nz0NuCwOlE4EVoZDDd/o8UawzR6z/zoC2MjR5c+vnvdi+LaGAD4Uf1yYsVz+AQAB8Drtdh66AqNPKkIOj+ivYYGgX7p6IIo3FgnFOKrTM01/IfqIinNHE8xMDVogw/QrOS3cR1OtiH4JCNESaOsClSDsR6UOgRN9gL0LI8CM/16bpjkf1fdtChx7Uc7rGnbNu17RfUc7d2lLEC4aC+BsX+ajkPbpPfbehl8bZaIdhL4QROLlrOFpHAhlEBp/mVqii2VQirq13jfW7FoVMZtkys+0+eW0l/N/YoMg2mNTcoEskCKfLEJZgwNt4MJQp2cQ6ABQ32D0TlVgrDiBRuCLqsmDjzubRUL4w/q/jbgo4x97aKE+Sn5/6ev+ijssEv9nZQlMJsBbMBByG4bEXfwnnt+6kiwj3SEDzdvqOsJtmIySPhVFJ39Xi0z7FXFIRHGEqSzyAc+/fx7xvaA2wqEWvZkYh+/RmFtdcHbGtL9L3LCFLsCPdIXHPvXSFdgdGYKUMMlJ7L0CmEQhairgny7xQfT6jXfKvwPArWnqVhe4KLUjTFlc2HhhcgK71SYQnK66QKu3k3WkIx78k/gq1H9EdVCNngA/HdoSgfMYkiH8/0ME16GP/hrwNlCK07blpekQoPC7J/JqivZz9+H8k6xfscHnR1K2kMZBEF0ZEZVF/z2ct8BFfewkm8vPoCZpkRuEOfwp+yMdmty6wNIP6oRGUTi5FHDkhS9fhxvPXLBjPAEAPSJwOlJokj8oA11RADXoCDPsRA0crkVwk2BKBuw46Tr0WfWBm7P1EzURjhN6RfNwAsqEP6sCQAsASGIwMAgGpQ+rSoCPxm1uGEDdzXuz9Be0nX0c/VhL/n+kRxx4WHJ1vobb30YQGI/jLqYLBYxEc2KB/t1u0H1hRW66AvS8s52ngtLpLA3CIw3Hg4fJxYsITQJ+cSAOVwPYYFHgcDfWYEIIPG/qQTUUv40HYuwXpjkgNoleOAGtc+HpYMpfrcyQ+ARjGcBtbWuJH1QuC995DAkr0OD8EwrlQlDibglWFcHIgYhCxiRMq2mZe98bPbFWk/+fwO5lKbR+zB85dQ/hf0X0owXSwwlBN/pOTugIpCZ5+IXQDZZDw5FrECYCsP6Vhe+1MR4hWBokR3A53jALPCyJXsMP4220Xn9gO84qZJ7SiHH4aTtsDSBU5a8jAYDkJvYxbfRpXep7xAncal4aF+99Y6dAxOItMcm63Sj7vFpzPQH4QWOoxAkKBZlwyvxXBvl3NtRa7gEH+r27vHB5vFHfBSHwQD1HGUYQgZUkQAfaLSj9Wk6Gvg2Mz0fwv/by93Q66PDe9HbKguZ38isqe0EZr8V5Ij1vymHyN8clMM2pwVlAqwxETehj8VtJATcF2S+99+TmQpijN8e/slAr4DAbFAfbC99qGCJeBDnUA/GqqJ91RuOdSOzyeVZB81AkYnBhBvDD2KN+RR1gHx4uSxzYQGiPNdBC1pU0dKlfi35z69EgmQYIvX47EFCrCDp5A0Hbp/WGXLT9HApgvScDhSGQHvic2P7Z5af/DAKhKX4MAMcLYMM8nEfXG4S9cE8QvFBUorhGRmjisfit5QULDyAEITTAj7cxv9sPsyRnBAC3dSIAcJ1c+7A58ooWKD7dj8EAAMOBiGiChDnwR+/ggnAGLycE+rifgKyshPjBnT8yXBC7wpMPOprlGyTg5+cHNTFRAsJM+gcmOPd+ZQBCxAv1N3ZMD1kAC7+8e9DucX5DJ5xTh4r8J8RvpTSw8X/UwcNLHFUiHpFfJwqfyn8CAHiR/hZGcj/PcsLJZzsCAnP8Erix/CUysCJt+9zECAo2UIqAQ/przyCIHSlHa2QTEfhJAFgPAbFPxsTu2/Gr1Z9fLsMIIFfhtOXTJxyHMXpj/w/9vxIApDa48mNciuk8FOzglbzQdO3T78YM+DYVNFiAgfxtxQPWetUtgMiIm9FPGE4b5W0PADl7Xz1C33dtvtmgoQbQnN+3EPov7osuYPz+USHIqonY1AnHDOJ3HhYbF4GvGoSeln/IwjZj4ITEGWwpAYMoyNuQ7j8ZgF8G3LgR+cwdoEh9q4fnncHR6HH/Z0Gd7wLpMwAYyt+EAramgKsFIwdG+D0AWBAskEY0bMU0UKYbH04AAAFfSURBVMruKfdvxwEpzY8gULoBHwCAdL+nXbC3ks/vHz8UpWxCv4HeV7PDHaDtAICdUVL+S74PCji9hUZjITPbsU7PYQQAEzzIl7yq3YivGoSLlD4OAJ+ZwP8KAPzvkM83W/xh1OdR/OeN1IdLPrkHeNFpJpaJKFYEv2kOD4XwfbyRfOAnxG+oAT8xg88K4EP82Yr8R6kr/TQGt60HcvfU06sQJ2bTfNckPqWFp6eyPdHP8aDT3J7+px9fPr34GvWMpLeLf0wo1ser8L61GRH8xC7cT+UjRD/DgoOn/qwEfpj89sQ/T39M9ROzGNH7wCY8msqmNEch0E/MYPT6k/izGfmfSPITa/9x+ndEPzWJn/+J8QnsmRK/D0xhMJ3NqY/iMNvT/xnPZFvyH6T/Hd/xHd/xHd/xHd/xHd/xHd/xHd/xHd/xHd/xHd/xHd/xHd/xHd/xHd/xHd/xHf/D4/8DxVGACKBCiYQAAAAASUVORK5CYII="},"lower-b-v2":{"file":"lower-b-v2.png","frames":8,"renderScale":1.1,"drawn":true,"url":"data:image/png;base64,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"},"climb-a-v2":{"file":"climb-a-v2.png","frames":8,"renderScale":1.15,"drawn":true,"url":"data:image/png;base64,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"},"climb-b-v2":{"file":"climb-b-v2.png","frames":8,"renderScale":1,"drawn":true,"url":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAABAAAAACACAMAAACiPOt6AAAASFBMVEVMaXEXJlAVHkjMy+Y2fur/+fAhRp4sWcgQFjMpqfPs6fT/5MsnJT7u9/8mN3T/z7SgpM5DWJT/qaGGSVNogMJ7kcvmgIhjyv/7x2nBAAAAAXRSTlMAQObYZgAAAAlwSFlzAAAD6AAAA+gBtXtSawAAIABJREFUeJztfYuS8rjO7SQhIEISAgH+93/TU2tJsh0ITOcC7DqDa+9poL9GsmMt6+5//vmN3/iN3/iN3/iN3/iN3/iN3/iN3/iN3/iN3/iN3/iN3/iN3/iN3/iN3/iN3/iN3/jiEBv/WRa+P//f+E+Pb25/0M23u93uywKYb7fb7TdY4Ly/Rfw3foM7cLfb7dpvbECRfBPG9isSICKbzWa324GF9tMsiGzD/AGCn6X+G//5MZDA/PPbH5JH0aMMfgWCdpGFzWbzURYUfAIAfGUBfuO/PLj94w787Pb/R/KB+H9DAIby/2kWJEuW/zsL8Bv/5THY/h/fgAl1Ff/PC4CxoCvwcRbS5f/SAvzGf3mMbsDPUqfzq40A8EH65KEFC7nILgWhD6PPLiWe/QDgNz41ZLvbbjO6ob9wBEum4s/xHRVAZGf+dwEUfAUAlPrXdKDf+A8PbEB6ngcS+FnqfJlF+h89ASXykKtD4pMiSA2IxPIEAX4qwG98ashul9tmjxL4WQBI33A4Q59hQaK45/INAJCH9f/oAvzGf3pg+4fXwQf2MeqSbPYgAB+OQ6Qr8GkWYIDIICDwMwF+45ND5HH7f1ADFYH57dlw33EC6gpoFt7HWcAC6M+U+k8D+I1PDcu/Tf1wn40D2mhKI//ZXDjz/onI5fKFFRis/jfW/zf+4wO7/yQidVVVGgiwI/lj9IuyqUSqsjxh/7cixQeTcUkYolc2ZVmWugIfS8k3sc9FmqZ0BPzs+v/Gf3fUIv+IXLHz61NZFhqUF7niFx/b/ZC7sikghdz7VVOW3ecO4IrUVf4ZCs1FaqzFR6hfSso9F6HqLCJTlT8E+I1PyV/Hk68osP3zXESuEIkP7ECRU1nWdvI2qgbUCgdl84HSxNoMD8pegUmXVUFVSHWBDyCAgm/ZXAtyATtEpGg+RP03/tMDp09TFjwBgQDYdteu7/X9BbrBm+kr3SLSr6qKbFAA3i0FOOeVDCW/6zpwUTk/JfHhrfR51g8WoSoNCtQq+bwr5FeO/N8ZUoejP/60k9A3oHzg9APFLm4/wlJZKTdvZMCMfs4X534cXQIAb2MAJ706PjDPU0qey1KJ9NfPQQATQb0Y9D+pfMj30e+zHLSubBfVUAAUECopy6Z7Izuu7BvxfLeLLUE6x6FK3o0/ZaH06XwHA8wJPpVN1RVl07zLGSLSgjxwrgrzNw8MTSPicfM5V2RSkLz570GAWB72F92vgzPoM+Sa5PTJtrtNhjRYvKkr0wTehwABabj9QwayB8Hk5JZA/V78oQMu1kBEBgrViN4lgn72E37u6WcitZpCn0EA0fyjL1VDJ2x86xCWpAzs4+0wnIUtWGA5fvZ+FkTqVgVwRP5QGGSGwfv2f9kURdVAz76XPmOBDPB0fg8DKoFP6KsrXgHiHeT/cfSV5/NvGiLwW8jfMWNUv1INHZgAErat+kE/TXqX1mJ+CYJSAH43BKjrqyjKPq1/G+z/WgGgfpP4UbpgBN+ffv4evoCqKJrq+o61AAAWFfAtvyccGVBfwJsAgCpO9yj+kTyf0fUT2mBuBdnyhWpo58ELob7QFU68Hv57CKAsfK4jBLJO7HwdE39lwL1j76B/JbpcxsgHRLB4WFOsz4HmGhQj8ncHQZTRt2z3ukKkRR6nncz/jRrQgBuX/68VZD90hfsoBIgVYGx22y2WYvtp9BvtCfHOFdDDJWTePpO/U1MU73HE0wHfnF7KHzh4lx3Mw304/+2IKIpUBZIS16aPAEAF6799SZ+GWPXOSIixg6lmxtnX6jEDAHwcgCSst0Pgx22Q+MjpEAYQvbMcx/LOxo//sP9y6cxLsD4D15JpP2P0UwSgHfIGCSCyNAP6iSmSIMAFqlK7Mn3LPbg8Oh/v56+a2ru3o2zjjv9KPaZ1hSIExMl/lPrOZ5w0h/jYSBYdOOwo9E6CUEDTBjTp/g+jlQv23+VNKjhcr0/lDw7R3U7asqzeUBdAD+OA/igA4Ax+gwqCKF/Z9JIlJnfc+hujrzHRN8dCyQ6OHKR90dz4Rj0me1LdmSCfrMbaaf1HePstABjC8DtTYGqGnxhzeH4CoUN9pZry6gxUkb4af1sXgA1ebmgLbXZbROPeYAVDsDX0vVPCDMA4A7utvmWP/jd44mCAKP75/MmGW8E7jQcpAsq7AQDuCE15uqROoc+Wg5FgS26iU/aDPWm2W9O+M+TH7HaSf4q2caDqD5fAWHorAMAD3ev+13233+32e/PC6l7UbYj9V/Wrx+LhArhw/7u08/8aBiVlZy0HBK1el8Mov9J3x9N2wIC/wTNpVrdB6NsI8r9JSKavFQekbdYmP6KOwNVpMWG4wSAMnykHMx7C4bfdBrvoQwAgDD9C/yhQjeqaUBDFzzAB16PpQPbBO7UQPVUoZrrX9vt4MY1/pmey1Jooty59pvnbNnfH72a/wf9SAdAjsGFh0LoMdHRAJJMNP+8ZaKUqTmuT56oOyI/S1/njAaxKPuEjTQczd0uOLBD4Xj5TDpk4ITwP6JMmgMDNAm+sxcU0Ab5DZvoHqA8gKKe+rWj/3lyI5ACKAICf+/0+PYE1LxYFcisHZZAFZIkPMfKz2W+UvEm+KeRbZCSLrJsYIWVzNfqcuNkdBkDKQESgAhryyvM3/DFty2jp6tvK6z1l6gh9Vy7UtQvVSFVRQQSqqq1P+hGyoD9XFI79D3/LNQEA+Vg9zEW9XQqBdBB/rBqTSa8AXnsSiI2J1Ke1T52EIFCvwP5XPZ8bMABAsv+sMwZ2wqpwzHIbs/XM9DVTZL8fOCGUgbrq4CRajwPWGhCAQMNMfwUdY0YZ0F9kUlXrIgAUIOAPybrngWs+9ALqj628KSHbYsGa8Vn0IQ29tlooZGng7fqURx3CHvPFzlT367vjn4Lh9Sheg1lo5OtjDSmcg0J646CxJLw3laEg9iwSM2DC/nsWEZCiwm5dU/7wdF0AAp0R+iYAxuxaHLAHYXUfgRzMebgAdVOuqQNR63zIQBijrz9QmPQWP6j2YSgqr0aiEYpaQM2BRF30Bw5C6wdRqQA0cELwlpi3F0II4U0Pfk1LVwBwlegDdQmwe7T2s7TSk7Qe9y3T1/hC1dzL3+j+NxVA4/Xryd+ulbJ/AIBn8reTU1WviADYYSKXlwAwkECRpmOnojWo080NC+jlnAdvMllbBTNGbL9Bvbl7DDwarTz8vQlpUQarorycThU7sqBHnPVkeWM5dtmUetw3XINhOXpZAQUvb5+9qyBVcamhe53auqgGGLQyTT5fkygrf30NADupvU3eWhzkEk7AwMDo/ncjhJ2y1uGAm31I/18AYGfqyirzV/IBf+L0Xz0Admpc2QtiW48W5/3662xdMN8nAyi4qrQsetAQgsWgBgCnN0UjRC0OaDmUfmQDc5+zGAmNabRa5X0mEBTBBv1fKubEDYbWghZSrWz9WepPdLW+TkXz/W/n1ToCkIjU3wBgK7XsmK29QnLkU/qvAGA9G8S+qJVJAGAp0ytuBYg/W648LwaBnaQn4fvOYEp5UTQIv6VqiLdkwK/e4wIVd7nBw5vfZcNs318Nmxj/FfSMmP4A+gjEdDBL1k7EtaN8H546g76Pz364/9irc00BgJ35ioG7Yxl26W6l5EjNvh/QfwEAOuCyxM92JfIwqrL76b8CAPNYrAkAuve0B+rYnJUehKB4mx/QzF9E4UZgCLr4+4RQzOXYowz/gXaoxXxLGqxxYHEHBJlHQBgQYF6BNZ+7fXWy/0f2n2YlhU/pGKKGtJr8ZdMAIHPEWMyAfc3mkf64DW4LYHKyeAE0+Zg+rgkAQN/cKvQjHx703r0amVyqonhbXzLryNIN74VOyQc21yZdWy/olwqQe0j+ectwF8yjAmIjtMteHwCy/DUAhBcugJBABA+WM4C50td8z8Bg8YcvJM+RnZKtwAAFb5vQDwz8CwDwD5YDAFMvINAP038BAGAA+alrqCC+DGZhj805/YwF0cyPW39Yy5cXFeksSH0HAIjUnXbBfrH5EAthEtibfBCM9Y0WxEcO1rYBKESS5VH+Rh97eOFewDqv12kVaU3vEgQa4SDRQFwFybKM95cvps/KVzQ/vyc2LoBGHwC4DgDsdtkQf/4EAGjWzpVbOv+wDNr4PY29ju+At7Uop6//iQwOlQCNC6xLvEA3iGJQDfcwd1bDVrRQViWuHMDAqeB/fDV9bYqz4uyZ5ExhGtt2j0vgAEABhAQuZiCnPKUA8MhI8toEsCb9FTCIOQgpAkYGxnUg/L+FCoKDajl5rTmJ6/+XOKyqQAwfrhaJ1RqrkG9MUlEYvCiE5WDvasmCs50VYa+3IFhlntCatOWVAZTSNjthRdrOQdVQtMcFMHyaC7vEr/jgVZR8Az5TAIYCIFf/s8UiyJxeMnAn+KnQ34viVi5Gf3lyKsVPF2Co+r8wASCAK+Gf4s/j9J/ZYLt16TsbaEXcxmKQkAoKYkkyOECB5WDvSEOyCMOYAAylEClB6+og0v2pG8Qbq7G9H+VoO76hFsLe1SuFoCHHEKX6IQ/vyQGsb+RSdBkVhyxjlHQZEwCS3CRgjIEYGgsMdMXVIWAZBpk1MXIEv1RBWv7VCu1iDYLD9P8FAAYAtBoCeOHfs2rEYT2iXN7hBtSecNqMM8w2vArJ0Jz9SZvHrEhcaH0n1egpbdWF9laKVUFO1yPtDKAhViX5RnPf71gY7H2qYMsbUwblv87yDqVoYxvtYSfquxwKY9Fmdda2LY7hJWyoIHcWB/t3AMBLaqxdbhg0OxsAvjzTZAZ5AC8E0B5CdTHKy/UPrGCWS8tZPln2BwDonO+VTgImALEYZDsOALEsmjKwvieMLrCIQWwD4e3AEsUEDOTMFV4XAIqqlDzQiWUg3o7B2dpIAUV9PdLOgKk/sSDfOHEWrBzOy2GXKyHS1nWG/2cQZt3/49tv5GiWK/6mKou6rk8LUpNc/866gtcAjx6AD1YJEOBEBqqibdu5TYKj/ZNdusI6MPwBAAyAHHyWiAKm37ZtW3eCO1DG3Q4jrEjbXY1+vogBZ6MMxQhW9xgKskz4la5uSITrkbq0kOo9D5CstCLa5C7oIFEK4QhcNRAhAqlWKycUo4Zi0FAMy3YMUr2jEksvpNbpjyDwsCPEaY22kCJtnucn9qIsCmaijludm3vrlFmoVRjz8TCIP6RZvdpjDFheBn+odQoRhPhzzD0KnLiSLx508NdGUA8NZKEWYADUZl3RMa7/zO/3wApVMNCvgeBLNwOLfe6NwHvYTXYBEvZOKxcjKAv5XUH4mBHCQ3Dd+nwRHKmDavRn3SAgfgDL1Wg7B+jyYCqP1+M+zl5VgEzQvXoFmqWLsIpfUDmGzz/1ivviAAdN/OYjMTpPYf/XqoK0JuOPABCgyAcZIPfl/EsC6PvP8wvKrhIA4H+x0CNgFMlv0cW3qroTowHLFBDFH5tgJORUN5YaEN8ydZkaUHdSZ+C8FXBGMljV8ncAYO0YozeL6A6ZEJjWnLn3hXFLwI79YUk6L5BZjbao9wE5WWk3CHSkiPp3aE7MeomVaAcOcKgP+lEEDYAseFM660ixym3xKIIPp7hNPSDQNohbFMD4EXlgt4hlCnCd153CEKp7nABV0ADBpnwOdCIqIeR+Af10/gXzau5RxuU+QGDkKCDg7KAs8K/OWlXBQD7OOM47fQIJdfZlIgQVi4vkZYsmR80LJ+zwHEhKR9YMR8OsiEbIyBggE7wA67lAc5RjD31Q4SBIHZDugOHdeavQdg7YASE8AY/DRhPMaBsr7UodIVgAgoF21EG8Q/uvO0lIjDKVgHqxKwjzNjmiCjLOQJDJIQJs2aVuYQDCEUBz+x8AwNbfIch/qUJAAVyAxMBxp0/ygwcwWAFTjSJ100BwY+NS+eee9q4b0eB4BQCZmLCuGI6+sCXTmMSPAoA05UpGiKC3xTUcAGPE7wBAqhVTMCwWjBSg0WmProbg4FnjmgBaXgVJDzwu3GXJ9gsSmGoFq3ifkF3ZGPg/QaBUJvF6v0fDsjUubVQEaKrKPGADx1Oi8sc+faFFmeaGL1KAIgCRfFzlx0ega7AdLH4J7CyX+uJckOP2u3f5jADADvXY+mIR8cBDtmul+BcjZPDxVuu316pGk9fVsPcAsO5NAZzIJWRA3MW8xgGACLzGTS3a9wBarrXfiz05k92X6P7JGbhSNb4Iup1FAYjn3AMCYB0g/vu9qSWrIFBhF4KlQgaciRwE1cN+Kv5oEdUS6jVKXGH+pAZAAIAHBPAlssUv1rgmjLsuw/XfdzvtiQ/AD+AVjQDriAAX4EAAXgEA6rfXycWWh2rMfxE+wB9ZXU374VkWddBxELibPgF7mQ7g3d1s81v/z9HzJ55OqREQlr+eUx8a+ytZ84U7AAADe7QF3e/9Vzj4W36y3/NAwr31/lWTObC/0ZbP1gwQZ3wcEfhiq2D7jT6MbHG3eF0FRgAMgJFvYmrO0A98T11bdfmXzKavusywHHpcCAZOABRjUW5XKkn3CuvnRsjQOyGiXovFALjhAoSGcK8BwKRP2+esU4hhT6C1Fjd/U4B2UjJsvsgB19c9/l6fPLcWm/Du/Ijl9uPLDVpzujKgv91v4wEgcusnu2Slr4/H2w0yqGn4QfKsGSm3uX3kTO23m13rQqBhWzRRu92Ox76fxoCI9KIZTLV5Xw3hEgSwZVHlI/11eDhBAqfNfsiJne5OczsKQcyMGcCPP37p68N8T2Ra2zQIgz4KQZTLLRKo2JRhBR1cC5vrpCfcGA93UaFcuyItRQBRDWhiOwo9sVZSfxyBHlpybV8BwGVhRwg5HG7HG/aNDLf9LrzabuJr/EIPJt+ddl8DetPI8XY8ns+TWKnJwPnAK2hoe/sXB6lPEWDvsERbhWKCfk2QC+nleDzcDodJOoD0h/54OxK3TP7NCEpVgH2YruISNAGnro4B1OMCSoilkx5A0IA8+SXMOuUggYPdPpm7aiTaOh+Tx1SmMRD4YC1W6MfwzPpMlHI9eNdKRR7pSTVqhMR3QQpNF1hEfaMaUFKNnqDMHW3njP1SV1IBdNbMp78DgCfzj9bnEgVI5Hw4Hg6H241SlGdR6JLNv7tDAIUFBwAewSLH+nA4HM6HSSIgfd/jzw7H/kwI2kr83nT3h+2/GQIAQkVbATNyw0QOh/42gQGR/sAFkLNBoDipCDpKMEGAAAgajM2hqeBJHM7H420aAEp96Cm1Rj5PASBddahi/srnzvuRTP+x9T8c5obFLRsrhOBGAOB+TzITc6160NCR6UEHGXXERxFQG2QpAOysuPO+H8P2JfaowrRGNwY9x0OHF07/JQBGAFAtZB7V8+Gs2+Yg+/1etvmozKM0/x4BAgC0GwOAm37R8TBBCRejfjiebxD9VsAHRj4QQCxHigBYnyAE2y2ZP1dG/+8iKLWK/+HQH0Vg48ALNwC6IezpS6yIrgtVcsEbkTO+6Xw4TAJAOfNvAECYm2SBfLbZmJUTHkNYDHsqmg0LfWUvctQneT4c6iX5kGYJjkpc0qOBFQvaG+O0UjUEQpzaffxfAWAQiFAbZCkAiFpAL/vR3FkfAACSXqsfhn5h9qojzr0VskUFOVtZzKOqu58AsNvvZefit93h/UAAE0AYAIDKf6v7n+M2AQD0/MfGlQEHDHgPtr+/VQCIhyDAB38Z5nL+OwC51gAAoiRtxb/5EQGSV6oPbFtzhxB/IMqc/QQAqqU5m9weOXGJpke22bk2dMfCLnELoI0o/zA+ynP/5+WPC2HyX3cnHqdx6208K9N9P44Atg0RPNFirIUV4TABWJP1si3z8FAMRgh7MiwUQFENaCjjT7SPCAAZIGsR5XsECrj32gKKAIAVm6v2nf0IxgGI8ze4l2Sg9nPDxY248VOIIigbyf45hR0o9d+PIOmdAajg+43kxoHgMB4ysN/qiQi+lPyuVUfhFgKw9W8yl9408kckE0Gl3mw2wQ5KPJIpHFisFPKvssf/9q5LHSdoIP43+CN8GTVRo5LtskwpPALAZpOZSBpkBvw5nKc7AVT827Y9eSDUpX8Q+x1GhcxBxVTEQnOZl+VjUZuFBPylIDXKp7dxWKEcMyMA2De/sgAiACjpRZTvpz8dABZUoQQBONgxagewAOrv5S89Gv23aoNLe5IESiZNW3HjKHAjbva5cSCyxx2hTzgwe9gNFbhO6IRUJJlE3gwX/BWwB+SDGbKHdhGIh/XYWFBgZ1EKtQD8m6ZpIGHViMD7LTxaQQmCQ2Tofon/zUwesxz/PJeTI8AcN6SXQiMTIgZivfx2UIszTEMCArCIrLpoNeOieJRYW4dnUp/WiDj5XSY94WdZSYCo+GeeBzVmf9+/Rge7tRpi0QbTevB7y+elErINHSHmklX5O/co64x7XzatDE+fgQjEo1F3g4aij1MNAA8DqBcQX7GXVtQPgQ7lw/ADxCOEyIxL43Encq33clIn2LQFCBoAnsF+n2+hT4WJbv018q/vZg8LQNlSAApQNoG620BHhEHgXIAibLY/UryMiUcAMOVnTwWAy+8TmVOK2GZtq6VQLzOxBoHQNlwSYKNrYcBPJP9ghNR2DzmGV8Tplo99AfjGEUCKjrVk7WziEoi3jxfTjcq/5yBYLfjyGyIDCttdO09cIA99IrbSLWsIUZvv+IZA0n6bqUW530uWb+8RIDoGo6cqZKvADzX5ANap8+iUglfA0AZUDnJs/yEPbqGYp2CbqMj5dg8j4Dw9D+FoigMrCiSXtm3FrYBdm/mCRC/AzmMAdP/zl/IP8ItfNDUPIcIG1l7g1neSuRN3vSgBgD19lngHpRliU1KRmGwA4ORpWytoqkdSkemBHeghA2/AFkX5NmaXx1pFZF1nWo5p3218eHVskgmaqiCoiGRHmpl94cSEjxj4FAC2j29ZjJ2vY/2Y+Hfd634UIwBgHMyFALVdjxaOhjJhAIAXdxDgVnlQAFC2HTVjAMBkAcTsIf9N0+kiUO4DAND/KOFMNDkIIrLl1eGBv6Lq55E/SF1VbEmWQJDiYDhhPQQJrHP8y2whVHvpqMpPJF8rAmAHZXtok9sEAOxp5Bmhz5KvnGZu2ZCoIcfzmmx/+QKUg0qskPec2IAItSQZWvggC5sxVFNelhZEoyU3C1K9FNZ1kIgDEQDMDwkVgG6IGk0RZhgCklhA3ozzuQKwGagApKwCON8VGKefFw/tGJ5bIZYJjiVb1JACtmOPKmTvbOPby9XP7SMAhD2Ypq5BAI4zOTj2qMPkOgYIMg6YobvlmSz6q2y73/oRPcjYk35aFpCRP1aHGv1t2ZOP6ximrDgoKFOqgzGw3zsgpQlC0EvmROFVccADUEMqhmKgAfD7HZeDe8SJO3XCEzSpeesvPcqJUNGUlH9Hk8enF8KQ3BYereJ9JrhNYH5BFH1pbXbygmiT/7QONXE+BOWEHGw22wyXmcEPcZoNAG19AQhqNwpreXF3L7WZH4MceDmhDLuq4DtdUA1q7WBw10royfcIAFsvRw5QpEGQwtvyoS3nLPLVrS1Lb4oXbICc4m6KAQ3z3Ezwbdj3SF7LkAtoAFAlG/DvzIgce5R1h8ZWxoAevkXTXOHj3+N41N0OZ13clykAzBEAqQ/HS1kKhT8iIAa4wff6NTQu/zytdS1SKZHyMId+DwWoarEPcTVACMUCEcIjwHt+nEWXwNBDiHnM1AJ5EwdTkQnnqvjfe2Duw5ChblM7mi9qyIA+++ZICEYIv90oW2vi8AFZoxuE3ggvppwHQhLbWpkPMHTksVexJC4iAKQvaYi1zPuZ192wH4UpPXe192l0JtaDh55YMxOS5CxN0xIAgvQF8eMtjTXlj0fP/+2YLOQJQ0AAPH/uTDklFiiU5wkcoLlKVteu/wcFwO6A6uigzOhvQxcogIEbxKhHIHmp6sQCnpCMYPjjABDPf2aZsUeF3cQEDV1gLlS+UKkCIreJHlCjfzhcDf8S9OGlH2rXNCz3U1J8RoiX3KPfXsrbLAWALDzkgiPE8RCF0Rl7AEhCj/AdUhFnkjbyoa1KG4MQA/DZJrNVFlqzVuAIrKHBzG3KIKEnlikAQcsIdZeJ+2HYDILNGBa2R08QyBpSJR0xEp9MUAuiZsSWMGRhvgYmR9xKj2iCB+ERWLP8El7/orexUwZVBvZtTBnMNrl5oqsiegCxnf6MAGhIAgCg/q/HrEORXhLFti9s/6a3tiNnYUutxKzgDPsR1zkHC2DCiSQ3eCBM/FUGW1y5xcRMVIiiWTzs5II3YfCOeGgMzN2zA4oLgPtkZz2AW1SAgntVMkr5Jt4Up4Od6wszQlL1R8p+sgc28iCW1ZSe9hu4OCDbAx/kJstU/XEAYDh2aS2O8C7sWtB60pst3MNPkokB56d2hVALgSfV7EigSF1W4UIAb7uXmB3PAGDH5vyznR+RftcoBg04MACI9eHp59EO0auC5zdGEtO/0RjPlXkXP1N+qwadGv3i+AvV8fhcTD8vmyIegCzs+bsIsrMTPYDsrUewySiHCgBFwWvh/Si+4vfxcNA3bMsRv/Hv2ZHEn4v7QFzvRioOpK07SW8yeEUb5kKvh24QM4kKQCa4piJ1QU4AIBCgC0Rnrw/A1Gq7qwYedjxkW4FSdP5UiXlqQ4Lmt2W3PrSxFEmFTfL9DpcAAnpNAwAo1jX3SYgT0WReHgfDHqaAcWK7BwRIS8I2rEELxdnI4VzYllk6kE8lPHofhg7ItCXbTk7dCn3BqAKxsV40QUZ6cgUgGrbj6Hk7woLJRwBwPxTTa3EKcr/BNdGUDe8s5GHEjaDHALYMhGULT0w4gLVAbwICdFWBa644FFz4SP30LYpL05RNpxejN1ccjhJKAwlHOTo6xwWdUiGFVvQXyXN6AbEGlg8Uhk38Si9NAADMOyrJ7OaWukAm0OcTzPJM1TB4GJjhnOGqSgOAoqhxX26gviMCWESQPN71qJ2Wj8UD34uoZqQ8AAAgAElEQVS8HQAQAml5/Q7MQHpjpS6BxCVRyjKhmDOyUAWwljSJERIqLqIKEOOwGOyf7gCgOcFL6IsZQaHb00D6vEuD5iFobXgsx1k2cyePfjh6EYCTciFPEMmr0RMEUOxbEoXkZQh6xY2dQHygcAypdlEBAEp0rTVtlOKH0JA+FNm0OduZhtnoSv29U4lUBS/ao/yZnSstrqlvuOGaCySvU3Zwc6rI/yUlehBZ/ONA3xI1/kicK6AhgACCmueZIy5IGWTXzaoynchcggMVvLoO5P/v5SkqvYZ+KAfRh8tjIZgcFXJuO1yHp49gk9KnCj24p2/SllB9z9OKg7DByjHyTdWcgHD2ABo6YndKf9NuZbNZ3plOd00aa8DtOCMA4NkXFrLQwmgKwgLqucm/R7XM1WkMbGiX6Cuzk+yiIAD10pnb9O1ORsxTZV1RWYXeZ+0hUV8TZaFdRrnA8csTyHT/zUYuJYxu1cCrCr7GkxkbcIZB61cgDGfQKWig3MEKj3/nATaG6yC4d9rOQgpcA3C5dnK1/SeFegrMEwF1IEMeT/iyjOT/bgTgSqSBDuQ5CeoVgPTXIl2NM1BRCPai20G6I9DLIX6jOoknK0CsR9N9tpMLlB66Ycum6piqEOCHXoAkQssbLdKv3E44k5UkylFSWUMWJI0zqmAwwhqAEFmAGchEcAIHHvjyc5BqY+qE2OTM8vY9qausKqpO2sVgE6qiF1AXP+tTNQOprunbJAgO1OFfrFcMYAg05CDJQY0IENtxWEOIRS2pkM6t+y/Iv1ugNbVPWDmwklT+Cqmpft+ZaGEd/HLZaX0KosJ9PNRl1eGqLDgFcVdqUcvpKnKp9VrmEub+TsTKdjQmlKhBqCKYRp4IYAvQwdhAUADyGC/dOTUFJt4VKH+BvxHBCK+dMrs9mcxE+v4EgsMNPbrV+Vo3TYF2gexBDeJ6J6RWTEUEGHrAaNT/nbxa9wEAElELDpACPGLqag2BAU+DAiPLm2Jw26S1F0iJVAUQi4JQdItbsXkflpG1BUD4VJ/DfOqZYbknm4ZwiL6KQrhN2jGYcr5OLYC6YaMdFjpDpN0ovBrf35iNsqwlAY5fCpClnFIFx77PaoEoYtdBMmp4KuASqk7yIP/71hAgi/I/o0qxRl4M8oIayWpKBLIsapSpIPMSJx18UjRC97L/v/9LGVElMN6sPCUXoW61vFtDDVVRXz01AvnpBZy0QAUBJz3MgfJk3kd1iSZZGPSiTNKAoIR1Rp7brd1s0PBV8qzmrGuD4YKKQNOhF2aSoqXpyOn3qQ/mz+T5DUD99AsB+bV6fmCLFFAEcQuEupy3TERU6QCnf13qV0wkALDbwiRx94vgEjS9lJvqF/PCvFckMtIVARaUIuwNdh76wXj3p8CYAoBe38J02Q3KYRfPPnTCcboJ5AwRIAGAzdZAe3kxpA2NwNEblWctYaHjrRMZT8m6QMJ308g+dqtQJ7QPGgDTJTBwgsqAIyyOS+g1AxXcAADKgAqpn0AWk9IuhjgC0sudJ9Xl6DffbjVnzEtakWCetbVp3jUSA4EEygLUYAtaAgN28auyOQgUnoAeqZg4HgHSzOuygpcCHCr+4Kng2DXo5Z8MvmyqBmTi40UHsOv3vKazhdCxYTGIXmokv2FlTilWaMrU4j2Ih5kkWcrWU7CKomqrsrlUWAaMXp2Qfk7vcssOnw8AexWjrZuVaQ4EQSECgNaCWrKQyu0a9o9+e+wIkwj9EAGYiem/2Xrp2ipaCI5v6WB4ZuoTh/xVTVFh79MldZG25j6UfRvq5iH+7o9VS2YBAKCm5abXVGuZZ04roKRvsME1WAhDYaeSfpvHhEXdg+m1EtPzcgE/N2j8KvJZndd1OIboD+D1AXWGVhB7zVsKBpOSSxBoTl4aFxRTogkEEIYW3pQgytQzYGCOp+AKCDf/IAIZ0vT/SNQSEKmD4GCnm7dGXIGJ/idW/Usulwp6SFGUaEZ517CIesDk6aYzDwXpKmLgwQGgQDACN9EqAFxofbkvTDuyLZECMbsr3+1CHVg6NRJL5dLcjxsv3FgeBzRJ2nm324HePyjH2sWOnDAPQkeIhSw4I5qUwBox5EjrI9DNhyfRcGPafgnyn+RJZHb6zBMALylkzIs3Xrae/IOSKxzLJaqGIH5Zu0HdXoanb/YTpTClP4c6Snp6hL/L6prj0OeN9fB9QBpVJZa2BQuWHAyqW1WXgEARAGe4xilXyEHSqESWGRaVDeoU8RCq5iQ18YfJEnoWpis9HYBkAysmY0G+2xZwanLGQQMBFOoFklTLQhw27tNFqjALqniE8MuYFx1Dz3BDmgUAvYTJ2H45BPfgDnrI4OumkN6b+AX/+uYBASIwbDa5CaS4CrBg3ikDbXTE3kFQ2pEqFsBswcq6AIDO3ixx0N3g628nUQO9mLEyBwDUAeu1hV60ENs2THfKaH38kbYfZB77j7sfIteaLKjDPuig7r/lQDRnNv5Ydf7xiLJa7HrcVB0kUGr4JTUs0UlrMsgda+kig6aWMwFAlcEo/xqE5KlHAGAmoDBrOqgASFuETNgXRB3s73EIejEs8qEbqrKGN5lmH/EJIChTwQOKrVHknhsY9ubADzr94QcXKEu+eO2NOiCu7pO2RBDpKyQpDWvFhwG5aSaJuDhnoRPjIBU59sfRn9YNaqnmkXBrcwjF4PcQlPbIjfKvxOmGWsiB8dHDBVdzl1UX2P0e+INCwIhUc4JljIxZUR/cThCzSkYsZJrpAiiKo3TI/qsBAMoBj183xokAtbcOSQSOWsB8BcS76hyLrkaDAHq8YG5g3oxLMCxhLAjKr3ZwTztpjckmSzHrsTD6ZpWJUPotEk/8gRnkCAANxDQAywVRBYRZmFPpu98XyMovZYM6MlDrjJEr6QdCCxsoAlBoWBBPwhl96qy7n0MJHJ+YLSKw6oXG7fVygSMamoELSqxNuHeDTs6EyHAveTQCBpfDDKsvvBOFV6xOm+kYAzrrLHXEDvviJgDgMydT2Uoc6DJ4d54Lwi9Yebd+ufdNGVdB8IK46PK6R4A5CvDtAIyvemghPHNs+9U5utbY/vO6AdW+nlCf4wLA7OloQtz9VjMIXmi7DavW8UXo86zW0uVE3ggDAx/EzPIMi4F6qwlm47Fa0OkXMAJMWmj5WOnYnQYyITqkxz1w1dxaxkF0xONt3YYTIUNgLhQJ+FE4Kwxpf8OHChUOe0pNEKaHIP8RIRDen15L7b8IWrnZLIMVVIfU34mLbWZ17eu6JhDgvkETytCMaiN3yGPfNt32NdyzXPTnCBDSAuCHMORbSf5Dk97jTdVeZL/UzEYxmXdbGNYiTUX6Xx7aJ4Se0dM5uFnqEUM+TY1sWIcg2ABt0EbDafFAfkYU0KkfD8QfnSZuTGIaBCHAigVaU4rAELdr6CM7ikAzAQD6Fvx8DHpoKAZqN9bAVQAkbpmy7iYIE0VFK9qm0ve2GKHmOmggthzWryE6RKGOWPGm5hElB5EC0rTpu8VhHiZEHXK8vlgEFijcaDSEuw/eypCIkN2bH0TlKSeQ2LwJqHbA0rfDc04b5tMzYxTzpAzkXgLntOmNCBAb0uzY9n0AANtQgaGsGgo9MDBz43lfy9sNe78outaqJOwwMmXUGneYteQ3M9yLwLz2TJZ8zPATVV1VxckBfWDMRGjhhNOVGirdi/BHjkcrf1QQ6j3xRo1uspBDLcCBZIlKj/i3xARSNnLYWzVVf+z4Bnk3dIhk7oQoC3axhAACgWKrvA0uSloEAEP55/buWI6p+HMxCKYryIJXqQUSc9omqoCBA+t+oqnYBjgdpmvOGLogDCZCXbrmj2sygjmlJz4AiW4tiwlgC0IBC+gmXacpkNz22bMIyLzrSj0QY49VVZsYGbbWs9FPMgjDDtWQ2X3CQ49g7ZHX4TRmoxqNR0H8UBRkymisnA+XOUQZQCOvWSyEZFfq/lVLCBA+cx5AjMJr2U48rsYkcI4Bcj5YvSF0H4Qe0eqPH5yMgzYXeqQYomQPhdDIfkQFmd2huj3pQnjguyyLNmf//VwudMPXXj3tSUc+rEiFjExRgQcA4C6ItmUclNfmwgcJidQogG5UV0HUArE7zqwUbOICWGNedzAL0lAShSNRPypFANQkxq5o0m636gjlLdeb6QuwD7mV7lo12jbM/xgE7y4MmmSiz0N/7foyaAsBdRNgS4cbug9A/q5jAJBqQPPvS3YTALZW2PpX0XAcHgfcMrr5wwGsiHknBEhPmLn7vfqgQy8ClB+1bPSkWQk5s3Vae8NTQGNA7Qj+zAAAox60zB5peJYLp4FR0KQ3LgDAw+QDAMxuTwHPg3KCi8Npc9D9TcObi2EGO9yQDybIHBsINb6xGjqUJjPWUGMDaO9Q1QgC+PFfb5IoDB87Y7KTV8AgDRRbP//dCU2nD1xAoTVLjQSRXCui2Ew9ZuVmEX+mIJDQDaoKrUmUGz/tBd12HImDl+4JAOR+uddkHygDsTkMq+AJDTQv1/CmtFqIDfZ+mg3uyZjzb0vV/nSqBRcICNry5/rs8/px85v+MVSFt9v5LZorkHbM1fPPNyd3JWNx3ocR7gkNggzEYLtM/3C4IcCgYz94QgoEtiijo/yfpUl10LeGAsgizbnFabrLiwLFBqqCUAMCIDRatYmD2J4BPWXPbJAp4qd5jpp8TQ1PcUhTIsuTpYWp5qf2oBVLqt/MlA+FgGiRTOKgUgiAAhA67lslpLsHmJ1hbqjgsPAqmpCKlmai/Z2+2K003u7E6qCqomAeSOtJSOqT2Zr7PY2B2hfNxn+iXmyKBTo6/aLB0+/QkUbdsdqZCgjE82+IQM7ALBUAXrBgAp+1/wyLcfi41Q0VhONkbfKivYICYV4gN7s+gl8aS3AC5lnfVMMf809rJySbveEuZW9egRYI4pxVBZidCQwBpL4wNIBNwuazZCSnmQKV7EEBmg1B5gXRdOPz8YyhdyZoZ4SrnsQUP40J8l7lEQTYTsnCwBfB60Z1Hw4PEzXf9fQH51QF+RxQH6FQPCQOBJiVCUo9CxqHFkT4ExZN/jEA0IBsWZ0QhtRsMKYMJz6Q3WaYifb3FaikVtmzglAvxK4UAE5eByW97LL9Nt6PjQL2GIlPgmKTVQDtCaFCpakdfObWg8K6YWCD5riCIVU+EgAID2SWClAH+fdzGAH5qqxKlOtjA+D+F80FpJs+ZYNqgF3pMLdLssaj7XEXjgBFobfQ6r6HLoKsNDAWbDI6onZL8IcJtlcIuVdGYodVqH9AGnxcFf66hvDzweA4SPHHNJC5CwC/Pxoe3M64seB4PJ6Px/OV/dB4JF8FxzH8AeyEV1bIgHkAAIDgFKqtJnnxHMzytrLKz0rYionOiKYsW3DW0jd0otVAjBwSzxKfxBQbJKwuu9CaQUI8YjzAdT72gtCQiKZiWcQhQlDaO38C/Qp9mZlXDkPignxvwz6GH/vQGBKFEXsJpZBuj+tcB5UoE8OgLElPOlJ0hTs9KkRCuezala4HzETR0+trXP5n2D8JE30AAORbaiMwawNQFXXdXtC35FKiUSWUwy5mhLOYLDyFmQBg3iW3QREEdkWUO0594ZARxYUmrYlL8GdGYajdSuLyTwDIpe21/qgPaExJqSxawNoo00OTW90W9KZQCeBtq0dPS8TdySzGQUcyFT5WK2hpBMLxjzbINASSGh52TfPN1eRBmzSzPxqjm+oEWIlCA3VPXCBTi7H060G0hX2f88Y3Qr2bZFQKGI5hTkKN2OAg7+KB/iQAagCATPKRsmqY/IG9R1NM5MpSWACAliPHsr0kBDJMRJ8IALDwdHZ4/qCmzSC0H4emQHlbShQNhLIJ3uHhCkACv5PIOxcxDlah+It7Qt2h7pGOmx/WSCJ98VHMBwAzLTUlDReliNSnkybfWF/eti2sM0haE4szN3ZNnQcAaMiBPZ20Bbq0XaxBLEoURnEYHGvxQRIPDirIrOnrEtRZfvLLVnF78JGXF1u5onUoHXZrZS5ACgATFRA5H2+o9dJ56sOnBwLqh9Vf+q7wFbCCSU77iQBOyUNSjxP6IkAR485X0Lmm8o9YdF2VTdehQE0DQS8QYIoP4sqThhooS9ABhOhFpwXp1+IkV6Ail4Jrngfx1zRQXaaEj4nPABCEOcEUwRvw0BkCnUROPRioUAop0pxkoznjQfg0CDqzFjZlg89XUa+9XqEF4MC5ogwtefRJeMRHpDy7R4Ka3yZ+9EL3F7JiqGT9aIwDxYMwsmXkFQAsGzaMvNX7b4ueRbihPKUrSlxmpFcqRqdN4GABADDnoGVIln3Q6tvhIJdTzaQMQwB7FizSDACMLnmqgOx20+rzRQugqHlo1OEkN3gfoH2cz+daW8LgF72wOKrv1ToHZDy6QKbvQMGlSuh6QBeELrIpHQ0OY7ofcsnrYJFosvoj/szLBBOWPDHri+FMPgI8Xej/gEAUqIt0LS7JYM/sTYY4gFK3UpB86JCdrgG4drfNLm6BQvxRA56xLwQrMSEZVo4dtU8NguJuyWUAoAhgd6Uj8wHFQWFoP4haisatNRx494+Avth5xL0voQEAdIBLD3+4KiGJIqrHP8/b+z2w2cypzkoAIJkx8w8BvZ1cpO9788onsMP/6PGfcLAgN9OibyEeU/W99AhHwisAj+SFHQK5V5JrzPQYsBu7piEgw7/H41nqf6AHUBfuIfz68fl861QZGw7cxIENiVrEEQGclIlb09jx527uNoP9quga9EPFf7wliL7o0DDlaRh2khf0DOp6PSohWAvRWBdXCiLg2rXbMhB4fX22GTggkAqxCAA00gOJb70ZBIUODelqbUynGor37tvkzIA0DYR695Ji+MDHySK9AJpLTxVY6rq/nYc7P0u8/nfyPzcIEDoB6qBL8NR1J7VGcfu0RoINlLZP6M+qjUiN/3SgBqmmN4ou+bPu0lqRwQFwCEFYgFnzd06gBbr8q6ZzugjUcYhjgsip/N9pIFNSAKwEhAveaN79+awmiLkheAR3ndTkQYMTtM6KqkR7qKEFMn3/0+ABHSQ+aLhLTxwFgBCZ4iuWq9M1X9EueoIAk27KksPheD4D3gGrGvK0tGtkXbIMnC5nhELp+tTUvPutNwCAv5MnCh97pN92J8i/xptZiqUQhLJ45kRrzWa4QyumPd6Xws0FAEvKDrJAH6j0uvtpErI/TxTA4RqoOjQbfAbiZ1GBU9cVuHXHm/bgo/aZ+PPSiJn2x+OwT5GEK/X5oG45bP7TiYXzzxBw9uJHToL8w+2jGQl+Ih9v1Exyc5nDDztUhf8OACJ1j1tNWQJGOxRuxVY9EEqR2ECPHI5JfkYMoPLDQExQhU3+MCZlgkABUAhCARa7jgi2HH7ABvQkHJzBugd6nAUV2iRrC/dBJpg3y57IwPGMq5X0kNdUV8dfgL29BvKr/DFgcLf50kv9pioAYMAUTHNz4jg0Xw+OIefG8jEsAyYtxV8jEV1XIJyDuhkBAHaP9fGoLpInxz/vb5vfJfFO+sJnJ2x/7n1K33P6yzo03Ut/8nFt138rBLxQQJZoQCknR5P/7lqhZ3gtLo2H4+0sQKRg+emmmWEDQdM/HF0BaOl/gBMOHojjGch/Y4X0Wa7Xa85nECMT4KFFioTnYjkEmFI0ZbZehar5AFB0zQMB2NctGHrTEhoUHGoPBA/rUUwt+/NSi12ufvbzX/OeQhYKtT2LA1M7Zkpmy07qTxFgohWszah0Z4VacE/FSyGIlXAoheF1tQ+1uHE7zu7OgkzTcBDjA4bB4u4PR+Mz+Z+PPakI3n0Ytj9QEheQjKTAceuvVhx9z5Zd5I1xSxbgLfLvCYHuaUWGTiQP+gkAPSzDXzUQ74BkXZiA9jWgpq3lYP7WpmiPx4N0Hc5aE3+6JvuectG2oTWLpoEoPxPsf1V3lAW9pQaWbg2sufV9D18koqAq+fqur2u8QGiWlVrwxyca0CT5F+lvxxs1kGNv8q+HbG6NYNgaMlbCmQqe8a5cawYxkECX/4lpyPp4oQKEVDfN/1QOkAhtJ4KrALW0D0bI0kT0B0M8sBi3X7z/R+4uUg9NeeaSfsFUpB8u4HpAgA1aE827JPnPaqqBoNEfl/9VOkRcYw6slkMpfYYkDqn4j8j/HxEoWdTjWSh/3H01+h7b8VcWdTiFCYFmkCMFBFlh7gK5M0H+fidD3R+VjzP1zR5KSC2347lj4lPVQdbhDu57qiA92lUhPkcloGGQ4C4XdcoSSN8fDtqHiqcv8irg/L7S1oDT2xsjAWsQlEQGAlQETcl/moY5Sf6PN2Lg8WBlb96R0y+iBADUXilrmbJ1hnKo8UzwZZkoCQDET+PuT64AHlDXW1qWtoZ81SrIESihH5bf7215D/k7ADAWRpSQteT/Hz5uj4Cr3Uvx0z2Ag+KJ+IOFPwbgpb+JLqz531TMoW1ojK/AoWPhTzuoAzKgSRNUUTZGQvhhuAh/tkH8wUL+zAlUt3K7+TWIVSHnI1SQrkNeQu+ukaI7a1o+VWHLA5uKgSJVguqe+2NZJsh5Qyqo1kXq7bS8IYIBmBO9D6MIMCkTDF6Y4+EWWXAPHz3PKIXX+mezAZihwH+Qo1uGl0INAWCJ/AMAHhSAwWERBdCUF7uwzHrTvOn87UfpKwYo+Q2u83yX+PsS8PyNLAwRgBrIWggoSHM0b2wG0EW3Ag+NV5CVJ8c/UfCPNFS2z6p6JgN0zLsANz/OG9gGYIEMQAA0IP3ECppugxwFd8tq3yFLdyjqumhwIQuicRqM4il4qdEsoailZd8y3NDC03+AQH+CIDkerA0c8hCsDsMvwPFLt1ULU6Yaq8hhGlSohh4K4CQPqNr+xgJzfIC45KBS1K2tGLqV00VBukakFjnqzEi6r0Vblok6bgEMBPDuFvrhznmX/OlWofS9pP8m8iR0PBR6EztU8Ejd3DDaJGo1+cfh5N1PccpBBTHpoynK2+xG5X+yD0Y31eAD3AtpcShBvhPKf+iHOLI5gtZF1sg6GJF/XYU/UYbbK8jfmQhg3T4qLwy4IucEsXDWqF8sVUb/AUsj7+2PSQAgjO8eGfCgBdA0xeUC8wvJhhZ6RBS6uJhKYhdkaqjSKwcTTwDFf4L+j6CKS5YlnJuWpVnXIK6V6MxHCrT1h4cCB/K/bAuOKgB6Y4+OwSWUYSHfLH3/yFGXpame0n8neR7JLn/YkkPSekGMOsJWo1fjfIuPopZDyNLsOo2R5qMGiKylfVjPoziQf8SwmErpszjsXy/psm4vCO1oIqIONgIIPWDq6mrZmLys0j7XG5PAXv7Agymjf56taMeDh3EpkW9oT11bQwGWatwidW2IRJqCEfLAyMokHzDCsHKzAC+Oe6uyaarSjJ2mOOGRn4pLoWmQliLZdBVUQbuXx3eC5oEuAoAkFSb9uIPqy1P43ZI2zlY4/aqv0De3nLMw4OE9KsjAFlN512sB6YByL0SEADWEVnHBSs2K+5AYFX9R8NoYc0IRAR5UkKlekAAu6fuCeq+mZnauC+vdaOyGyPao/JcjGMRmeZOWobZJMsOgPx+Pt5Pef9Ai7VWf+el0pfIRfKL5fRqWMTKNtoZekyzTCqXXOnpcxo7sJ8t/ZmJ0TMlkjnJSDOscLEtDeQYA2h+zKL4kgB4EUfX3KxygP2p5QdHICAvvCD3eAcA/gopddRDHq5j1slyVu7UaxMZ8U27z9BeFXmSupvGjEaKa0FImeAmZcZDnbMjKRhRw0kfikIQxHcQssZmkjwh2nq8F70PTcToh8UxlrqpaxiLtvXXopfCFJZiRiU6ZD2jY3+TW16oUnU7WGb4p5YILqhGTjwpLaEiyi9lQSxNRxwEAzk9LS1jw7fPZOkH6Llc6wL4z0LRGMfojGPTojcUVwdYMLI/llgOtdUXaDgDD+3ZqdCWy3zyU4qkbZI2r8tzVTQTiwavvWf6kb137f3RBaJHeXMoHjXWaEZRl3pXJe0CVKJPoZbtt0XjGR4qBi65KhkEAhOlwOU8CQZ4GVSI7K4Eg3pPKpUoWYFki6mMQEJ+yI/f3TmAWYYK19nsAoBHYvJaPWEEj4Ri5huP3rt56ReG/pz2kxL414Tc8g1LdX0/DVRgYOED0J4Nk9ql2ZB47/vU4nE25PxyPV22DbAnx/Q2EDQ7asjiX5zQPY8gCO+Uvm/rxXB7PhbZetsbMAYKYHNSeETUlaf9dwsNyBkIe8OBTL025fAkAAgZ/DQBC4+qPsDAoS3QO0mKJd9IeFmW9YiveDLumGzRUWA4ZsOrLoH/cJ2KEq0KWhMH647Fm+0UF21zqE++jZEAWjanrY/00DRM20MIVYNkH4jBsEUhfS3tNNl/RFDcELZ/lga11Wfj9hxXb09fldwQwtAr6jPSNsqC9Qiws/wFyjxIQFeO7g3l12k+B5vFXKojhOFqHAQh4sAFSh0dUTAx+7sV/cRxE5ChIfogI0NH1YO9PSMN6loW5igUEBLiUfdxv0H2cftZKWfVR/kcsoFVMsMdP7Aj+kvxJshxfYYDHIrfkh1gYB4AnmvnKpAdVmfdsjbCwvlYyykIKAAn8ZJoHFk7/5QIoV5V/fdy4CiIAABuz8xqC8QjoKnng0l0aYW8aAx3jR991BSIRT+V/WRTwVVDaW7Ou//V/YGDcKfVhFj5x+gZyIzIYNeC3mgD/AgCjXuLVeXgNAPdeUA2HrsWUDJ0gKVm1cWLQ797/sBZ9tUG0RyVqogMcKTvMBB00QHQW1ihFG+HIevGzGcIbvv9/TfrGWfjE6fsaAJ6r5m8i/TDVF9iwMg8PhNKPhufQ+iwJbx7Rkz+Ruxh+eWhFxuN/tVK0QDpRRIwBk8CHNDBFoDfV4qg2YmrRGwj8gYOPSt8oC59xwI3QG2XhMwAg/6MA8G4rTFJLJyE81Dyi8GsxypqJoMmRRxwIHISpDyGA+Y9vqsXj0o9GBz82XmzJ/19ZGCH2IRZekW3Qf8gAAAD0SURBVPkYDI6g0Ctgeif1dKTIg/dWArbqNd363ffN6UZOQA+D2DXBb6yF/fTpN8LBlxn4AgsjtD7Ewngy2D0Hn5PBj9P+54nwvXgea/P0FABGjB8WC751VX4A8BUMGonGfgYAXlD5hgw+/eQj1OVfHv17GPobAr0lBPOam3eS+RMHX2Lgf4KFzzztSGbq797NxedpY3xH/xzQ/AoHo+x8h3rk4Hv0/xfW4HOr8ILK5xZhhNDn1l/Sp/2VRz+g+b+w+X7jN37jN37jN37jN37jN37jN37jN37jN37jN37jN37jN37jN37jN37jN37jN37jf2f8P9zmJAmk+szkAAAAAElFTkSuQmCC"},"push-v2":{"file":"push-v2.png","frames":8,"renderScale":1,"drawn":true,"url":"data:image/png;base64,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"},"props":{"file":"props.png","frames":2,"derived":true,"url":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAACACAMAAADTa0c4AAAAP1BMVEVMaXH///97kcsQFjPs6fQsWcigpM7/+fDMy+Y2fupDWJQXJlAmN3QVHkhogMIhRp4nJT5jyv/u9/+24f+GSVPh3/8AAAAAAXRSTlMAQObYZgAAAAlwSFlzAAAD6AAAA+gBtXtSawAAAwpJREFUeJzt2dlu6zgMBmBbFGlae9t5/2cdUF6adDkXB1AwY/8f0DZNLxzRFEm50wQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHDIm+mmYuK1qzHG20WBUl3XdY+AvUpxuhEq8vEhIipnBFaut8kCCrrMy0YfY+BouoNU1Js9BN67Yye8yQ0iQFGE+4pVdY+B43V7a75+BKgyb4s1sqeB299cLh+B/LR+2/Y9C96Lvb+ussxy6VKY+cv6bSdYFniuqfLqlmXWfJf8PzgLgXJMzK7H4rIRyJUrix7cEQG2fSApci3WGFd+wUxEucYUdinWf1KmmCMRhXEXjcxn4bdbrboHgFkXlVa5qF90Xes0GrUizknnnL2y786VTGnYRTMfRf8zBt7Z8pm5iEqsrOotKuM+xCYVmXeLvr3545fZSxiWflTeH5d+vNAjBKopVac9LbiN+hT7R5mPSXTx6noR2s3vZdRVg7er9Rts9BwFVSwElVVyFVXhdXVDxwFKcq7/m1kHXTXpIlqeWoAckVfpEXCUnQWA1/VjZAQobLP4z2TQVZ2WH1qgWFHsqcFca+4RsP0gi20CoiFhoPTZir5zrxuBOiv8Wy1grnZ3+lAoi6YpePWFBgXA6n9f8PFTrQDbH6YhEnPN8YE9D9n13uhVpfbV5mQlcS6hn5ndqzNgTBGkGHMq1nt3Eno42B4KsU1C3m7GVvwpVnal+a1SjW0IL0KiIjo/6jkoKceYoi14uyn7ainndjSJK5wPqY8dX/tND8MmxJSKiHvIv7bXBq///wDQn9ruNoB5710KKXzWvKZ9UvB6gQxoXyfg34eQEM7lFivLXnXg4eRV2pHNj48Cf0sIOc4BbetMF0iAqUmfvM5ma1+/xmE+y0By6rVcogmEffFSnLPjzjl4fE8J/5DyOYTRx8IXaUXV2YOH/ktKqW0n8ad5pD8Zs44wXVFKz1uZcs6UKdhk9DyW3eSfIwciovPJlO0Od4k9/5daa+1e9x8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKb/qH8Bwc8sUXvK3CgAAAAASUVORK5CYII="},"typing":{"file":"typing.png","frames":12,"drawn":true,"renderScale":1.04,"url":"data:image/png;base64,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"}},"clips":{"idle":{"duration":5400,"loop":true,"poses":[{"at":0,"sheet":"idle","frame":0,"anchor":[54,102],"targetX":55,"contacts":[[37,102],[72,102]],"rear":[[82,90,46,38],[0,94,27,34]]},{"at":2900,"sheet":"blink","frame":0,"anchor":[54,102],"targetX":55,"contacts":[[37,102],[72,102]],"rear":[[82,90,46,38],[0,94,27,34]],"part":"head"},{"at":2970,"sheet":"blink","frame":1,"anchor":[54,102],"targetX":55,"contacts":[[37,102],[72,102]],"rear":[[82,90,46,38],[0,94,27,34]],"part":"head"},{"at":3060,"sheet":"blink","frame":0,"anchor":[54,102],"targetX":55,"contacts":[[37,102],[72,102]],"rear":[[82,90,46,38],[0,94,27,34]],"part":"head"},{"at":3130,"sheet":"idle","frame":0,"anchor":[54,102],"targetX":55,"contacts":[[37,102],[72,102]],"rear":[[82,90,46,38],[0,94,27,34]]}]},"look":{"duration":2220,"loop":false,"poses":[{"at":0,"sheet":"idle","frame":0,"anchor":[54,102],"targetX":55,"contacts":[[37,102],[72,102]],"rear":[[82,90,46,38],[0,94,27,34]]},{"at":200,"sheet":"look-head","frame":0,"anchor":[54,102],"targetX":55,"contacts":[[37,102],[72,102]],"rear":[[82,90,46,38],[0,94,27,34]],"part":"head"},{"at":280,"sheet":"look-head","frame":1,"anchor":[54,102],"targetX":55,"contacts":[[37,102],[72,102]],"rear":[[82,90,46,38],[0,94,27,34]],"part":"head"},{"at":360,"sheet":"look-head","frame":2,"anchor":[54,102],"targetX":55,"contacts":[[37,102],[72,102]],"rear":[[82,90,46,38],[0,94,27,34]],"part":"head"},{"at":440,"sheet":"look-head","frame":3,"anchor":[54,102],"targetX":55,"contacts":[[37,102],[72,102]],"rear":[[82,90,46,38],[0,94,27,34]],"part":"head"},{"at":800,"sheet":"look-head","frame":2,"anchor":[54,102],"targetX":55,"contacts":[[37,102],[72,102]],"rear":[[82,90,46,38],[0,94,27,34]],"part":"head"},{"at":880,"sheet":"look-head","frame":1,"anchor":[54,102],"targetX":55,"contacts":[[37,102],[72,102]],"rear":[[82,90,46,38],[0,94,27,34]],"part":"head"},{"at":960,"sheet":"look-head","frame":0,"anchor":[54,102],"targetX":55,"contacts":[[37,102],[72,102]],"rear":[[82,90,46,38],[0,94,27,34]],"part":"head"},{"at":1040,"sheet":"look-head","frame":4,"anchor":[54,102],"targetX":55,"contacts":[[37,102],[72,102]],"rear":[[82,90,46,38],[0,94,27,34]],"part":"head"},{"at":1120,"sheet":"look-head","frame":5,"anchor":[54,102],"targetX":55,"contacts":[[37,102],[72,102]],"rear":[[82,90,46,38],[0,94,27,34]],"part":"head"},{"at":1200,"sheet":"look-head","frame":6,"anchor":[54,102],"targetX":55,"contacts":[[37,102],[72,102]],"rear":[[82,90,46,38],[0,94,27,34]],"part":"head"},{"at":1280,"sheet":"look-head","frame":7,"anchor":[54,102],"targetX":55,"contacts":[[37,102],[72,102]],"rear":[[82,90,46,38],[0,94,27,34]],"part":"head"},{"at":1700,"sheet":"look-head","frame":6,"anchor":[54,102],"targetX":55,"contacts":[[37,102],[72,102]],"rear":[[82,90,46,38],[0,94,27,34]],"part":"head"},{"at":1780,"sheet":"look-head","frame":5,"anchor":[54,102],"targetX":55,"contacts":[[37,102],[72,102]],"rear":[[82,90,46,38],[0,94,27,34]],"part":"head"},{"at":1860,"sheet":"look-head","frame":4,"anchor":[54,102],"targetX":55,"contacts":[[37,102],[72,102]],"rear":[[82,90,46,38],[0,94,27,34]],"part":"head"},{"at":1940,"sheet":"look-head","frame":0,"anchor":[54,102],"targetX":55,"contacts":[[37,102],[72,102]],"rear":[[82,90,46,38],[0,94,27,34]],"part":"head"},{"at":2020,"sheet":"idle","frame":0,"anchor":[54,102],"targetX":55,"contacts":[[37,102],[72,102]],"rear":[[82,90,46,38],[0,94,27,34]]}],"extra":true},"hang":{"duration":4700,"loop":false,"needsSpaceBelow":75,"poses":[{"at":0,"sheet":"idle","frame":0,"anchor":[54,102],"targetX":55,"contacts":[[37,102],[72,102]],"rear":[[82,90,46,38],[0,94,27,34]]},{"sheet":"turn-v2","frame":0,"anchor":[54,102],"contacts":[[36,101],[71,101]],"targetX":55,"grip":false,"at":180,"rear":[[82,90,46,38],[0,94,27,34]]},{"sheet":"turn-v2","frame":1,"anchor":[52.5,102],"contacts":[[36,101],[70,101]],"targetX":55,"grip":false,"at":250,"rear":[[82,90,46,38],[0,94,27,34]]},{"sheet":"turn-v2","frame":2,"anchor":[52,101.5],"contacts":[[34,100],[69,100]],"targetX":55,"grip":false,"at":320,"rear":[[78,90,50,38],[0,92,27,36]]},{"sheet":"turn-v2","frame":3,"anchor":[47,101],"contacts":[[55,100]],"targetX":55,"grip":false,"at":390,"rear":[[66,92,62,36]]},{"sheet":"turn-v2","frame":4,"anchor":[46.5,105],"contacts":[[21,87]],"targetX":55,"grip":false,"at":460},{"sheet":"turn-v2","frame":5,"anchor":[48,103],"contacts":[[25,93]],"targetX":55,"grip":false,"at":530},{"sheet":"turn-v2","frame":6,"anchor":[53,95.3],"contacts":[[21,89]],"targetX":55,"grip":false,"at":600},{"sheet":"turn-v2","frame":7,"anchor":[56.5,90.4],"contacts":[[23,89]],"targetX":55,"grip":false,"at":670},{"sheet":"lower-a-v2","frame":0,"anchor":[57.3,84.7],"contacts":[[20.7,84.8],[93.8,84.6]],"targetX":55,"grip":true,"at":740},{"sheet":"lower-a-v2","frame":1,"anchor":[57.8,81.8],"contacts":[[21.6,82.7],[94,80.8]],"targetX":55,"grip":true,"at":810},{"sheet":"lower-a-v2","frame":2,"anchor":[57.1,77.5],"contacts":[[20.4,78.7],[93.8,76.2]],"targetX":55,"grip":true,"at":880},{"sheet":"lower-a-v2","frame":3,"anchor":[57.8,76.1],"contacts":[[21.1,77.1],[94.4,75]],"targetX":55,"grip":true,"at":950},{"sheet":"lower-a-v2","frame":4,"anchor":[60.1,64.2],"contacts":[[21.7,65.5],[98.4,62.9]],"targetX":55,"grip":true,"at":1020},{"sheet":"lower-a-v2","frame":5,"anchor":[57.8,59.3],"contacts":[[21.7,59.8],[93.8,58.8]],"targetX":55,"grip":true,"at":1090},{"sheet":"lower-a-v2","frame":6,"anchor":[55.5,63.5],"contacts":[[22.3,63.5],[88.7,63.4]],"targetX":55,"grip":true,"at":1160},{"sheet":"lower-a-v2","frame":7,"anchor":[55.8,64.1],"contacts":[[24.7,64.2],[86.9,64]],"targetX":55,"grip":true,"at":1230},{"sheet":"lower-b-v2","frame":0,"anchor":[58.4,59.4],"contacts":[[27.7,57.9],[89.1,60.9]],"targetX":55,"grip":true,"at":1300},{"sheet":"lower-b-v2","frame":1,"anchor":[56.8,47.2],"contacts":[[27.5,46.9],[86.1,47.4]],"targetX":55,"grip":true,"at":1370},{"sheet":"lower-b-v2","frame":2,"anchor":[56.9,39.3],"contacts":[[29.8,38.5],[84,40.1]],"targetX":55,"grip":true,"at":1440},{"sheet":"lower-b-v2","frame":3,"anchor":[56.7,25.5],"contacts":[[36.8,25.2],[76.6,25.7]],"targetX":55,"grip":true,"at":1510},{"sheet":"lower-b-v2","frame":4,"anchor":[57.8,21.4],"contacts":[[38.2,21.4],[77.3,21.3]],"targetX":55,"grip":true,"at":1580},{"sheet":"lower-b-v2","frame":5,"anchor":[58.3,19.6],"contacts":[[39.2,19.4],[77.3,19.8]],"targetX":55,"grip":true,"at":1650},{"sheet":"lower-b-v2","frame":6,"anchor":[58.7,22],"contacts":[[39.8,21.7],[77.5,22.2]],"targetX":55,"grip":true,"at":1720},{"sheet":"lower-b-v2","frame":7,"anchor":[59,19],"contacts":[[40.2,18.8],[77.7,19.2]],"targetX":55,"grip":true,"at":1790},{"sheet":"lower-b-v2","frame":6,"anchor":[58.7,22],"contacts":[[39.8,21.7],[77.5,22.2]],"targetX":55,"grip":true,"at":1930},{"sheet":"lower-b-v2","frame":7,"anchor":[59,19],"contacts":[[40.2,18.8],[77.7,19.2]],"targetX":55,"grip":true,"at":2060},{"sheet":"lower-b-v2","frame":5,"anchor":[58.3,19.6],"contacts":[[39.2,19.4],[77.3,19.8]],"targetX":55,"grip":true,"at":2240},{"sheet":"lower-b-v2","frame":4,"anchor":[57.8,21.4],"contacts":[[38.2,21.4],[77.3,21.3]],"targetX":55,"grip":true,"at":2310},{"sheet":"lower-b-v2","frame":3,"anchor":[56.7,25.5],"contacts":[[36.8,25.2],[76.6,25.7]],"targetX":55,"grip":true,"at":2380},{"sheet":"climb-a-v2","frame":0,"anchor":[56.2,27.2],"contacts":[[33.8,27.3],[78.5,27]],"targetX":55,"grip":true,"at":2450},{"sheet":"climb-a-v2","frame":1,"anchor":[55.6,27],"contacts":[[33.2,26.9],[77.9,27]],"targetX":55,"grip":true,"at":2520},{"sheet":"climb-a-v2","frame":2,"anchor":[54.9,32.3],"contacts":[[31.9,32.1],[77.8,32.5]],"targetX":55,"grip":true,"at":2590},{"sheet":"climb-a-v2","frame":3,"anchor":[56.9,32.5],"contacts":[[31.6,32.3],[82.1,32.6]],"targetX":55,"grip":true,"at":2660},{"sheet":"climb-a-v2","frame":4,"anchor":[56.6,40.5],"contacts":[[29.6,40.4],[83.6,40.6]],"targetX":55,"grip":true,"at":2730},{"sheet":"climb-a-v2","frame":5,"anchor":[56.7,43],"contacts":[[28.2,42.5],[85.2,43.4]],"targetX":55,"grip":true,"at":2800},{"sheet":"climb-a-v2","frame":6,"anchor":[56.8,51.3],"contacts":[[24.4,51.6],[89.2,51]],"targetX":55,"grip":true,"at":2870},{"sheet":"climb-a-v2","frame":7,"anchor":[58.2,51.7],"contacts":[[28.9,52.4],[87.5,51]],"targetX":55,"grip":true,"at":2940},{"sheet":"climb-b-v2","frame":0,"anchor":[57.4,64],"contacts":[[20.1,64.1],[94.7,63.8]],"targetX":55,"grip":true,"at":3010},{"sheet":"climb-b-v2","frame":1,"anchor":[58.3,63.2],"contacts":[[21.4,63.7],[95.2,62.7]],"targetX":55,"grip":true,"at":3080},{"sheet":"climb-b-v2","frame":2,"anchor":[57.9,64.5],"contacts":[[20.7,64.4],[95.1,64.6]],"targetX":55,"grip":true,"at":3150},{"sheet":"push-v2","frame":1,"anchor":[57.1,71.5],"contacts":[[22.7,72.2],[91.5,70.8]],"targetX":55,"grip":true,"at":3220},{"sheet":"push-v2","frame":2,"anchor":[57.4,74.2],"contacts":[[23.5,75.7],[91.3,72.6]],"targetX":55,"grip":true,"at":3290},{"sheet":"push-v2","frame":3,"anchor":[59.6,79.2],"contacts":[[26.8,78.7],[92.3,79.7]],"targetX":55,"grip":true,"at":3360},{"sheet":"push-v2","frame":4,"anchor":[57,98.1],"contacts":[[22.9,98.1]],"targetX":55,"grip":true,"at":3430},{"sheet":"push-v2","frame":5,"anchor":[57,99.6],"contacts":[[24.8,99.6]],"targetX":55,"grip":true,"at":3500},{"sheet":"push-v2","frame":6,"anchor":[57,101],"contacts":[[25.5,101]],"targetX":55,"grip":true,"at":3570},{"sheet":"push-v2","frame":7,"anchor":[57,100],"contacts":[[26.8,100]],"targetX":55,"grip":true,"at":3640},{"sheet":"climb-b-v2","frame":5,"anchor":[57,99.8],"contacts":[[24.7,99.8]],"targetX":55,"grip":true,"at":3710},{"sheet":"climb-b-v2","frame":6,"anchor":[57,99.8],"contacts":[[25.2,99.8]],"targetX":55,"grip":true,"at":3780},{"sheet":"climb-b-v2","frame":7,"anchor":[57,101],"contacts":[[27,101]],"targetX":55,"grip":true,"at":3850},{"sheet":"turn-v2","frame":7,"anchor":[56.7,93.2],"contacts":[[23,89]],"targetX":55,"grip":false,"at":3920},{"sheet":"turn-v2","frame":6,"anchor":[53.2,95.5],"contacts":[[21,89]],"targetX":55,"grip":false,"at":3990},{"sheet":"turn-v2","frame":5,"anchor":[48.4,103.1],"contacts":[[25,93]],"targetX":55,"grip":false,"at":4060},{"sheet":"turn-v2","frame":4,"anchor":[46.5,105.6],"contacts":[[21,87]],"targetX":55,"grip":false,"at":4130},{"sheet":"turn-v2","frame":3,"anchor":[47,101],"contacts":[[55,100]],"targetX":55,"grip":false,"at":4200,"rear":[[66,92,62,36]]},{"sheet":"turn-v2","frame":2,"anchor":[52,101.5],"contacts":[[34,100],[69,100]],"targetX":55,"grip":false,"at":4270,"rear":[[78,90,50,38],[0,92,27,36]]},{"sheet":"turn-v2","frame":1,"anchor":[52.5,102],"contacts":[[36,101],[70,101]],"targetX":55,"grip":false,"at":4340,"rear":[[82,90,46,38],[0,94,27,34]]},{"sheet":"turn-v2","frame":0,"anchor":[54,102],"contacts":[[36,101],[71,101]],"targetX":55,"grip":false,"at":4410,"rear":[[82,90,46,38],[0,94,27,34]]},{"at":4480,"sheet":"idle","frame":0,"anchor":[54,102],"targetX":55,"contacts":[[37,102],[72,102]],"rear":[[82,90,46,38],[0,94,27,34]]}],"extra":true},"sleep":{"duration":3200,"loop":true,"stillAt":0,"motion":{"breath":0,"legs":0.15,"legPeriod":3.2},"poses":[{"at":0,"sheet":"face","frame":0,"anchor":[54,102],"targetX":55,"contacts":[[37,102],[72,102]],"rear":[[82,90,46,38],[0,94,27,34]],"part":"head","head":[0,0]},{"at":1100,"sheet":"face","frame":0,"anchor":[54,102],"targetX":55,"contacts":[[37,102],[72,102]],"rear":[[82,90,46,38],[0,94,27,34]],"part":"head","head":[0,1]},{"at":1500,"sheet":"face","frame":0,"anchor":[54,102],"targetX":55,"contacts":[[37,102],[72,102]],"rear":[[82,90,46,38],[0,94,27,34]],"part":"head","head":[0,2]},{"at":2500,"sheet":"face","frame":0,"anchor":[54,102],"targetX":55,"contacts":[[37,102],[72,102]],"rear":[[82,90,46,38],[0,94,27,34]],"part":"head","head":[0,1]},{"at":2900,"sheet":"face","frame":0,"anchor":[54,102],"targetX":55,"contacts":[[37,102],[72,102]],"rear":[[82,90,46,38],[0,94,27,34]],"part":"head","head":[0,0]}],"props":[{"prop":"nightcap","at":0,"until":3200,"from":[56,26],"follow":"head","steps":1},{"prop":"z-small","at":0,"until":700,"from":[94,24],"to":[99,8],"steps":3},{"prop":"z","at":700,"until":2100,"from":[99,8],"to":[110,-30],"steps":6,"fadeFrom":0.7},{"prop":"z-small","at":1067,"until":1767,"from":[94,24],"to":[99,8],"steps":3},{"prop":"z","at":1767,"until":3167,"from":[99,8],"to":[110,-30],"steps":6,"fadeFrom":0.7},{"prop":"z-small","at":2133,"until":2833,"from":[94,24],"to":[99,8],"steps":3},{"prop":"z","at":2833,"until":4233,"from":[99,8],"to":[110,-30],"steps":6,"fadeFrom":0.7}]},"wake":{"duration":1500,"loop":false,"stillAt":1400,"poses":[{"at":0,"sheet":"face","frame":0,"anchor":[54,102],"targetX":55,"contacts":[[37,102],[72,102]],"rear":[[82,90,46,38],[0,94,27,34]],"part":"head"},{"at":120,"sheet":"idle","frame":0,"anchor":[54,102],"targetX":55,"contacts":[[37,102],[72,102]],"rear":[[82,90,46,38],[0,94,27,34]],"body":[0,-2]},{"at":220,"sheet":"idle","frame":0,"anchor":[54,102],"targetX":55,"contacts":[[37,102],[72,102]],"rear":[[82,90,46,38],[0,94,27,34]]},{"at":520,"sheet":"blink","frame":0,"anchor":[54,102],"targetX":55,"contacts":[[37,102],[72,102]],"rear":[[82,90,46,38],[0,94,27,34]],"part":"head"},{"at":590,"sheet":"blink","frame":1,"anchor":[54,102],"targetX":55,"contacts":[[37,102],[72,102]],"rear":[[82,90,46,38],[0,94,27,34]],"part":"head"},{"at":660,"sheet":"blink","frame":0,"anchor":[54,102],"targetX":55,"contacts":[[37,102],[72,102]],"rear":[[82,90,46,38],[0,94,27,34]],"part":"head"},{"at":730,"sheet":"idle","frame":0,"anchor":[54,102],"targetX":55,"contacts":[[37,102],[72,102]],"rear":[[82,90,46,38],[0,94,27,34]]},{"at":1100,"sheet":"blink","frame":0,"anchor":[54,102],"targetX":55,"contacts":[[37,102],[72,102]],"rear":[[82,90,46,38],[0,94,27,34]],"part":"head"},{"at":1160,"sheet":"blink","frame":1,"anchor":[54,102],"targetX":55,"contacts":[[37,102],[72,102]],"rear":[[82,90,46,38],[0,94,27,34]],"part":"head"},{"at":1230,"sheet":"blink","frame":0,"anchor":[54,102],"targetX":55,"contacts":[[37,102],[72,102]],"rear":[[82,90,46,38],[0,94,27,34]],"part":"head"},{"at":1300,"sheet":"idle","frame":0,"anchor":[54,102],"targetX":55,"contacts":[[37,102],[72,102]],"rear":[[82,90,46,38],[0,94,27,34]]}],"props":[{"prop":"bang","at":120,"until":200,"from":[24,20],"steps":1},{"prop":"bang","at":200,"until":1000,"from":[24,14],"steps":1},{"prop":"nightcap","at":0,"until":120,"from":[56,26],"follow":"head","steps":1},{"prop":"nightcap","at":120,"until":700,"from":[56,20],"to":[112,-34],"steps":5,"fadeFrom":0.6}]},"think":{"duration":2400,"loop":true,"stillAt":1000,"motion":{"breath":4,"legs":0.3,"legPeriod":3.4},"poses":[{"at":0,"sheet":"face","frame":1,"anchor":[54,102],"targetX":55,"contacts":[[37,102],[72,102]],"rear":[[82,90,46,38],[0,94,27,34]],"part":"head"},{"at":2070,"sheet":"blink","frame":1,"anchor":[54,102],"targetX":55,"contacts":[[37,102],[72,102]],"rear":[[82,90,46,38],[0,94,27,34]],"part":"head"},{"at":2160,"sheet":"face","frame":1,"anchor":[54,102],"targetX":55,"contacts":[[37,102],[72,102]],"rear":[[82,90,46,38],[0,94,27,34]],"part":"head"}],"props":[{"prop":"thought-1","at":0,"until":400,"from":[100,4],"steps":1},{"prop":"thought-2","at":400,"until":800,"from":[100,4],"steps":1},{"prop":"thought-3","at":800,"until":1400,"from":[100,4],"steps":1},{"prop":"thought-idea","at":1400,"until":2000,"from":[100,4],"steps":1},{"prop":"thought-0","at":2000,"until":2400,"from":[100,4],"steps":1}]},"typing":{"duration":2400,"loop":true,"stillAt":0,"blendMs":55,"poses":[{"at":0,"sheet":"typing","frame":8,"anchor":[67,104],"targetX":55,"contacts":[[67,104]],"rear":[[94,96,34,32],[0,100,18,28]]},{"at":170,"sheet":"typing","frame":9,"anchor":[67,104],"targetX":55,"contacts":[[67,104]],"rear":[[94,96,34,32],[0,100,18,28]]},{"at":340,"sheet":"typing","frame":8,"anchor":[67,104],"targetX":55,"contacts":[[67,104]],"rear":[[94,96,34,32],[0,100,18,28]]},{"at":510,"sheet":"typing","frame":9,"anchor":[67,104],"targetX":55,"contacts":[[67,104]],"rear":[[94,96,34,32],[0,100,18,28]]},{"at":680,"sheet":"typing","frame":8,"anchor":[67,104],"targetX":55,"contacts":[[67,104]],"rear":[[94,96,34,32],[0,100,18,28]]},{"at":850,"sheet":"typing","frame":11,"anchor":[67,104],"targetX":55,"contacts":[[67,104]],"rear":[[94,96,34,32],[0,100,18,28]]},{"at":1090,"sheet":"typing","frame":8,"anchor":[67,104],"targetX":55,"contacts":[[67,104]],"rear":[[94,96,34,32],[0,100,18,28]]},{"at":1260,"sheet":"typing","frame":9,"anchor":[67,104],"targetX":55,"contacts":[[67,104]],"rear":[[94,96,34,32],[0,100,18,28]]},{"at":1430,"sheet":"typing","frame":8,"anchor":[67,104],"targetX":55,"contacts":[[67,104]],"rear":[[94,96,34,32],[0,100,18,28]]},{"at":1600,"sheet":"typing","frame":10,"anchor":[67,104],"targetX":55,"contacts":[[67,104]],"rear":[[94,96,34,32],[0,100,18,28]]},{"at":1700,"sheet":"typing","frame":8,"anchor":[67,104],"targetX":55,"contacts":[[67,104]],"rear":[[94,96,34,32],[0,100,18,28]]},{"at":1910,"sheet":"typing","frame":9,"anchor":[67,104],"targetX":55,"contacts":[[67,104]],"rear":[[94,96,34,32],[0,100,18,28]]},{"at":2080,"sheet":"typing","frame":11,"anchor":[67,104],"targetX":55,"contacts":[[67,104]],"rear":[[94,96,34,32],[0,100,18,28]]},{"at":2250,"sheet":"typing","frame":8,"anchor":[67,104],"targetX":55,"contacts":[[67,104]],"rear":[[94,96,34,32],[0,100,18,28]]}]},"typing-transition":{"duration":900,"loop":false,"stillAt":899,"blendMs":80,"motion":{"breath":0,"legs":0},"poses":[{"at":0,"sheet":"idle","frame":0,"anchor":[54,102],"targetX":55,"contacts":[[37,102],[72,102]],"rear":[[82,90,46,38],[0,94,27,34]],"restingLaptop":true},{"at":60,"sheet":"typing","frame":0,"anchor":[67,104],"targetX":55,"contacts":[[67,104]],"rear":[[94,96,34,32],[0,100,18,28]]},{"at":140,"sheet":"typing","frame":1,"anchor":[67,104],"targetX":55,"contacts":[[67,104]],"rear":[[94,96,34,32],[0,100,18,28]]},{"at":260,"sheet":"typing","frame":2,"anchor":[67,104],"targetX":55,"contacts":[[67,104]],"rear":[[94,96,34,32],[0,100,18,28]]},{"at":390,"sheet":"typing","frame":3,"anchor":[67,104],"targetX":55,"contacts":[[67,104]],"rear":[[94,96,34,32],[0,100,18,28]]},{"at":500,"sheet":"typing","frame":4,"anchor":[67,104],"targetX":55,"contacts":[[67,104]],"rear":[[94,96,34,32],[0,100,18,28]]},{"at":610,"sheet":"typing","frame":5,"anchor":[67,104],"targetX":55,"contacts":[[67,104]],"rear":[[94,96,34,32],[0,100,18,28]]},{"at":720,"sheet":"typing","frame":6,"anchor":[67,104],"targetX":55,"contacts":[[67,104]],"rear":[[94,96,34,32],[0,100,18,28]]},{"at":820,"sheet":"typing","frame":8,"anchor":[67,104],"targetX":55,"contacts":[[67,104]],"rear":[[94,96,34,32],[0,100,18,28]]}]}},"states":{"idle":{"label":"待机","status":"ready","clip":"idle"},"idle-look":{"label":"闲置张望","status":"ready","clip":"look"},"idle-spout":{"label":"闲置悬挂与爬回","status":"ready","clip":"hang"},"thinking":{"label":"思考","status":"ready","clip":"think"},"typing":{"label":"打字","status":"ready","clip":"typing"},"music":{"label":"耳机忙碌","status":"pending","fallback":"idle"},"conducting":{"label":"指挥协作","status":"pending","fallback":"idle"},"building":{"label":"大忙特忙","status":"pending","fallback":"idle"},"error":{"label":"出错","status":"pending","fallback":"idle"},"happy":{"label":"开心完成","status":"pending","fallback":"idle"},"notification":{"label":"等待用户","status":"pending","fallback":"idle"},"compacting":{"label":"整理上下文","status":"pending","fallback":"idle"},"sleeping":{"label":"睡觉","status":"ready","clip":"sleep"},"waking":{"label":"醒来","status":"ready","clip":"wake"},"poke-left":{"label":"左边被戳","status":"pending","fallback":"idle"},"poke-right":{"label":"右边被戳","status":"pending","fallback":"idle"},"tickle":{"label":"挠痒痒","status":"pending","fallback":"idle"},"drag":{"label":"被拎起","status":"pending","fallback":"idle"}},"glyphs":{"z":{"colors":{"o":"eef7ff"},"outline":"263774","rows":["oooooo","....oo","...oo.","..oo..",".oo...","oooooo"]},"z-small":{"colors":{"o":"eef7ff"},"outline":"263774","rows":["oooo","..o.",".o..","oooo"]},"bang":{"colors":{"o":"ffd84a"},"outline":"151e48","rows":["ooo","ooo","ooo","ooo","...","ooo"]},"thought-1":{"rows":[".............................","..............w..............","..........wwwwwwwww..........",".......wwwwwwwwwwwwww.w......","....wwwwwwwwwwwwwwwwwwwwww...","...wwwwwwwwwwwwwwwwwwwwwwww..","..wwwwwwwwwwwwwwwwwwwwwwwwww.","..wwwwwwnnwwwwwwwwwwwwwwwwww.",".wwwwwwwnnwwwwwwwwwwwwwwwwwww","..wwwwwwwwwwwwwwwwwwwwwwwwww.","..wwwwwwwwwwwwwwwwwwwwwwwwww.","...wwwwwwwwwwwwwwwwwwwwwwww..","....wwwwwwwwwwwwwwwwwwwwww...",".......wwwwwwwwwwwwwwwww.....",".........wwwwwwwwwwwww.......","...............w.............","........w....................","......wwwww..................","........w....................",".............................",".............................","....www......................"],"colors":{"w":"fff9f0","n":"172650","y":"ffd84a"},"outline":"172650"},"thought-2":{"rows":[".............................","..............w..............","..........wwwwwwwww..........",".......wwwwwwwwwwwwww.w......","....wwwwwwwwwwwwwwwwwwwwww...","...wwwwwwwwwwwwwwwwwwwwwwww..","..wwwwwwwwwwwwwwwwwwwwwwwwww.","..wwwwwwnnwwwwnnwwwwwwwwwwww.",".wwwwwwwnnwwwwnnwwwwwwwwwwwww","..wwwwwwwwwwwwwwwwwwwwwwwwww.","..wwwwwwwwwwwwwwwwwwwwwwwwww.","...wwwwwwwwwwwwwwwwwwwwwwww..","....wwwwwwwwwwwwwwwwwwwwww...",".......wwwwwwwwwwwwwwwww.....",".........wwwwwwwwwwwww.......","...............w.............","........w....................","......wwwww..................","........w....................",".............................",".............................","....www......................"],"colors":{"w":"fff9f0","n":"172650","y":"ffd84a"},"outline":"172650"},"thought-3":{"rows":[".............................","..............w..............","..........wwwwwwwww..........",".......wwwwwwwwwwwwww.w......","....wwwwwwwwwwwwwwwwwwwwww...","...wwwwwwwwwwwwwwwwwwwwwwww..","..wwwwwwwwwwwwwwwwwwwwwwwwww.","..wwwwwwnnwwwwnnwwwwnnwwwwww.",".wwwwwwwnnwwwwnnwwwwnnwwwwwww","..wwwwwwwwwwwwwwwwwwwwwwwwww.","..wwwwwwwwwwwwwwwwwwwwwwwwww.","...wwwwwwwwwwwwwwwwwwwwwwww..","....wwwwwwwwwwwwwwwwwwwwww...",".......wwwwwwwwwwwwwwwww.....",".........wwwwwwwwwwwww.......","...............w.............","........w....................","......wwwww..................","........w....................",".............................",".............................","....www......................"],"colors":{"w":"fff9f0","n":"172650","y":"ffd84a"},"outline":"172650"},"thought-idea":{"rows":[".............................","..............w..............","..........wwwwwwwww..........",".......wwwwwwwwywwwww.w......","....wwwwwwwwwyyyyywwwwwwww...","...wwwwwwwwwywyyyyywwwwwwww..","..wwwwwwwwwwywyyyyywwwwwwwww.","..wwwwwwwwwyyyyyyyyywwwwwwww.",".wwwwwwwwwwwyyyyyyywwwwwwwwww","..wwwwwwwwwwyyyyyyywwwwwwwww.","..wwwwwwwwwwwnnnnnwwwwwwwwww.","...wwwwwwwwwwnnnnnwwwwwwwww..","....wwwwwwwwwnnnnnwwwwwwww...",".......wwwwwwwwwwwwwwwww.....",".........wwwwwwwwwwwww.......","...............w.............","........w....................","......wwwww..................","........w....................",".............................",".............................","....www......................"],"colors":{"w":"fff9f0","n":"172650","y":"ffd84a"},"outline":"172650"},"thought-0":{"rows":[".............................","..............w..............","..........wwwwwwwww..........",".......wwwwwwwwwwwwww.w......","....wwwwwwwwwwwwwwwwwwwwww...","...wwwwwwwwwwwwwwwwwwwwwwww..","..wwwwwwwwwwwwwwwwwwwwwwwwww.","..wwwwwwwwwwwwwwwwwwwwwwwwww.",".wwwwwwwwwwwwwwwwwwwwwwwwwwww","..wwwwwwwwwwwwwwwwwwwwwwwwww.","..wwwwwwwwwwwwwwwwwwwwwwwwww.","...wwwwwwwwwwwwwwwwwwwwwwww..","....wwwwwwwwwwwwwwwwwwwwww...",".......wwwwwwwwwwwwwwwww.....",".........wwwwwwwwwwwww.......","...............w.............","........w....................","......wwwww..................","........w....................",".............................",".............................","....www......................"],"colors":{"w":"fff9f0","n":"172650","y":"ffd84a"},"outline":"172650"},"code-mark":{"rows":["..n...n..",".n.....n.","n...n...n",".n.....n.","..n...n.."],"colors":{"n":"63caff"},"outline":"172650","cell":1}},"props":{"nightcap":{"sheet":"props","frame":0,"anchor":[56,79]},"laptop-closed":{"sheet":"props","frame":1,"anchor":[64,68]}},"transitions":{"typing":"typing-transition"},"restingLaptop":{"prop":"laptop-closed","from":[16,107]}}
    /**
     * Whale-maid renderer. Source of truth: this file + assets/whale-maid/manifest.json.
     * build-maid.mjs embeds both in client.js, so Electron needs no extra asset route.
     * The original Deepy remains the state machine. We only observe its public DOM
     * animation key; switching off removes our nodes/CSS and reveals it intact.
     */
    function maidResolveState(assets, key) {
      const state = assets.states[key]
      if (state?.status === 'ready' && assets.clips[state.clip]) return { clip: state.clip, still: false, pending: false }
      // A state without its own clip yet keeps the LIVING idle (breathing, blinking,
      // swinging legs). Freezing her made the most common states — thinking,
      // typing, sleeping — look like the mascot had hung.
      return { clip: assets.clips[state?.fallback] ? state.fallback : 'idle', still: false, pending: true }
    }
    
    function maidSample(assets, clipName, elapsed, still = false) {
      const clip = assets.clips[clipName] || assets.clips.idle
      const time = still ? (clip.stillAt || 0) : clip.loop ? Math.max(0, elapsed) % clip.duration : Math.min(Math.max(0, elapsed), clip.duration - 1)
      let index = 0
      for (let i=1;i<clip.poses.length;i++) { if (clip.poses[i].at > time) break; index=i }
      const pose=clip.poses[index]
      // Raised arms make a taller silhouette. Match the head's apparent size
      // across sheets instead of shrinking the whole character to fit that height.
      const position=p=>{
        const size=assets.displaySize*(assets.sheets[p.sheet].renderScale||1)
        return {...p,size,x:p.targetX-p.anchor[0]*size/assets.frameSize,y:assets.edgeY-p.anchor[1]*size/assets.frameSize}
      }
      const fade=still?0:Math.min(clip.blendMs||0,clip.duration-pose.at)
      const blend=index>0&&fade>0?Math.min(1,(time-pose.at)/fade):1
      return { ...position(pose), time,
        ...(blend<1?{blend,previous:position(clip.poses[index-1])}:{}) }
    }
    
    function maidHasRoom(rect, viewport, bottom = 62) {
      return rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.right <= viewport.width
        && rect.top + 97 + bottom <= viewport.height - 10
    }
    
    function createMaidRuntime(assets, env = {}) {
      const doc = env.document || (typeof document !== 'undefined' ? document : null)
      const win = env.window || (typeof window !== 'undefined' ? window : null)
      const Observer = env.MutationObserver || (typeof MutationObserver !== 'undefined' ? MutationObserver : null)
      const ResizeObserverClass = env.ResizeObserver || win?.ResizeObserver
      const ImageClass = env.Image || win?.Image
      const now = env.now || (() => Date.now())
      const later = env.setTimeout || ((fn, ms) => setTimeout(fn, ms))
      const cancel = env.clearTimeout || ((id) => clearTimeout(id))
      const requestFrame = env.requestAnimationFrame || (win?.requestAnimationFrame
        ? fn=>win.requestAnimationFrame(fn) : fn=>later(fn,1000/60))
      const cancelFrame = env.cancelAnimationFrame || (win?.cancelAnimationFrame
        ? id=>win.cancelAnimationFrame(id) : cancel)
      const inert = { dispose() {}, refresh() {}, preview() {}, ready: Promise.resolve(false), count: () => 0 }
      if (!doc?.body || !win || !Observer || !ImageClass) return inert
    
      const OWNER = 'maid-' + Math.random().toString(36).slice(2)
      const ROOT_SELECTOR = '.dsh-claude-deepy'
      const ROOT_ATTR = 'data-dsh-csa-maid'
      const STYLE_ID = 'dsh-claude-style-addons/whale-maid.css'
      const records = new Map()
      const images = {}
      const pendingImages = new Set()
      let alive = true, loaded = false, timer = null, queued = false, style = null
      let lastInput = now(), lastGeometry = 0
      const CSS = `
    body[data-dsh-claude-style][data-dsh-claude-brand="deepseek"] .dsh-claude-deepy[${ROOT_ATTR}] > .dsh-claude-deepy-sprite { visibility: hidden !important; }
    /* The conversation card is z-index:2. Legs must sit in front of its face,
       just as they do when the home-page mascot is a child of the card. */
    body[data-dsh-claude-style] .dsh-claude-deepy[${ROOT_ATTR}] { overflow: visible; z-index:3; }
    body[data-dsh-claude-style] .dsh-claude-deepy[${ROOT_ATTR}] > .dsh-csa-maid-canvas { position:absolute; left:0; top:var(--dsh-csa-maid-edge-offset,0px); width:128px; height:176px; pointer-events:none !important; image-rendering:pixelated; }
    body[data-dsh-claude-style] .dsh-claude-deepy[${ROOT_ATTR}] > .dsh-claude-deepy-hit { left:30px; top:calc(43px + var(--dsh-csa-maid-edge-offset,0px)); width:52px; height:50px; }
    `
    
      function enabled() {
        return doc.body.hasAttribute('data-dsh-claude-style') && doc.body.getAttribute('data-dsh-claude-brand') === 'deepseek'
      }
      function reduced() { return doc.body.getAttribute('data-dsh-claude-motion') === 'reduced' }
      function ensureStyle() {
        if (style?.isConnected) return
        style = doc.createElement('style')
        style.dataset.plugin = 'dsh-claude-style-addons'
        style.dataset.pluginCss = STYLE_ID
        style.dataset.maidOwner = OWNER
        style.textContent = CSS
        doc.head.appendChild(style)
      }
      function remove(record) {
        record.resizeObserver?.disconnect()
        record.canvas.remove()
        if (record.root.getAttribute(ROOT_ATTR) === OWNER) {
          record.root.removeAttribute(ROOT_ATTR)
          record.root.removeAttribute('data-dsh-csa-maid-state')
          record.root.removeAttribute('data-dsh-csa-maid-clip')
          record.root.removeAttribute('data-dsh-csa-maid-transition')
          record.root.style.removeProperty('--dsh-csa-maid-edge-offset')
        }
        records.delete(record.root)
      }
      function align(record) {
        // Home uses the card itself as anchor; conversations use an outer stack.
        // Measure the real rim so attachments and growing text cannot move the seat.
        const card = record.root.closest('[data-composer-card]')
          || record.root.parentElement?.querySelector('[data-composer-card]')
        if (record.card !== card) {
          record.resizeObserver?.disconnect()
          record.card = card
          if (card) record.resizeObserver?.observe(card)
          if (record.root.parentElement) record.resizeObserver?.observe(record.root.parentElement)
        }
        const r = record.root.getBoundingClientRect(), c = card?.getBoundingClientRect()
        const offset = c?.width && c?.height ? Math.round(c.top - r.top - assets.edgeY) : 0
        if (record.offset !== offset) {
          record.offset = offset
          record.root.style.setProperty('--dsh-csa-maid-edge-offset', offset + 'px')
        }
      }
      function spaceFor(record) {
        if (env.forceSpace === true) return true
        const r = record.root.getBoundingClientRect()
        const top = r.top + (record.offset || 0)
        if (!maidHasRoom({ ...r, width:r.width, height:r.height, left:r.left, right:r.right, top }, { width: win.innerWidth, height: win.innerHeight }, assets.clips.hang.needsSpaceBelow)) return false
        // The small hanging body sits left of the send control. Do not enter any
        // actionable control's rectangle below the rim, even in a narrow composer.
        const region = { left:r.left+8, right:r.left+78, top:top+99, bottom:top+157 }
        const parent = record.root.parentElement
        const controls = parent?.querySelectorAll('button, select, [role="button"]') || []
        for (const control of controls) {
          if (record.root.contains(control)) continue
          const b=control.getBoundingClientRect()
          if (b.width && b.height && b.left<region.right && b.right>region.left && b.top<region.bottom && b.bottom>region.top) return false
        }
        return true
      }
      function begin(record, clip, t, still = false) {
        record.clip = clip
        record.start = t
        record.still = still
        record.paintKey = ''
        record.root.setAttribute('data-dsh-csa-maid-clip', clip)
      }
      function stopTravel(record) {
        record.travel=null
        record.root.removeAttribute('data-dsh-csa-maid-transition')
      }
      function advanceTravel(record,t) {
        const travel=record.travel
        if(!travel)return
        const duration=assets.clips[travel.clip].duration
        travel.position=Math.max(0,Math.min(duration,travel.position+(t-travel.at)*travel.direction))
        travel.at=t
        if((travel.direction>0&&travel.position>=duration)||(travel.direction<0&&travel.position<=0)) {
          const destination=travel.destination
          stopTravel(record);begin(record,destination,t)
        }
      }
      function route(record,next,t,key,initial=false) {
        const bridge=assets.transitions?.typing
        // Reactions and urgent host states retain their original priority.
        const urgent=['notification','error','drag','poke-left','poke-right','tickle','compacting','music','building','conducting'].includes(key)
        if(initial||reduced()||urgent||!bridge) {
          stopTravel(record);begin(record,next,t);return
        }
        if(record.travel) {
          record.travel.direction=next==='typing'?1:-1
          record.travel.destination=next
          record.root.setAttribute('data-dsh-csa-maid-transition',record.travel.direction>0?'enter':'exit')
          record.paintKey=''
          return
        }
        const entering=next==='typing'&&['idle','think'].includes(record.clip)
        const leaving=record.clip==='typing'&&next!=='typing'
        if(entering||leaving) {
          const duration=assets.clips[bridge].duration
          record.travel={clip:bridge,position:entering?0:duration-0.001,direction:entering?1:-1,at:t,destination:next}
          begin(record,bridge,t)
          record.root.setAttribute('data-dsh-csa-maid-transition',entering?'enter':'exit')
          return
        }
        if(next!==record.clip)begin(record,next,t)
      }
      function select(record, t) {
        advanceTravel(record,t)
        const key = record.root.getAttribute('data-animation') || 'idle'
        if (key !== record.host) {
          const initial=record.host===null
          record.host = key
          record.root.setAttribute('data-dsh-csa-maid-state', key)
          // Let a longer idle extra finish after the original 3.2s sheet returns
          // to idle. Real work or user interaction always interrupts immediately.
          const finishingExtra = !record.travel && key === 'idle' && record.clip !== 'idle'
            && !assets.clips[record.clip].loop && t < record.start + assets.clips[record.clip].duration
          if (!finishingExtra) {
            const chosen = maidResolveState(assets, key)
            let next = chosen.clip
            // Only idle extras (look / hang) give way to a reader who just typed or
            // clicked. Work states and waking must play right away.
            if (assets.clips[next]?.extra && t - lastInput < 8000) next = 'idle'
            if (next === 'hang' && !spaceFor(record)) next = 'look'
            route(record,next,t,key,initial)
          }
        }
        if(record.travel&&reduced()) {
          const destination=record.travel.destination
          stopTravel(record);begin(record,destination,t)
        }
        if (!record.travel && record.clip !== 'idle' && !assets.clips[record.clip].loop && t >= record.start + assets.clips[record.clip].duration) begin(record, 'idle', t)
        // Reduced motion: extras are skipped; every other state shows its still pose.
        if (reduced() && assets.clips[record.clip]?.extra) begin(record, 'idle', t)
      }
      // Seated body + replaceable head ("face" layer). Head sheets (blink, face,
      // look-head) are derived from idle frame 0 by tools/build-maid.mjs --derive,
      // so everything outside the changed face/head is pixel-identical to the body.
      function drawIdle(ctx, pose, t, frozen, unit, motion) {
        const fs=assets.frameSize, img=images.idle
        const headImg=pose.part==='head'?images[pose.sheet]:img, headFrame=pose.part==='head'?pose.frame:0
        const phase=frozen?0:t/1000
        // Breathing lifts the head by exactly one device pixel; a fractional stretch
        // made nearest-neighbour sampling re-pick rows every frame (shimmer).
        const breathPeriod=motion.breath===undefined?3.2:motion.breath
        const lift=frozen||!breathPeriod?0:((1-Math.cos(phase*Math.PI*2/breathPeriod))/2>=0.5?1:0)
        // pose.head: whole device pixels, [right, down] — a doze nod, a startle.
        const headX=(pose.head?.[0]||0)*unit, headY=((pose.head?.[1]||0)-lift)*unit
        const NECK=64, BODY=78
        const legs=[[38,102,15,21,45,102],[54,102,14,21,60,102]]
        ctx.save();ctx.translate(pose.x,pose.y);ctx.scale(pose.size/fs,pose.size/fs)
        ctx.save();ctx.beginPath();ctx.rect(0,0,fs,fs)
        for(const [x,y,w,h] of legs)ctx.rect(x,y,w,h)
        ctx.clip('evenodd')
        // Head moves rigidly; only the short neck/collar band absorbs the offset.
        ctx.drawImage(headImg,headFrame*fs,0,fs,NECK,headX,headY,fs,NECK)
        ctx.drawImage(headImg,headFrame*fs,NECK,fs,BODY-NECK,headX,NECK+headY,fs,BODY-NECK-headY)
        ctx.drawImage(img,0,BODY,fs,fs-BODY,0,BODY,fs,fs-BODY)
        ctx.restore()
        // Rotate lower legs around the knees; palms and hips never translate.
        const legAmp=motion.legs===undefined?1:motion.legs, legPeriod=motion.legPeriod||2.1
        for(let i=0;i<legs.length;i++) {
          const [x,y,w,h,px,py]=legs[i]
          const angle=frozen?0:Math.sin(phase*Math.PI*2/legPeriod)*(.13+i*.025)*(i?-0.85:1)*legAmp
          ctx.save();ctx.translate(px,py);ctx.rotate(angle);ctx.translate(-px,-py)
          ctx.drawImage(img,x,y,w,h,x,y,w,h);ctx.restore()
        }
        ctx.restore()
        return {headX,headY}
      }
      // Prop layer: small things around her (Z, "!", bubbles, hats). A prop is
      // either a code-drawn glyph (manifest "glyphs") or a drawn sprite from the
      // "props" sheet (manifest "props"). Missing art is skipped, so a clip may
      // reference a prop before its picture exists.
      const glyphCache=new Map()
      function glyphCells(glyph) {
        if(glyphCache.has(glyph))return glyphCache.get(glyph)
        const rows=glyph.rows, pad=glyph.outline?1:0, list=[]
        const filled=(c,r)=>r>=0&&r<rows.length&&c>=0&&c<rows[r].length&&!!glyph.colors[rows[r][c]]
        const w=rows[0].length+pad*2, h=rows.length+pad*2
        for(let r=-pad;r<rows.length+pad;r++)for(let c=-pad;c<rows[0].length+pad;c++){
          if(filled(c,r)){list.push([c+pad,r+pad,glyph.colors[rows[r][c]]]);continue}
          if(!pad)continue
          let near=false;for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++)if(filled(c+dc,r+dr))near=true
          if(near)list.push([c+pad,r+pad,glyph.outline])
        }
        const out={w,h,list};glyphCache.set(glyph,out);return out
      }
      function propActive(item, clip, time) {
        const life=item.until-item.at
        let local=time-item.at
        if(clip.loop&&local<0)local+=clip.duration
        return local>=0&&local<life?local/life:-1
      }
      function drawProps(ctx, clip, pose, time, frozen, head, ratio) {
        const fs=assets.frameSize, k=pose.size/fs
        for(const item of clip.props||[]) {
          const f=propActive(item,clip,time)
          if(f<0)continue
          const glyph=assets.glyphs?.[item.prop], sprite=assets.props?.[item.prop]
          if(!glyph&&!(sprite&&images[sprite.sheet]))continue
          // Movement in whole steps so the pixels never land between device pixels.
          const steps=item.steps||8, q=frozen?0:Math.min(steps,Math.floor(f*steps))/steps
          const from=item.from, to=item.to||item.from
          let ax=from[0]+(to[0]-from[0])*q, ay=from[1]+(to[1]-from[1])*q
          let x=pose.x+ax*k, y=pose.y+ay*k
          if(item.follow==='head'){x+=head.headX*k;y+=head.headY*k}
          ctx.save()
          if(item.fadeFrom!==undefined&&f>=item.fadeFrom)ctx.globalAlpha=0.5
          if(glyph) {
            // One glyph cell = one CSS pixel (whole device pixels), with an
            // optional 1-cell outline so it reads on light and dark composers.
            const cells=glyphCells(glyph), cell=glyph.cell||1
            x=Math.round((x-cells.w*cell/2)*ratio)/ratio;y=Math.round((y-cells.h*cell)*ratio)/ratio
            for(const [c,r,color] of cells.list){ctx.fillStyle='#'+color;ctx.fillRect(x+c*cell,y+r*cell,cell,cell)}
          } else {
            // Drawn props share the character's pixel size; anchor = attach point.
            const [px,py]=sprite.anchor||[64,64]
            x=Math.round((x-px*k)*ratio)/ratio;y=Math.round((y-py*k)*ratio)/ratio
            ctx.drawImage(images[sprite.sheet],sprite.frame*fs,0,fs,fs,x,y,fs*k,fs*k)
          }
          ctx.restore()
        }
      }
      function drawRestingLaptop(ctx,ratio) {
        if(!assets.restingLaptop)return
        const base=maidSample(assets,'idle',0,true)
        base.x=Math.round(base.x*ratio)/ratio;base.y=Math.round(base.y*ratio)/ratio
        drawProps(ctx,{duration:1,loop:true,props:[{...assets.restingLaptop,at:0,until:1,steps:1}]},base,0,true,{headX:0,headY:0},ratio)
      }
      function paint(record, t) {
        const frozen = record.still || reduced()
        const clip = assets.clips[record.clip] || assets.clips.idle
        const sampled = maidSample(assets, record.clip, record.travel?.position??(t-record.start), frozen)
        // Snap the sprite origin to the device-pixel grid so every pose samples
        // its pixel art the same way instead of drifting by sub-pixel offsets.
        // pose.body: whole-device-pixel offset of the entire figure (a hop).
        const ratio=record.ratio
        const pose={...sampled,
          x:Math.round(sampled.x*ratio)/ratio+(sampled.body?.[0]||0)/ratio,
          y:Math.round(sampled.y*ratio)/ratio+(sampled.body?.[1]||0)/ratio}
        const motionTime=frozen?0:t-record.start
        const livePose=!frozen&&(pose.sheet==='idle'||pose.part==='head'||clip.props?.length||clip.blendMs)
        const phase=livePose?Math.floor((record.travel?.position??motionTime)/(1000/60)):0
        const signature = [record.clip,pose.sheet,pose.frame,pose.x,pose.y,phase,ratio].join(':')
        if (record.paintKey === signature) return
        record.paintKey = signature
        const ctx=record.ctx, fs=assets.frameSize, size=pose.size
        ctx.setTransform(ratio,0,0,ratio,0,0)
        ctx.clearRect(0,0,128,176)
        ctx.imageSmoothingEnabled=false
        // Mask only rear hair/tail below the actual rim. Feet, apron and hands stay
        // in the foreground; the input's own surface shows through the rear mask.
        ctx.save()
        ctx.beginPath();ctx.rect(0,0,128,176)
        for(const [x,y,w,h] of pose.rear || []) {
          const left=pose.x+x*size/fs, top=Math.max(assets.edgeY+1,pose.y+y*size/fs)
          const bottom=pose.y+(y+h)*size/fs
          if(bottom>top)ctx.rect(left,top,w*size/fs,bottom-top)
        }
        ctx.clip('evenodd')
        // A soft, shallow contact shadow gives the narrow rim some depth without
        // adding a platform to the artwork or changing the real input box.
        ctx.fillStyle='rgba(20,30,64,0.13)'
        ctx.beginPath()
        ctx.ellipse(pose.targetX+1,assets.edgeY+2,18,2.2,0,0,Math.PI*2)
        ctx.fill()
        ctx.fillStyle='rgba(20,30,64,0.18)'
        const contacts=pose.contacts || (pose.grip ? [[pose.anchor[0]-28,pose.anchor[1]],[pose.anchor[0]+25,pose.anchor[1]]] : [pose.anchor])
        // Only marks for points that actually touch the rim (raised hands do not).
        for(const [x,y] of contacts)if(Math.abs(pose.y+y*size/fs-assets.edgeY)<1.5)ctx.fillRect(Math.round(pose.x+x*size/fs)-3,assets.edgeY,6,1)
        const draw=(target,p,freeze)=>{
          let offsets={headX:0,headY:0}
          if(p.sheet==='idle'||p.part==='head')offsets=drawIdle(target,p,motionTime,freeze,fs/(p.size*ratio),clip.motion||{})
          else target.drawImage(images[p.sheet],p.frame*fs,0,fs,fs,p.x,p.y,p.size,p.size)
          if(p.restingLaptop)drawRestingLaptop(target,ratio)
          return offsets
        }
        let head
        if(sampled.previous) {
          // Brief pose changes blend aligned drawings. Accumulate onto
          // a transparent layer so overlapping pixels stay opaque (no dark dip).
          if(!record.blendCanvas)record.blendCanvas=doc.createElement('canvas')
          const layer=record.blendCanvas
          if(layer.width!==record.canvas.width||layer.height!==record.canvas.height){layer.width=record.canvas.width;layer.height=record.canvas.height}
          const mix=layer.getContext('2d')
          mix.setTransform(ratio,0,0,ratio,0,0);mix.clearRect(0,0,128,176);mix.imageSmoothingEnabled=false
          const previous={...sampled.previous,x:Math.round(sampled.previous.x*ratio)/ratio,y:Math.round(sampled.previous.y*ratio)/ratio}
          mix.save();mix.globalAlpha=1-sampled.blend;draw(mix,previous,true)
          mix.globalCompositeOperation='lighter';mix.globalAlpha=sampled.blend;head=draw(mix,pose,true);mix.restore()
          ctx.drawImage(layer,0,0,layer.width,layer.height,0,0,128,176)
        } else head=draw(ctx,pose,frozen)
        ctx.restore()
        if(clip.props?.length)drawProps(ctx,clip,pose,sampled.time,frozen,head,ratio)
        // A closed computer has a persistent home on the ledge. The drawn pickup
        // sequence takes over ownership; it returns to this same spot on exit.
        if(!record.clip.startsWith('typing'))drawRestingLaptop(ctx,ratio)
      }
      function tick() {
        timer=null
        if(!alive || !loaded || doc.hidden || !enabled())return
        const t=now()
        if(t-lastGeometry>250){lastGeometry=t;for(const record of records.values())align(record)}
        let animate=false
        for(const record of records.values()) {
          if(!record.root.isConnected){remove(record);continue}
          select(record,t)
          paint(record,t)
          if(!record.still && !reduced())animate=true
        }
        if(animate && records.size)timer=requestFrame(tick)
      }
      function wake() {
        if(doc.hidden||!enabled()) {if(timer!==null)cancelFrame(timer);timer=null;return}
        // Streaming chat mutations must not repeatedly cancel and restart the clock.
        if(timer===null){tick();return}
        const t=now()
        for(const record of records.values()) {
          if(record.host!==(record.root.getAttribute('data-animation')||'idle')||record.paintKey===''||reduced()) {
            select(record,t);paint(record,t)
          }
        }
        if(reduced()||Array.from(records.values()).every(r=>r.still)){cancelFrame(timer);timer=null}
      }
      function scan() {
        queued=false
        if(!alive || !loaded)return
        if(!enabled()) {
          for(const record of Array.from(records.values()))remove(record)
          if(timer!==null)cancelFrame(timer);timer=null
          style?.remove();style=null
          return
        }
        ensureStyle()
        const roots=Array.from(doc.querySelectorAll(ROOT_SELECTOR))
        for(const record of Array.from(records.values()))if(!roots.includes(record.root)||!record.root.isConnected)remove(record)
        for(const root of roots) {
          if(records.has(root)){align(records.get(root));continue}
          // A newer HMR generation owns its own canvas. Taking over is reversible;
          // an old instance's cleanup may only remove its own owner attribute.
          for(const child of Array.from(root.children))if(child.classList.contains('dsh-csa-maid-canvas'))child.remove()
          const canvas=doc.createElement('canvas')
          canvas.className='dsh-csa-maid-canvas'
          canvas.setAttribute('aria-hidden','true')
          const ratio=Math.min(3,Math.max(1,win.devicePixelRatio||1))
          canvas.width=128*ratio;canvas.height=176*ratio
          const ctx=canvas.getContext('2d')
          if(!ctx)continue
          const record={root,canvas,ctx,ratio,host:null,clip:'idle',start:now(),still:false,paintKey:'',offset:null,card:null}
          if(ResizeObserverClass)record.resizeObserver=new ResizeObserverClass(()=>{if(alive){align(record);geometry()}})
          records.set(root,record)
          root.appendChild(canvas)
          align(record)
          select(record,now());paint(record,now())
          // Hide original only after assets have loaded AND the first frame painted.
          root.setAttribute(ROOT_ATTR,OWNER)
        }
        wake()
      }
      function schedule() {
        if(queued||!alive)return
        queued=true
        Promise.resolve().then(scan)
      }
      const observer=new Observer(schedule)
      observer.observe(doc.body,{subtree:true,childList:true,attributes:true,attributeFilter:['data-animation','data-ready','data-dsh-claude-style','data-dsh-claude-brand','data-dsh-claude-motion']})
      function activity(event) {
        if(event.type==='keydown' && (event.metaKey||event.ctrlKey||event.altKey))return
        lastInput=now()
        for(const record of records.values())if(assets.clips[record.clip]?.extra)begin(record,'idle',now())
        wake()
      }
      function geometry() {
        if(now()-lastGeometry<80)return
        lastGeometry=now()
        for(const record of records.values()) {
          align(record)
          if(record.clip==='hang'&&!spaceFor(record))begin(record,'idle',now())
          const ratio=Math.min(3,Math.max(1,win.devicePixelRatio||1))
          if(record.ratio!==ratio){record.ratio=ratio;record.canvas.width=128*ratio;record.canvas.height=176*ratio;record.paintKey=''}
        }
        wake()
      }
      for(const type of ['input','keydown','pointerdown'])doc.addEventListener(type,activity,true)
      doc.addEventListener('visibilitychange',wake)
      win.addEventListener('resize',geometry)
      win.addEventListener('scroll',geometry,true)
    
      const ready=Promise.all(Object.entries(assets.sheets).map(([name,sheet])=>new Promise((resolve,reject)=>{
        const img=new ImageClass()
        const pending={img,finish:null,timer:null}
        const finish=(error)=>{
          if(!pendingImages.delete(pending))return
          cancel(pending.timer);img.onload=null;img.onerror=null
          if(error)reject(error);else{images[name]=img;resolve()}
        }
        pending.finish=finish;pendingImages.add(pending)
        pending.timer=later(()=>finish(new Error('鲸鱼娘图集加载超时')),15000)
        img.onload=()=>img.naturalWidth===assets.frameSize*sheet.frames && img.naturalHeight===assets.frameSize
          ? finish() : finish(new Error('鲸鱼娘图集尺寸不匹配'))
        img.onerror=()=>finish(new Error('鲸鱼娘图集加载失败'))
        img.src=sheet.url
      }))).then(()=>{if(!alive)return false;loaded=true;scan();return true}).catch(error=>{
        if(alive && typeof console!=='undefined')console.warn('[dsh-claude-style-addons] 鲸鱼娘素材未就绪，保留原版 Deepy：',error.message)
        return false
      })
    
      return {
        ready, refresh:schedule, count:()=>records.size,
        // Used by the standalone preview; production follows only Deepy's events.
        preview(clip, elapsed=0){if(!assets.clips[clip])return;lastInput=0;for(const record of records.values()){stopTravel(record);begin(record,clip,now()-elapsed)}wake()},
        dispose(){
          if(!alive)return
          alive=false;observer.disconnect()
          if(timer!==null)cancelFrame(timer);timer=null
          for(const pending of Array.from(pendingImages))pending.finish(new Error('disposed'))
          for(const record of Array.from(records.values()))remove(record)
          style?.remove();style=null
          for(const type of ['input','keydown','pointerdown'])doc.removeEventListener(type,activity,true)
          doc.removeEventListener('visibilitychange',wake)
          win.removeEventListener('resize',geometry)
          win.removeEventListener('scroll',geometry,true)
        },
      }
    }
    
    function installMaidCompanion() {
      const runtime=createMaidRuntime(MAID_ASSETS)
      return ()=>runtime.dispose()
    }
    
    // END GENERATED WHALE MAID

    // ══ 四、选项 → 功能真正挂上 / 摘下 ═════════════════════════════════════

    /**
     * 跟着偏好开关各个功能。每个功能本来的「挂上 / 卸载」函数原样复用：
     *   · 中文问候语 → installGreeting()（自带「只在皮肤模式下干活」的门禁）；字体 → setFont()；
     *   · 余额卡片   → 页脚那段 CSS + installFooterGuard()；
     *   · 行内代码   → 品牌配色那段 CSS。两段 CSS 共用一个 style 标签，内容按开关拼。
     * @returns {() => void} 全部摘掉。
     */
    function startFeatures() {
      let greetingOff = null
      let stylesOff = null
      let guardOff = null
      let companionOff = null

      const sync = (p) => {
        if (p.mascotVariant === 'whale-maid' && companionOff === null) companionOff = installMaidCompanion()
        else if (p.mascotVariant !== 'whale-maid' && companionOff !== null) {
          companionOff()
          companionOff = null
        }
        greeting.__testing.setFont(p.greetingFont)
        if (p.greeting && greetingOff === null) greetingOff = greeting.__testing.installGreeting()
        else if (!p.greeting && greetingOff !== null) {
          greetingOff()
          greetingOff = null
        }

        if (p.keepBalanceCard || p.deepseekInlineCode) {
          stylesOff = skinFixes.__testing.installStyles({ footer: p.keepBalanceCard, code: p.deepseekInlineCode })
        } else if (stylesOff !== null) {
          stylesOff()
          stylesOff = null
        }

        if (p.keepBalanceCard && guardOff === null) guardOff = skinFixes.__testing.installFooterGuard()
        else if (!p.keepBalanceCard && guardOff !== null) {
          guardOff()
          guardOff = null
        }
      }
      const safeSync = (p) => {
        try {
          sync(p)
        } catch (error) {
          if (typeof console !== 'undefined' && console.warn) console.warn('[dsh-claude-style-addons] 切换功能出错（已忽略）：', error)
        }
      }

      safeSync(readPrefs())
      const off = subscribePrefs(safeSync)
      return () => {
        off()
        if (greetingOff !== null) greetingOff()
        if (stylesOff !== null) stylesOff()
        if (guardOff !== null) guardOff()
        if (companionOff !== null) companionOff()
        greetingOff = null
        stylesOff = null
        guardOff = null
        companionOff = null
      }
    }

    // ══ 五、画进皮肤的「Claude Style」设置页 ════════════════════════════════

    /** 皮肤设置页的根容器 class（设置弹窗那一页、插件页上嵌入的那一份都是它）。 */
    const SETTINGS_ROOT_CLASS = 'dsh-claude-settings'
    /** 本插件追加的那个块的标记。 */
    const BLOCK_ATTR = 'data-dsh-csa-block'
    /** 设置块自己的那点样式（标题、隐藏行）。 */
    const SETTINGS_STYLE_ID = 'dsh-claude-style-addons/settings.css'
    /** 皮肤接管侧栏页脚时打在 body 上的属性（「折叠侧边栏设置区」开着）。 */
    const FOOTER_ATTR = 'data-dsh-claude-footer-takeover'
    /** 皮肤当前品牌（deepseek / claude）。 */
    const BRAND_ATTR = 'data-dsh-claude-brand'

    /** 页面上的文案。 */
    const COPY = {
      heading: '补丁',
      headingDesc: '由 dsh-claude-style-addons 提供。它装在皮肤包外面，皮肤升级不会把这几项冲掉。',
      greetingTitle: '中文问候语',
      greetingDesc: '把新会话首页那句英文问候语换成鲸鱼娘语气的中文台词。什么时候换哪一句仍由皮肤决定，这里只替换文字；关掉就回到英文。',
      fontTitle: '问候语字体',
      fontDesc: '只作用于首页那一行中文问候语。点阵是系统自带的 GB18030 Bitmap，和像素鲸鱼同一套视觉。',
      mascotTitle: '输入框吉祥物',
      mascotDesc: '选择陪在输入框旁的小伙伴。鲸鱼娘会坐着眨眼、晃脚，闲下来会张望，也会转身抓住边缘，悬挂一会儿再爬回来坐好。',
      mascotPending: '鲸鱼娘已完成待机和两种闲置动作，其他状态暂用安静坐姿，后续会继续补充。',
      mascotIdle: '切到 DeepSeek 品牌后显示所选吉祥物。',
      balanceTitle: '余额卡片留在侧栏',
      balanceDesc: '「折叠侧边栏设置区」开着时，余额卡片仍留在侧栏页脚（用户名上方），账号弹层里也不再重复显示一份。',
      balanceIdle: '现在「折叠侧边栏设置区」是关着的，余额卡片本来就在侧栏里，这一项暂时用不上。',
      codeTitle: 'DeepSeek 品牌的行内代码配色',
      codeDesc: '品牌选 DeepSeek 时，行内代码用品牌蓝的底色和字色；皮肤原本把它写成和正文一样的颜色，看不出是代码。',
      codeIdle: '现在的品牌是 Claude，这一项暂时用不上。',
      local: '宿主的设置服务暂时没接上：这次改动已经生效，并记在了这台电脑上，但还没写进配置文件。',
      refused: '宿主没收下这次改动，已恢复成配置文件里的值。',
    }

    const SETTINGS_CSS = `
/* dsh-claude-style-addons —— 追加在皮肤「Claude Style」设置页末尾的那一块。
 * 行、开关、分段按钮全用皮肤自己的 class，这里只补「块」本身的排版和小标题。 */
body[data-dsh-claude-style] .dsh-csa-block {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
body[data-dsh-claude-style] .dsh-csa-heading {
  margin-top: 8px;
  padding-top: 16px;
  border-top: 1px solid var(--dsw-alias-border-l1);
}
body[data-dsh-claude-style] .dsh-csa-heading-title {
  font-size: 13px;
  font-weight: 600;
  line-height: 1.5;
  color: var(--dsw-alias-label-secondary);
}
body[data-dsh-claude-style] .dsh-csa-heading-desc {
  margin-top: 2px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-tertiary);
}
body[data-dsh-claude-style] .dsh-csa-block [hidden] {
  display: none !important;
}
body[data-dsh-claude-style] .dsh-csa-note {
  display: block;
  margin-top: 2px;
  color: var(--dsw-alias-label-secondary);
}
`

    /** 最近一次写入的结果（显示在块底部）。 */
    let lastWrite = 'saved'

    /** 建一个元素。 */
    function el(tag, className, text) {
      const node = document.createElement(tag)
      if (className) node.className = className
      if (text !== undefined) node.textContent = text
      return node
    }

    /** 内容不同才写，免得白白触发一次 DOM 变动（观察者会被自己唤醒）。 */
    function setText(node, text) {
      if (node.textContent !== text) node.textContent = text
    }

    /** 属性有无切换（同样只在变化时写）。 */
    function setFlag(node, name, on) {
      if (on && !node.hasAttribute(name)) node.setAttribute(name, '')
      else if (!on && node.hasAttribute(name)) node.removeAttribute(name)
    }

    /** 属性值切换（只在变化时写）。 */
    function setAttr(node, name, value) {
      if (node.getAttribute(name) !== value) node.setAttribute(name, value)
    }

    /** 点一下就写一处改动，结果更新到所有块上。 */
    let onWrite = () => {}
    function write(patch) {
      savePrefs(patch).then((result) => {
        lastWrite = result
        onWrite()
      })
    }

    /** 一个开关（皮肤的 .dsh-claude-settings-switch）。 */
    function makeSwitch(key) {
      const button = el('button', 'dsh-claude-settings-switch')
      button.type = 'button'
      button.setAttribute('role', 'switch')
      button.setAttribute('data-dsh-csa-switch', key)
      button.appendChild(el('span', 'dsh-claude-settings-switch-knob'))
      button.addEventListener('click', () => {
        const patch = {}
        patch[key] = !readPrefs()[key]
        write(patch)
      })
      return button
    }

    /** 一组分段按钮（皮肤的 .dsh-claude-segments / .dsh-claude-segment）。 */
    function makeSegments(key, options) {
      const group = el('div', 'dsh-claude-segments')
      group.setAttribute('role', 'group')
      group.setAttribute('data-dsh-csa-segments', key)
      for (const option of options) {
        const button = el('button', 'dsh-claude-segment', option.label)
        button.type = 'button'
        button.setAttribute('data-value', option.value)
        button.addEventListener('click', () => {
          if (readPrefs()[key] === option.value) return
          const patch = {}
          patch[key] = option.value
          write(patch)
        })
        group.appendChild(button)
      }
      return group
    }

    /** 一行（皮肤的 .dsh-claude-settings-row）：左边标题 + 说明（+ 一条可选的提示），右边控件。 */
    function makeRow(name, title, description, control) {
      const row = el('div', 'dsh-claude-settings-row')
      row.setAttribute('data-dsh-csa-row', name)
      const text = el('div', 'dsh-claude-settings-row-text')
      text.appendChild(el('div', 'dsh-claude-settings-row-title', title))
      const desc = el('div', 'dsh-claude-settings-row-desc', description)
      const note = el('span', 'dsh-csa-note')
      note.hidden = true
      note.setAttribute('data-dsh-csa-note', name)
      desc.appendChild(note)
      text.appendChild(desc)
      row.appendChild(text)
      row.appendChild(control)
      return row
    }

    /** 建整个块（只建一次；之后靠 updateBlock 改状态）。 */
    function buildBlock() {
      const block = el('div', 'dsh-csa-block')
      block.setAttribute(BLOCK_ATTR, '')
      const heading = el('div', 'dsh-csa-heading')
      heading.appendChild(el('div', 'dsh-csa-heading-title', COPY.heading))
      heading.appendChild(el('div', 'dsh-csa-heading-desc', COPY.headingDesc))
      block.appendChild(heading)
      block.appendChild(makeRow('greeting', COPY.greetingTitle, COPY.greetingDesc, makeSwitch('greeting')))
      block.appendChild(makeRow('greetingFont', COPY.fontTitle, COPY.fontDesc, makeSegments('greetingFont', FONT_CHOICES)))
      block.appendChild(makeRow('mascotVariant', COPY.mascotTitle, COPY.mascotDesc, makeSegments('mascotVariant', MASCOT_CHOICES)))
      block.appendChild(makeRow('keepBalanceCard', COPY.balanceTitle, COPY.balanceDesc, makeSwitch('keepBalanceCard')))
      block.appendChild(makeRow('deepseekInlineCode', COPY.codeTitle, COPY.codeDesc, makeSwitch('deepseekInlineCode')))
      const error = el('div', 'dsh-claude-settings-error')
      error.setAttribute('data-dsh-csa-error', '')
      error.hidden = true
      block.appendChild(error)
      updateBlock(block)
      return block
    }

    /** 把当前偏好、皮肤状态、写入结果画到一个块上（只写有变化的地方）。 */
    function updateBlock(block) {
      const p = readPrefs()
      const switches = block.querySelectorAll('[data-dsh-csa-switch]')
      for (let i = 0; i < switches.length; i++) {
        const on = p[switches[i].getAttribute('data-dsh-csa-switch')] === true
        setAttr(switches[i], 'aria-checked', on ? 'true' : 'false')
        setFlag(switches[i], 'data-on', on)
      }
      const groups = block.querySelectorAll('[data-dsh-csa-segments]')
      for (let i = 0; i < groups.length; i++) {
        const value = p[groups[i].getAttribute('data-dsh-csa-segments')]
        const buttons = groups[i].children
        for (let j = 0; j < buttons.length; j++) {
          const active = buttons[j].getAttribute('data-value') === value
          setFlag(buttons[j], 'data-active', active)
          setAttr(buttons[j], 'aria-pressed', active ? 'true' : 'false')
        }
      }
      const fontRow = block.querySelector('[data-dsh-csa-row="greetingFont"]')
      if (fontRow && fontRow.hidden !== !p.greeting) fontRow.hidden = !p.greeting

      const body = document.body
      const takeover = !!body && body.hasAttribute(FOOTER_ATTR)
      const brand = body ? body.getAttribute(BRAND_ATTR) : null
      const notes = {
        keepBalanceCard: takeover ? '' : COPY.balanceIdle,
        deepseekInlineCode: brand === null || brand === 'deepseek' ? '' : COPY.codeIdle,
        mascotVariant: brand !== null && brand !== 'deepseek' ? COPY.mascotIdle : p.mascotVariant === 'whale-maid' ? COPY.mascotPending : '',
      }
      const noteNodes = block.querySelectorAll('[data-dsh-csa-note]')
      for (let i = 0; i < noteNodes.length; i++) {
        const text = notes[noteNodes[i].getAttribute('data-dsh-csa-note')] || ''
        setText(noteNodes[i], text)
        if (noteNodes[i].hidden !== (text === '')) noteNodes[i].hidden = text === ''
      }

      const error = block.querySelector('[data-dsh-csa-error]')
      if (error) {
        const text = lastWrite === 'local' ? COPY.local : lastWrite === 'refused' ? COPY.refused : ''
        setText(error, text)
        if (error.hidden !== (text === '')) error.hidden = text === ''
      }
    }

    /**
     * 盯着页面：皮肤的设置页一出现就在它末尾追加本插件的块。
     *
     * 只观察 childList（设置页挂载 / 卸载）+ body 上两个皮肤属性（页脚接管、品牌，用来刷新提示）。
     * 每批变动合并成一次微任务 —— 早于浏览器绘制，所以设置页打开那一帧块就已经在了，不会「闪一下才出来」。
     * 找容器用 getElementsByClassName 的活集合，没打开设置页时每批变动只多一次 length 读取。
     * @returns {() => void} 卸载：断开观察、摘掉块和样式。
     */
    function installSettingsInjector() {
      if (typeof document === 'undefined' || !document.body) return () => {}
      if (typeof MutationObserver !== 'function') return () => {}

      const blocks = new Set()
      const roots = typeof document.getElementsByClassName === 'function'
        ? document.getElementsByClassName(SETTINGS_ROOT_CLASS)
        : null

      const ensureStyle = () => {
        if (!document.head) return
        const existing = document.querySelector(`style[data-plugin-css="${SETTINGS_STYLE_ID}"]`)
        if (existing) return
        const tag = document.createElement('style')
        tag.dataset.plugin = PACKAGE_NAME
        tag.dataset.pluginCss = SETTINGS_STYLE_ID
        tag.textContent = SETTINGS_CSS
        document.head.appendChild(tag)
      }

      const pass = () => {
        scheduled = false
        try {
          for (const block of Array.from(blocks)) {
            if (!block.isConnected) blocks.delete(block)
          }
          const list = roots !== null ? Array.from(roots) : Array.from(document.querySelectorAll('.' + SETTINGS_ROOT_CLASS))
          if (list.length === 0) return
          ensureStyle()
          // 设置页开着正是绑定设置表单的好时机（服务可能比本插件晚挂上）。
          if (prefsForm === null && bindingCtx !== null) bindPrefs(bindingCtx)
          for (const root of list) {
            let block = null
            const kids = root.children
            for (let i = 0; i < kids.length; i++) {
              if (kids[i].hasAttribute(BLOCK_ATTR)) {
                block = kids[i]
                break
              }
            }
            if (block === null) {
              block = buildBlock()
              root.appendChild(block)
            } else {
              // React 给它自己的列表添新行（比如出错提示）时是追加在容器末尾的，会排到本块后面；
              // 把本块挪回最后。挪的是自己的节点，React 的节点一个没碰，它下次照样按它的兄弟定位。
              if (root.lastElementChild !== block) root.appendChild(block)
              updateBlock(block)
            }
            blocks.add(block)
          }
        } catch (error) {
          if (typeof console !== 'undefined' && console.warn) console.warn('[dsh-claude-style-addons] 设置页这一轮没画完（下一轮会重来）：', error)
        }
      }

      let scheduled = false
      const schedule = () => {
        if (scheduled) return
        scheduled = true
        Promise.resolve().then(pass)
      }

      const refreshAll = () => {
        for (const block of blocks) {
          try {
            updateBlock(block)
          } catch (error) {
            // 下一轮再画。
          }
        }
      }
      onWrite = refreshAll

      const observer = new MutationObserver(schedule)
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [FOOTER_ATTR, BRAND_ATTR],
      })
      const prefsOff = subscribePrefs(refreshAll)
      pass()

      return () => {
        observer.disconnect()
        prefsOff()
        onWrite = () => {}
        for (const block of blocks) {
          if (block.parentNode) block.parentNode.removeChild(block)
        }
        blocks.clear()
        const tag = document.querySelector(`style[data-plugin-css="${SETTINGS_STYLE_ID}"]`)
        if (tag && tag.parentNode) tag.parentNode.removeChild(tag)
      }
    }

    // ══ 六、挂载 ═══════════════════════════════════════════════════════════

    /** 不需要任何服务注入：设置表单用 ctx.get 宽松地取（取不到就靠缓存）。 */
    exports.inject = []
    exports.name = PACKAGE_NAME

    /**
     * @param {any} ctx - 浏览器端插件上下文。
     */
    exports.apply = function apply(ctx) {
      ctx.effect(() => {
        bindingCtx = ctx
        bindPrefs(ctx)
        // 设置服务冷启动时可能还没挂上：过几秒各再试一次（设置页打开时、写之前也会再试）。
        const timers = [1000, 4000, 12000].map((delay) => setTimeout(() => {
          if (prefsForm === null && bindingCtx !== null) bindPrefs(bindingCtx)
        }, delay))
        return () => {
          for (const timer of timers) clearTimeout(timer)
          bindingCtx = null
          unbindPrefs()
        }
      }, 'dsh-claude-style-addons: 偏好')
      ctx.effect(() => startFeatures(), 'dsh-claude-style-addons: 功能开关')
      ctx.effect(() => installSettingsInjector(), 'dsh-claude-style-addons: Claude Style 设置页')
    }

    /** 两个部分各自原来的导出（verify/greeting.mjs、verify/skin-fixes.mjs 直接测它们）。 */
    exports.__parts = { greeting, skinFixes }

    /** 离线验证用的钩子。 */
    exports.__testing = {
      PACKAGE_NAME,
      ENTRY_ID,
      PREFS_DEFAULT,
      FONT_CHOICES,
      MASCOT_CHOICES,
      maid: { assets: MAID_ASSETS, resolveState: maidResolveState, sample: maidSample, hasRoom: maidHasRoom, createRuntime: createMaidRuntime },
      CACHE_KEY,
      SETTINGS_ROOT_CLASS,
      BLOCK_ATTR,
      SETTINGS_STYLE_ID,
      SETTINGS_CSS,
      COPY,
      greeting: greeting.__testing,
      skinFixes: skinFixes.__testing,
      normalizePrefs,
      readPrefs,
      subscribePrefs,
      adoptPrefs,
      savePrefs,
      bindPrefs,
      unbindPrefs,
      namespaceCandidates,
      servedNamespace,
      startFeatures,
      buildBlock,
      updateBlock,
      installSettingsInjector,
      state: () => ({ bound: prefsForm !== null, lastWrite }),
      setBindingCtx: (ctx) => { bindingCtx = ctx },
    }

    return module.exports
  },
})
