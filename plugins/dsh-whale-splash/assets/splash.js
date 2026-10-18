/* dsh-whale-splash —— 像素风开场（页面侧）。
   宿主插件以「注入行」交给 DSH：网页版渲染在 <body> 开头、页面一开始解析就跑；
   桌面版由页面拿到注入表后执行（紧跟在 #dwsp 节点那一行之后）。
   任何异常都直接把主界面放出来，绝不留白屏。

   一出戏，全部画在一张 canvas 上，按 24 帧/秒「一格一格」地走（8-bit 的顿挫感就是这么来的）：
     ① 拼 logo   DeepSeek 鲸鱼标被切成像素，一颗颗从上面掉下来拼好；下面像素字 deepseek 一个字母一个字母打出来
     ② 等加载    logo 原地 8-bit 蹦跶（压扁 → 起跳 → 落地再压扁），冒方块泡泡，四周闪十字星
     ③ 变身      主界面好了：logo 的像素炸开，飞回来重组成一只大号的「Clawd」——
                dsh-claude-style 现在摆在输入框上沿的那只 Claude 像素小螃蟹；像素字同时蒸发消散
     ④ 打招呼    大 Clawd 原地蹦两下、吐一串像素泡泡，同时底色碎成方块消失，主界面露出来（这时已经能点了）
     ⑤ 空翻      大 Clawd 起跳、在空中翻个跟头、一路缩小，正好落到输入框上沿真 Clawd 的位置，溅几颗像素水花，交班

   不卡顿：画面在 Web Worker 里用 OffscreenCanvas 画。DSH 启动时主线程要解析、执行一大堆插件包
   （光 dsh-claude-style 就 1 MB 多），画在主线程上会跟着它一起卡住；放进 Worker 就互不相干。
   主线程只做三件小事：读界面状态（好了没、真吉祥物在哪）、把它的帧图抠成一张表、按 Worker 的通知收尾。
   浏览器不支持 / Worker 起不来时，同一套引擎退回主线程照跑。

   帧图不另带：直接读 dsh-claude-style 画在页面上的那只真吉祥物（.dsh-claude-crab 螃蟹 / .dsh-claude-deepy 鲸鱼）。
   它把自己这一帧的帧图地址、格子尺寸和落点写在身上的 CSS 变量里，这里照着读，用同一张图放大画大号、
   再缩回原位交给它 —— 开屏那只和输入框上沿那只是同一只，风格天然一致。
   没装 dsh-claude-style（或它把吉祥物关了）时跳过 ③④：logo 自己跳到输入框右上角，碎成像素散掉。 */
(function () {
  'use strict'

  var doc = document
  var html = doc.documentElement
  var box = doc.getElementById('dwsp')
  if (!box) return
  if (!html.classList.contains('dwsp-boot')) return cleanup()

  var LOGO_PATH = '%LOGO_PATH%'

  var reduce = false
  try { reduce = matchMedia('(prefers-reduced-motion: reduce)').matches } catch (e) {}

  var cv = box.querySelector('.dwsp-cv')
  var veilDiv = box.querySelector('.dwsp-veil')
  var veilColor = (getComputedStyle(box).getPropertyValue('--dwsp-canvas') || '#f7f9ff').trim()
  var send = null       // 发消息给引擎
  var worker = null
  var finished = false
  var poll = 0

  var lastReady = false, readyMs = 0, lastTarget = ''
  var mascotKey = '', mascotSeq = 0, mascotKnown = false, mascotTried = false

  try {
    start()
  } catch (e) {
    return cleanup()
  }

  /* ── 起引擎：优先 Worker，起不来退回主线程 ─────────────── */

  function start() {
    if (!cv) throw new Error('no canvas')
    var size = sizeNow()
    sizeCanvas(cv, size)
    var init = { type: 'init', W: size.W, H: size.H, dpr: size.dpr, veil: veilColor, reduce: reduce, logoPath: LOGO_PATH }
    var offscreen = null
    try {
      if (typeof cv.transferControlToOffscreen === 'function' && typeof Worker === 'function' && typeof OffscreenCanvas === 'function') {
        var url = URL.createObjectURL(new Blob(['(' + ENGINE.toString() + ')(self)'], { type: 'text/javascript' }))
        worker = new Worker(url)
        offscreen = cv.transferControlToOffscreen()
        var alive = false
        worker.onmessage = function (event) {
          if (event.data && event.data.type === 'alive') alive = true
          onEngine(event.data)
        }
        worker.onerror = function () { if (!alive) fallbackToMain() }
        init.canvas = offscreen
        worker.postMessage(init, [offscreen])
        send = function (msg, transfer) { worker.postMessage(msg, transfer || []) }
        // 2 秒内 Worker 没报到（被安全策略拦了 / 起不来）就换主线程。正常情况下它几十毫秒就报到了
        setTimeout(function () { if (!alive && !finished) fallbackToMain() }, 2000)
      } else {
        runOnMain(init)
      }
    } catch (e) {
      fallbackToMain()
    }
    box.addEventListener('pointerdown', skip)
    addEventListener('keydown', skip, true)
    addEventListener('resize', onResize)
    poll = setInterval(watch, 90)
    watch()

    function fallbackToMain() {
      if (finished || (worker && worker.__dropped)) return
      if (worker) { worker.__dropped = true; try { worker.terminate() } catch (e) {} }
      // 已经交给 Worker 的 canvas 不能再在主线程画了：换一张新的
      var fresh = doc.createElement('canvas')
      fresh.className = 'dwsp-cv'
      if (cv && cv.parentNode) cv.parentNode.replaceChild(fresh, cv)
      cv = fresh
      var s = sizeNow()
      sizeCanvas(cv, s)
      init.canvas = undefined
      init.W = s.W; init.H = s.H; init.dpr = s.dpr
      runOnMain(init)
      // 新引擎不知道刚才发生过什么：界面状态、吉祥物都重新报一遍
      lastReady = false
      lastTarget = ''
      mascotTried = false
      mascotKnown = false
      mascotKey = ''
    }
  }

  function runOnMain(init) {
    var port = { onmessage: null, postMessage: function (msg) { onEngine(msg) } }
    ENGINE(port)
    send = function (msg) { if (port.onmessage) port.onmessage({ data: msg }) }
    init.canvas = cv
    send(init)
  }

  function sizeNow() {
    return { W: innerWidth, H: innerHeight, dpr: Math.min(2, window.devicePixelRatio || 1) }
  }
  function sizeCanvas(canvas, s) {
    canvas.style.width = s.W + 'px'
    canvas.style.height = s.H + 'px'
  }
  function onResize() {
    var s = sizeNow()
    sizeCanvas(cv, s)
    if (send) send({ type: 'size', W: s.W, H: s.H, dpr: s.dpr })
  }

  /* ── 吉祥物：从页面上的真吉祥物读「这一帧长什么样、站在哪」 ──
     dsh-claude-style 把它画在 .dsh-claude-crab（Claude 的小螃蟹 Clawd）/ .dsh-claude-deepy（Deepy）里，
     用一堆 CSS 变量交代：帧图地址、格子尺寸、这一帧在 52×N 格子里的位置。这里原样读出来，
     用同一张图做开场的大号，最后再缩回同一个格子上。 */

  function readMascot() {
    var el = firstReady('.dsh-claude-crab[data-ready]') || firstReady('.dsh-claude-deepy[data-ready]')
    if (!el) return null
    var crab = el.classList.contains('dsh-claude-crab')
    var pre = crab ? '--dsh-claude-crab-' : '--dsh-claude-deepy-'
    var cs = getComputedStyle(el)
    var boxv = [numOf(cs, pre + 'x'), numOf(cs, pre + 'y'), numOf(cs, pre + 'w'), numOf(cs, '--dsh-claude-mascot-h')]
    var cellW = numOf(cs, pre + 'cell-w')
    var stripH = numOf(cs, pre + 'strip-h')
    var sheet = cssUrl(cs.getPropertyValue(pre + 'sheet'))
    if (boxv.indexOf(null) >= 0 || cellW === null || stripH === null || !sheet) return null
    var r = el.getBoundingClientRect()
    return {
      kind: crab ? 'crab' : 'deepy',
      left: r.left, top: r.top, width: r.width, height: r.height,
      box: boxv, cellW: cellW, stripH: stripH, sheet: sheet,
      ink: crab ? cssUrl(cs.getPropertyValue('--dsh-claude-crab-ink')) : '',
      inkColor: crab ? colorValue((cs.getPropertyValue('--dsw-alias-label-tertiary') || '').trim()) : '',
    }
  }

  function firstReady(sel) {
    var list = doc.querySelectorAll(sel)
    for (var i = 0; i < list.length; i++) {
      var r = list[i].getBoundingClientRect()
      if (r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight) return list[i]
    }
    return null
  }

  function colorValue(v) {
    return /^(#|rgb|hsl|color\()/i.test(v) ? v : '#8f8a7e'
  }

  function numOf(cs, name) {
    var n = parseFloat((cs.getPropertyValue(name) || '').trim())
    return isFinite(n) ? n : null
  }

  function cssUrl(value) {
    if (!value) return ''
    var m = /url\(\s*['"]?([^'")]+)['"]?\s*\)/i.exec(value)
    return m ? m[1] : ''
  }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image()
      img.onload = function () {
        if (img.decode) img.decode().then(function () { resolve(img) }, function () { resolve(img) })
        else resolve(img)
      }
      img.onerror = function () { reject(new Error('mascot sheet failed: ' + src.slice(0, 64))) }
      img.src = src
    })
  }

  /** 把吉祥物的帧表抠成「只有身体」的一张规整帧表（8 帧一行），交给引擎放大画。 */
  function prepareMascot(m) {
    return Promise.all([loadImage(m.sheet), m.ink ? loadImage(m.ink).catch(function () { return null }) : Promise.resolve(null)])
      .then(function (res) {
        var img = res[0], ink = res[1]
        var gutter = Math.max(0, (m.cellW - m.box[2]) / 2)   // 帧图里身体外面留的空格（鲸鱼是 1 格，螃蟹没有）
        var cellH = m.box[3] + gutter * 2
        var rows = Math.max(1, Math.round(m.stripH / cellH))
        var fw = img.naturalWidth / 8                         // 帧图一格有多少像素
        var fh = img.naturalHeight / rows
        var scale = fw / m.cellW                              // 帧图一块像素 = 屏幕上的几块
        var artW = Math.max(1, Math.round(m.box[2] * scale))
        var artH = Math.max(1, Math.round(m.box[3] * scale))
        var canvas = doc.createElement('canvas')
        canvas.width = artW * 8
        canvas.height = artH * rows
        var c = canvas.getContext('2d')
        c.imageSmoothingEnabled = false
        for (var i = 0; i < rows * 8; i++) {
          var col = i % 8, row = Math.floor(i / 8)
          c.drawImage(img, col * fw + gutter * scale, row * fh + gutter * scale, artW, artH, col * artW, row * artH, artW, artH)
        }
        // 螃蟹还有一层「墨」：帧图上另有几张只含轮廓/眼睛的遮罩，按主题文字色铺上去。
        // 没有墨（透明）的帧不用管，画了也看不见。
        if (ink) {
          var mask = doc.createElement('canvas')
          mask.width = canvas.width
          mask.height = canvas.height
          var mc = mask.getContext('2d')
          mc.imageSmoothingEnabled = false
          for (var j = 0; j < rows * 8; j++) {
            var col2 = j % 8, row2 = Math.floor(j / 8)
            mc.drawImage(ink, col2 * fw + gutter * scale, row2 * fh + gutter * scale, artW, artH, col2 * artW, row2 * artH, artW, artH)
          }
          mc.globalCompositeOperation = 'source-in'
          mc.fillStyle = m.inkColor || '#8f8a7e'
          mc.fillRect(0, 0, mask.width, mask.height)
          c.drawImage(mask, 0, 0)
        }
        var made = typeof createImageBitmap === 'function' ? createImageBitmap(canvas) : Promise.resolve(canvas)
        return made.then(function (bmp) {
          return { kind: m.kind, box: m.box, artW: artW, artH: artH, frames: rows * 8, bitmap: bmp }
        })
      })
  }

  function primeMascot(m) {
    var key = [m.kind, m.sheet, m.box.join(','), m.cellW, m.stripH, m.ink].join('|')
    if (key === mascotKey) return
    mascotKey = key
    var seq = ++mascotSeq
    prepareMascot(m).then(function (spec) {
      if (seq !== mascotSeq || finished) return
      mascotKnown = true
      send({ type: 'mascot', spec: { kind: spec.kind, box: spec.box, artW: spec.artW, artH: spec.artH, frames: spec.frames }, bitmap: spec.bitmap })
    }, function () {
      if (seq !== mascotSeq || finished) return
      mascotKnown = true
      send({ type: 'mascot', bitmap: null })
    })
  }

  /* ── 主线程只读界面状态，变了才通知引擎 ───────────────── */

  function watch() {
    if (finished || !send) return
    var m = readMascot()
    if (!lastReady && uiReady(m)) { lastReady = true; readyMs = Date.now(); send({ type: 'ready' }) }
    var t = m ? { x: m.left, y: m.top, cell: m.width / 52, mascot: true } : null
    var fb = fallbackTarget()
    var key = JSON.stringify([t, fb])
    if (key !== lastTarget) { lastTarget = key; send({ type: 'target', target: t, fallback: fb }) }
    // 只认第一次读到的那只吉祥物：开场演到一半它自己换动作（换帧图、换格子）也不跟着变
    if (m && !mascotTried) { mascotTried = true; primeMascot(m) }
    else if (lastReady && !mascotTried && !mascotKnown && Date.now() - readyMs > 2000) {
      // 页面上已经有吉祥物的节点、只是还没 data-ready：再等等它（引擎那边到 MAX_MS 也会自己开演）
      if (!doc.querySelector('.dsh-claude-crab, .dsh-claude-deepy')) {
        mascotKnown = true
        send({ type: 'mascot', bitmap: null })
      }
    }
  }

  function uiReady(m) {
    return !!m || !!doc.querySelector('#root textarea, #root [contenteditable="true"]')
  }

  /** 没有吉祥物：输入框右上角，再不行就视口右下角（同样折算成 52 格、一格 2px 的网格原点）。 */
  function fallbackTarget() {
    var input = doc.querySelector('#root textarea, #root [contenteditable="true"]')
    var r = input && input.getBoundingClientRect()
    var x = r && r.width > 0 ? r.right - 50 : innerWidth - 90
    var y = r && r.width > 0 ? r.top - 10 : innerHeight - 120
    return { x: Math.round(x - 60), y: Math.round(y - 98), cell: 2, mascot: false }
  }

  function skip(event) {
    if (event && event.type === 'keydown') event.stopPropagation()
    if (send) send({ type: 'skip' })
  }

  /* ── 引擎的通知 ───────────────────────────────────────── */

  function onEngine(msg) {
    if (!msg || finished) return
    if (msg.type === 'drawn' && veilDiv) { if (veilDiv.parentNode) veilDiv.parentNode.removeChild(veilDiv); veilDiv = null }
    else if (msg.type === 'release') box.style.pointerEvents = 'none'
    else if (msg.type === 'land') html.classList.remove('dwsp-hold')
    else if (msg.type === 'done') cleanup()
    else if (msg.type === 'quiet') {
      html.classList.remove('dwsp-hold')
      box.style.transition = 'opacity .4s ease'
      box.style.opacity = '0'
      box.style.pointerEvents = 'none'
      setTimeout(cleanup, 420)
    } else if (msg.type === 'error') cleanup()
  }

  function cleanup() {
    finished = true
    clearInterval(poll)
    removeEventListener('keydown', skip, true)
    removeEventListener('resize', onResize)
    if (worker) { try { worker.terminate() } catch (e) {} }
    html.classList.remove('dwsp-boot', 'dwsp-hold')
    if (box && box.parentNode) box.parentNode.removeChild(box)
    var styles = doc.querySelectorAll('style')
    for (var i = 0; i < styles.length; i++) {
      if (styles[i].textContent.indexOf('/* dsh-whale-splash') === 0) styles[i].parentNode.removeChild(styles[i])
    }
  }

  /* ════════════════════════════════════════════════════════════════════
     引擎：既能放进 Worker（scope = self），也能在主线程跑（scope = 一个假 port）。
     只认消息、只画 canvas，不碰 DOM。所以这里面不能引用外层的任何变量。
     ════════════════════════════════════════════════════════════════════ */
  function ENGINE(scope) {
    /* ── 节奏（毫秒） ─────────────────────────────────────── */
    var TICK = 1000 / 24        // 画面每格时长：24 帧/秒，整格整格地跳
    var ASSEMBLE_MS = 820       // ① 拼 logo
    var TYPE_AT = 520           // ① 像素字从这时开始打
    var TYPE_STEP = 75          // ① 每个字母间隔
    var MIN_MS = 1500           // 最短：logo 拼完、字打完、再蹦一下
    var MAX_MS = 3600           // 主界面迟迟不好也最多等这么久
    var HOP_MS = 820            // ② 一次蹦跶
    var MORPH_MS = 680          // ③ 炸开重组（像素字同时蒸发）
    var CHEER_MS = 900          // ④ 大 Clawd 蹦跶 + 吐泡泡
    var DISSOLVE_MS = 520       // ④ 底色碎掉
    var JUMP_MS = 820           // ⑤ 空翻
    var LAND_MS = 420           // 落地水花
    var LIFT = 140              // 起跳高度（px）
    var CELL = 8                // 大号吉祥物一个像素 = 8px
    var LOGO_N = 28             // logo 切成 28×28 格
    var TEXT_CELL = 5           // 像素字一个像素 = 5px
    var TEXT_GAP = 30           // logo 与字之间的空隙
    var BLOCK = 28              // 底色碎块边长

    /* 像素字 deepseek：5 列 × 9 行（2 行上伸、5 行主体、2 行下伸），# 是笔画 */
    var GLYPHS = {
      d: ['....#', '....#', '.####', '#...#', '#...#', '#...#', '.####', '.....', '.....'],
      e: ['.....', '.....', '.###.', '#...#', '#####', '#....', '.###.', '.....', '.....'],
      p: ['.....', '.....', '####.', '#...#', '#...#', '#...#', '####.', '#....', '#....'],
      s: ['.....', '.....', '.####', '#....', '.###.', '....#', '####.', '.....', '.....'],
      k: ['#....', '#....', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '.....', '.....'],
    }
    var WORD = 'deepseek'

    var BLUE = '#4e6fff', NAVY = '#142660', FOAM = '#bee1ff', WHITE = '#ffffff'

    var canvas = null, ctx = null
    var W = 0, H = 0, dpr = 1
    var veilColor = '#f7f9ff'
    var reduce = false
    var logo = [], word = [], wordW = 0, wordH = 0
    var mascot = null, mascotKnown = false, mascotCells = null
    var clock = 0, speed = 1, lastReal = 0, lastTick = -1
    var phase = 'assemble', phaseAt = 0
    var readyAt = 0
    var target = null, fallback = null
    var bubbles = [], sparks = [], shards = [], particles = [], vapor = [], trail = [], fizz = []
    var blocks = null
    var landedTarget = null
    var running = false, stopped = false
    var raf = typeof scope.requestAnimationFrame === 'function'
      ? function (fn) { return scope.requestAnimationFrame(fn) }
      : function (fn) { return setTimeout(function () { fn(now()) }, 16) }

    scope.onmessage = function (event) {
      var msg = event.data
      try {
        if (msg.type === 'init') init(msg)
        else if (msg.type === 'size') resize(msg.W, msg.H, msg.dpr)
        else if (msg.type === 'mascot') takeMascot(msg)
        else if (msg.type === 'ready') { if (!readyAt) readyAt = Math.max(clock, 1) }
        else if (msg.type === 'target') { target = msg.target; fallback = msg.fallback }
        else if (msg.type === 'skip') { speed = 2.6; if (!readyAt) readyAt = Math.max(clock, 1) }
      } catch (e) {
        scope.postMessage({ type: 'error', message: String(e && e.message || e) })
      }
    }

    function now() { return typeof performance !== 'undefined' ? performance.now() : Date.now() }

    function init(msg) {
      canvas = msg.canvas
      ctx = canvas.getContext('2d')
      veilColor = msg.veil || veilColor
      reduce = !!msg.reduce
      resize(msg.W, msg.H, msg.dpr)
      logo = logoCells(LOGO_N, msg.logoPath)
      word = wordCells()
      if (reduce) phase = 'wait'
      scope.postMessage({ type: 'alive' })
      lastReal = now()
      running = true
      raf(frame)
    }

    function resize(w, h, d) {
      W = w; H = h; dpr = d || 1
      if (!canvas) return
      canvas.width = Math.round(W * dpr)
      canvas.height = Math.round(H * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.imageSmoothingEnabled = false
      blocks = null
    }

    function makeCanvas(w, h) {
      if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(w, h)
      var c = document.createElement('canvas')
      c.width = w; c.height = h
      return c
    }

    /** 主线程把真吉祥物的帧表抠好送过来：接住，顺手读出这一帧的像素色块，给 ③ 的重组当落点。 */
    function takeMascot(msg) {
      mascotKnown = true
      if (!msg || !msg.bitmap || !msg.spec) { mascot = null; mascotCells = null; return }
      mascot = {
        bitmap: msg.bitmap,
        box: msg.spec.box,
        artW: msg.spec.artW,
        artH: msg.spec.artH,
        frames: msg.spec.frames,
      }
      mascotCells = mascotPixels()
    }

    /** 一帧的身体拆成「格子坐标 + 颜色」。 */
    function mascotPixels() {
      if (!mascot) return []
      var b = mascot.box
      var aw = mascot.artW, ah = mascot.artH
      var oc = makeCanvas(aw, ah)
      var o = oc.getContext('2d')
      o.imageSmoothingEnabled = false
      o.drawImage(mascot.bitmap, 0, 0, aw, ah, 0, 0, aw, ah)
      var d = o.getImageData(0, 0, aw, ah).data
      var sx = aw / b[2], sy = ah / b[3]
      var out = []
      for (var y = 0; y < b[3]; y++) {
        for (var x = 0; x < b[2]; x++) {
          var px = Math.min(aw - 1, Math.floor(x * sx) + Math.floor(sx / 2))
          var py = Math.min(ah - 1, Math.floor(y * sy) + Math.floor(sy / 2))
          var k = (py * aw + px) * 4
          if (d[k + 3] < 128) continue
          var r = d[k], g = d[k + 1], bb = d[k + 2]
          // 影子（灰）不参与重组，落地后由真帧图画出来
          if (Math.abs(r - g) < 14 && Math.abs(g - bb) < 22 && r > 150 && r < 235) continue
          out.push({ x: b[0] + x, y: b[1] + y, c: 'rgb(' + r + ',' + g + ',' + bb + ')' })
        }
      }
      return out
    }

    /** 把鲸鱼标栅格化成 n×n 格，再按像素画的规矩上色：实心涂蓝，紧贴实心的一圈涂深蓝当描边，
        被围在里面的空洞（肚皮那块）涂白 —— 小空洞整块变深蓝，正好是眼睛。 */
    function logoCells(n, path) {
      var oc = makeCanvas(n, n)
      var o = oc.getContext('2d')
      o.scale(n / 50, n / 50)
      o.fill(new Path2D(path))
      var d = o.getImageData(0, 0, n, n).data
      var out = outlined(function (x, y) { return x >= 0 && y >= 0 && x < n && y < n && d[(y * n + x) * 4 + 3] > 110 }, n, n, true, false)
      // 给每颗像素一个下落的起点和延迟（①），按列从左到右、略带随机
      for (var i = 0; i < out.length; i++) {
        var p = out[i]
        p.drop = 180 + Math.random() * 320
        p.delay = (p.x + 1) / (n + 2) * 0.45 + Math.random() * 0.18
      }
      return out
    }

    /** 像素字：把字母拼成一张小网格，同样描一圈深蓝。每颗像素记下它属于第几个字母。 */
    function wordCells() {
      // 每个字母 5 列的字形向右叠一列做「加粗」（像素字体的老办法），占 6 列，字距 2 列
      var cols = WORD.length * 6 + (WORD.length - 1) * 2
      var rows = 9
      var grid = {}
      for (var i = 0; i < WORD.length; i++) {
        var g = GLYPHS[WORD[i]]
        for (var y = 0; y < rows; y++) {
          for (var x = 0; x < 5; x++) {
            if (g[y][x] !== '#') continue
            grid[(i * 8 + x) + ',' + y] = true
            grid[(i * 8 + x + 1) + ',' + y] = true
          }
        }
      }
      // 蓝字 + 右下一格深蓝投影：像素游戏标题的画法，比整圈描边清爽
      var cells = []
      for (var key in grid) {
        var xy = key.split(','), gx = +xy[0], gy = +xy[1]
        cells.push({ x: gx, y: gy, c: BLUE })
        if (!grid[(gx + 1) + ',' + (gy + 1)] && !grid['s' + (gx + 1) + ',' + (gy + 1)]) {
          grid['s' + (gx + 1) + ',' + (gy + 1)] = true
          cells.unshift({ x: gx + 1, y: gy + 1, c: NAVY }) // 投影先画，压在字下面
        }
      }
      wordW = (cols + 1) * TEXT_CELL
      wordH = (rows + 1) * TEXT_CELL
      for (var k = 0; k < cells.length; k++) {
        var c = cells[k]
        c.letter = Math.max(0, Math.min(WORD.length - 1, Math.floor(c.x / 8)))
        c.vx = (Math.random() * 2 - 1) * 26
        c.vy = -(30 + Math.random() * 70)
        c.delay = c.x / (cols + 1) * 0.45 + Math.random() * 0.12
      }
      return cells
    }

    /** 实心涂蓝、外描深蓝；holes 为真时被围住的空洞涂白；diag 为真时斜角也描（字更圆润、更粗）。 */
    function outlined(on, w, h, holes, diag) {
      var outside = {}
      if (holes) {
        var stack = [[-1, -1]]
        while (stack.length) {
          var q = stack.pop(), qx = q[0], qy = q[1], key = qx + ',' + qy
          if (qx < -1 || qy < -1 || qx > w || qy > h || outside[key] || on(qx, qy)) continue
          outside[key] = true
          stack.push([qx + 1, qy], [qx - 1, qy], [qx, qy + 1], [qx, qy - 1])
        }
      }
      var out = []
      for (var y = -1; y <= h; y++) {
        for (var x = -1; x <= w; x++) {
          if (on(x, y)) out.push({ x: x, y: y, c: BLUE })
          else if (on(x - 1, y) || on(x + 1, y) || on(x, y - 1) || on(x, y + 1) || (diag && (on(x - 1, y - 1) || on(x + 1, y - 1) || on(x - 1, y + 1) || on(x + 1, y + 1)))) out.push({ x: x, y: y, c: NAVY })
          else if (holes && !outside[x + ',' + y]) out.push({ x: x, y: y, c: WHITE })
        }
      }
      return out
    }

    /* ── 主循环 ─────────────────────────────────────────── */

    function frame() {
      if (stopped) return
      try {
        var t = now()
        // 偶尔掉帧时最多补 100ms，不让画面一下子跳一大截
        clock += Math.min(100, t - lastReal) * speed
        lastReal = t
        var tick = Math.floor(clock / TICK)
        if (tick !== lastTick) {
          lastTick = tick
          step(tick * TICK)
          drawShards()
          drawFizz()
        }
      } catch (e) {
        stopped = true
        scope.postMessage({ type: 'error', message: String(e && e.message || e) })
        return
      }
      raf(frame)
    }

    function go(next, t) { phase = next; phaseAt = t }
    function finish(type) { stopped = true; scope.postMessage({ type: type }) }

    var firstDraw = true
    function step(t) {
      if (!readyAt && t >= MAX_MS) readyAt = t
      var cx = W / 2
      var cy = H * 0.45 - (TEXT_GAP + wordH) / 2 // logo 与字作为一组居中
      ctx.clearRect(0, 0, W, H)

      if (phase === 'assemble' || phase === 'wait') {
        drawVeil(0)
        if (firstDraw) { firstDraw = false; scope.postMessage({ type: 'drawn' }) }
        var local = t - phaseAt
        drawWord(cx, cy, t, 0)
        if (phase === 'assemble') {
          drawAssemble(cx, cy, Math.min(1, local / ASSEMBLE_MS))
          if (local >= ASSEMBLE_MS) go('wait', t)
        } else {
          var hop = reduce ? { dy: 0, sx: 1, sy: 1 } : hopState((local % HOP_MS) / HOP_MS)
          drawLogo(cx, cy + hop.dy, CELL, hop.sx, hop.sy)
          if (!reduce) { tickBubbles(cx, cy, t); tickSparks(cx, cy, t) }
          // 主界面好了、而且至少蹦完一下，就在蹦跶落地的那一格出发；吉祥物帧表还没回音就再等等（最多到 MAX_MS）
          var atRest = reduce || (local % HOP_MS) / HOP_MS > 0.9
          var settled = mascotKnown || t >= MAX_MS
          if (readyAt && (t >= MIN_MS || speed > 1) && (atRest || speed > 1) && settled) {
            if (reduce) return finish('quiet')
            startVapor()
            if (mascot) startMorph(cx, cy, t)
            else go('dissolve', t)
          }
        }
        return
      }

      if (phase === 'morph') {
        var m = Math.min(1, (t - phaseAt) / MORPH_MS)
        drawVeil(0)
        drawVapor(cx, cy, m)
        drawParticles(m)
        if (m >= 1) go('cheer', t)
        return
      }

      if (phase === 'cheer') {
        var s = t - phaseAt
        var dis = Math.min(1, s / DISSOLVE_MS)
        if (dis > 0 && !released) release()
        drawVeil(dis)
        var g = bigGrid(cx, cy)
        var lift = Math.round(Math.max(0, Math.sin(s / 150)) * 2) * CELL
        var idx = Math.floor(s / 90) % mascot.frames
        drawMascot(idx, g.x, g.y - lift, CELL, 1)
        if (Math.floor(s / 110) % 2 === 0) puff(g)
        if (s >= CHEER_MS) {
          landedTarget = target || fallback || { x: W - 160, y: H - 220, cell: 2, mascot: false }
          trail = []
          go('jump', t)
        }
        return
      }

      if (phase === 'jump') {
        var j = Math.min(1, (t - phaseAt) / JUMP_MS)
        if (j > 0.6 && target) landedTarget = target // 真吉祥物在最后挪了窝也跟上
        var from = bigGrid(cx, cy)
        var st = jumpState(from, landedTarget, j)
        // 拖影：前几格的位置淡淡地留一下
        for (var i = 0; i < trail.length; i++) drawMascot(trail[i].index, trail[i].x, trail[i].y, trail[i].c, 0.1 + i * 0.07, trail[i].rot)
        var index = Math.floor(t / 90) % mascot.frames
        var rot = j * Math.PI * 2 // 翻个跟头（落回 2π，正好正过来）
        drawMascot(index, st.x, st.y, st.c, 1, rot)
        trail.push({ index: index, x: st.x, y: st.y, c: st.c, rot: rot })
        if (trail.length > 3) trail.shift()
        if (j >= 1) land(t)
        return
      }

      if (phase === 'dissolve') { // 没有真吉祥物：logo 再蹦一下、字蒸发，同时底色碎掉
        var q = t - phaseAt
        var dq = Math.min(1, q / DISSOLVE_MS)
        if (!released) release()
        drawVeil(dq)
        drawVapor(cx, cy, Math.min(1, q / MORPH_MS))
        var h2 = hopState(Math.min(1, q / HOP_MS))
        drawLogo(cx, cy + h2.dy, CELL, h2.sx, h2.sy)
        if (q >= Math.max(DISSOLVE_MS, HOP_MS * 0.9, MORPH_MS)) {
          landedTarget = target || fallback || { x: W - 160, y: H - 220, cell: 2, mascot: false }
          go('logojump', t)
        }
        return
      }

      if (phase === 'logojump') {
        var lj = Math.min(1, (t - phaseAt) / JUMP_MS)
        var e = ease(lj)
        var lc = CELL + (landedTarget.cell * 1.4 - CELL) * e
        var tx = landedTarget.x + 30 * landedTarget.cell
        var ty = landedTarget.y + 38 * landedTarget.cell
        var px = cx + (tx - cx) * e
        var py = cy + (ty - cy) * lj - LIFT * 4 * lj * (1 - lj)
        drawLogo(px, py, lc, 1, 1)
        if (lj >= 1) {
          burst(px, py, 18)
          land(t)
        }
        return
      }

      if (phase === 'land') {
        var l = (t - phaseAt) / LAND_MS
        // 交班前那一格：和真吉祥物同一张图、同一个落点，交班看不出接缝
        if (mascot && landedTarget.mascot && l < 0.12) drawMascot(0, landedTarget.x, landedTarget.y, landedTarget.cell, 1)
        if (l >= 1) finish('done')
      }
    }

    var released = false
    function release() { released = true; scope.postMessage({ type: 'release' }) }

    /* ── ① 拼 logo ──────────────────────────────────────── */

    function drawAssemble(cx, cy, p) {
      var c = CELL
      var ox = snap(cx - (LOGO_N * c) / 2), oy = snap(cy - (LOGO_N * c) / 2)
      for (var i = 0; i < logo.length; i++) {
        var q = logo[i]
        var local = Math.max(0, Math.min(1, (p - q.delay) / 0.4))
        if (local <= 0) continue
        // 自由落体落到位，再弹起一格落回
        var fall = local < 0.75 ? 1 - Math.pow(local / 0.75, 2) : 0
        var bounce = local >= 0.75 && local < 0.92 ? 1 : 0
        var y = oy + q.y * c - fall * q.drop - bounce * c
        ctx.fillStyle = q.c
        ctx.fillRect(ox + q.x * c, snap(y), c, c)
      }
    }

    /* ── ① 像素字：一个字母一个字母打出来，带一个闪烁的方块光标 ── */

    function wordOrigin(cx, cy) {
      return { x: snap(cx - wordW / 2), y: snap(cy + (LOGO_N * CELL) / 2 + TEXT_GAP) }
    }

    function drawWord(cx, cy, t) {
      var typed = reduce ? WORD.length : Math.floor((t - TYPE_AT) / TYPE_STEP) + 1 // 已经出现的字母数
      if (typed <= 0) return
      var o = wordOrigin(cx, cy)
      for (var i = 0; i < word.length; i++) {
        var c = word[i]
        if (c.letter >= typed) continue
        // 刚出现的那个字母先往上顶一格，下一格落回
        var fresh = !reduce && c.letter === typed - 1 && (t - TYPE_AT) % TYPE_STEP < TYPE_STEP / 2
        ctx.fillStyle = c.c
        ctx.fillRect(o.x + c.x * TEXT_CELL, o.y + (c.y - (fresh ? 1 : 0)) * TEXT_CELL, TEXT_CELL, TEXT_CELL)
      }
      // 方块光标：打字时跟在最后一个字母后面，打完再闪几下就收起
      var doneAt = TYPE_AT + WORD.length * TYPE_STEP
      if (!reduce && t < doneAt + 900 && Math.floor(t / 260) % 2 === 0) {
        var col = Math.min(typed, WORD.length) * 8
        ctx.fillStyle = BLUE
        ctx.fillRect(o.x + col * TEXT_CELL, o.y + 2 * TEXT_CELL, TEXT_CELL * 2, TEXT_CELL * 5)
      }
    }

    /* ── ③ 像素字蒸发：从左到右，一颗颗往上飘、变小、变淡 ── */

    function startVapor() { vapor = word }

    function drawVapor(cx, cy, m) {
      if (!vapor.length) return
      var o = wordOrigin(cx, cy)
      for (var i = 0; i < vapor.length; i++) {
        var c = vapor[i]
        var u = Math.max(0, Math.min(1, (m - c.delay) / 0.5))
        if (u >= 1) continue
        var x = o.x + c.x * TEXT_CELL + c.vx * u
        var y = o.y + c.y * TEXT_CELL + c.vy * u * (0.6 + u * 0.4)
        var size = u === 0 ? TEXT_CELL : u < 0.35 ? 4 : u < 0.7 ? 3 : 2
        ctx.globalAlpha = u === 0 ? 1 : Math.max(0, 1 - u * 1.1)
        ctx.fillStyle = u > 0.25 && c.c === NAVY ? BLUE : u > 0.55 ? FOAM : c.c
        ctx.fillRect(snap(x), snap(y), size, size)
      }
      ctx.globalAlpha = 1
    }

    /* ── ② 等加载：蹦跶 / 泡泡 / 十字星 ──────────────────── */

    /** 一次蹦跶在 0~1 时间里的样子：纵向位移（整格）与压扁拉伸。 */
    function hopState(u) {
      if (u < 0.14) return { dy: 0, sx: 1.12, sy: 0.82 }                    // 蓄力压扁
      if (u < 0.5) { var a = (u - 0.14) / 0.36; return { dy: -Math.round((1 - Math.pow(1 - a, 2)) * 5) * CELL, sx: 0.92, sy: 1.1 } } // 上升拉长
      if (u < 0.78) { var b = (u - 0.5) / 0.28; return { dy: -Math.round((1 - b * b) * 5) * CELL, sx: 1, sy: 1 } }               // 下落
      if (u < 0.88) return { dy: 0, sx: 1.16, sy: 0.78 }                    // 落地压扁
      return { dy: 0, sx: 1, sy: 1 }
    }

    /** 以底边中点为锚画 logo，sx/sy 是压扁拉伸。 */
    function drawLogo(cx, cy, c, sx, sy) {
      var cw = c * sx, ch = c * sy
      var baseY = cy + (LOGO_N * c) / 2
      var ox = cx - (LOGO_N * cw) / 2
      for (var i = 0; i < logo.length; i++) {
        var q = logo[i]
        // 两边都取整到同一套格线上，缩放到非整数格时也不会露出缝
        var x0 = Math.round(ox + q.x * cw), x1 = Math.round(ox + (q.x + 1) * cw)
        var y0 = Math.round(baseY - (LOGO_N - q.y) * ch), y1 = Math.round(baseY - (LOGO_N - q.y - 1) * ch)
        ctx.fillStyle = q.c
        ctx.fillRect(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0))
      }
    }

    function tickBubbles(cx, cy, t) {
      if (Math.random() < 0.16 && bubbles.length < 7) {
        bubbles.push({ x: cx + (Math.random() * 2 - 1) * LOGO_N * CELL * 0.45, y: cy - LOGO_N * CELL * 0.62, born: t, life: 900 + Math.random() * 700, size: Math.random() < 0.4 ? 2 : 1, wob: Math.random() * 6 })
      }
      for (var i = bubbles.length - 1; i >= 0; i--) {
        var b = bubbles[i]
        var u = (t - b.born) / b.life
        if (u >= 1) {
          burst(b.x, b.y - 150, 4)
          bubbles.splice(i, 1)
          continue
        }
        var s = b.size * 6
        var x = snap(b.x + Math.round(Math.sin(u * 9 + b.wob)) * 4)
        var y = snap(b.y - u * 150)
        ctx.fillStyle = NAVY
        ctx.fillRect(x - 2, y - 2, s + 4, s + 4)
        ctx.fillStyle = FOAM
        ctx.fillRect(x, y, s, s)
        ctx.fillStyle = WHITE
        ctx.fillRect(x, y, 2, 2)
      }
    }

    function tickSparks(cx, cy, t) {
      if (Math.random() < 0.1 && sparks.length < 5) {
        var ang = Math.random() * Math.PI * 2
        var r = LOGO_N * CELL * (0.62 + Math.random() * 0.25)
        sparks.push({ x: cx + Math.cos(ang) * r, y: cy + Math.sin(ang) * r * 0.8, born: t, life: 520 })
      }
      for (var i = sparks.length - 1; i >= 0; i--) {
        var s = sparks[i]
        var u = (t - s.born) / s.life
        if (u >= 1) { sparks.splice(i, 1); continue }
        var arm = u < 0.25 || u >= 0.75 ? 1 : 2 // 十字星一闪：小 → 大 → 小
        var x = snap(s.x), y = snap(s.y)
        ctx.fillStyle = u < 0.5 ? BLUE : FOAM
        ctx.fillRect(x, y, 4, 4)
        for (var k = 1; k <= arm; k++) {
          ctx.fillRect(x + k * 4, y, 4, 4); ctx.fillRect(x - k * 4, y, 4, 4)
          ctx.fillRect(x, y + k * 4, 4, 4); ctx.fillRect(x, y - k * 4, 4, 4)
        }
      }
    }

    /* ── ③ 变身：logo 像素炸开，重组成大号的 Clawd ───────── */

    function bigGrid(cx, cy) {
      // 大号吉祥物画在 52 格网格上（一格 CELL 像素）：让「身体」的中心对准 logo 原来的位置
      var b = mascot.box
      return {
        x: snap(cx - (b[0] + b[2] / 2) * CELL),
        y: snap(cy - (b[1] + b[3] / 2) * CELL),
      }
    }

    function startMorph(cx, cy, t) {
      var lox = cx - (LOGO_N * CELL) / 2, loy = cy - (LOGO_N * CELL) / 2
      var g = bigGrid(cx, cy)
      var src = logo.slice().sort(function (a, b) { return a.x - b.x || a.y - b.y })
      var dst = mascotCells.slice().sort(function (a, b) { return a.x - b.x || a.y - b.y })
      var n = Math.max(src.length, dst.length)
      particles = []
      for (var i = 0; i < n; i++) {
        var a = src[Math.floor(i * src.length / n)]
        var b = dst[Math.floor(i * dst.length / n)]
        var sx = lox + a.x * CELL, sy = loy + a.y * CELL
        var ex = g.x + b.x * CELL, ey = g.y + b.y * CELL
        var ang = Math.random() * Math.PI * 2
        var kick = 60 + Math.random() * 120
        particles.push({
          sx: sx, sy: sy, ex: ex, ey: ey,
          mx: (sx + ex) / 2 + Math.cos(ang) * kick, my: (sy + ey) / 2 + Math.sin(ang) * kick - 40,
          from: a.c, to: b.c, delay: Math.random() * 0.3,
        })
      }
      burst(cx, cy, 14)
      go('morph', t)
    }

    function drawParticles(m) {
      for (var i = 0; i < particles.length; i++) {
        var p = particles[i]
        var u = Math.max(0, Math.min(1, (m - p.delay) / 0.7))
        var e = ease(u)
        var a = 1 - e
        var x = a * a * p.sx + 2 * a * e * p.mx + e * e * p.ex // 二次贝塞尔：先往外甩，再收回来
        var y = a * a * p.sy + 2 * a * e * p.my + e * e * p.ey
        var size = u > 0.15 && u < 0.85 ? CELL * 0.75 : CELL
        ctx.fillStyle = u < 0.55 ? p.from : p.to
        ctx.fillRect(snap(x), snap(y), size, size)
      }
    }

    /* ── ④ 打招呼：吐泡泡 ───────────────────────────────── */

    function puff(g) {
      var b = mascot.box
      var ax = g.x + (b[0] + b[2] / 2) * CELL
      var ay = g.y + b[1] * CELL
      for (var i = 0; i < 2; i++) {
        fizz.push({
          x: ax + (Math.random() * 2 - 1) * b[2] * CELL * 0.34,
          y: ay + 4,
          vx: (Math.random() * 2 - 1) * 12,
          vy: -(46 + Math.random() * 60),
          born: clock,
          life: 620 + Math.random() * 420,
          s: Math.random() < 0.5 ? 5 : 3,
        })
      }
    }

    function drawFizz() {
      for (var i = fizz.length - 1; i >= 0; i--) {
        var f = fizz[i]
        var u = (clock - f.born) / f.life
        if (u >= 1) { fizz.splice(i, 1); continue }
        var age = (clock - f.born) / 1000
        var x = snap(f.x + f.vx * age + Math.sin(u * 9) * 3)
        var y = snap(f.y + f.vy * age)
        ctx.fillStyle = NAVY
        ctx.fillRect(x - 1, y - 1, f.s + 2, f.s + 2)
        ctx.fillStyle = FOAM
        ctx.fillRect(x, y, f.s, f.s)
        ctx.fillStyle = WHITE
        ctx.fillRect(x, y, 2, 2)
      }
    }

    /* ── ⑤ 空翻 ─────────────────────────────────────────── */

    function jumpState(from, to, j) {
      var e = ease(j)
      var c = CELL + (to.cell - CELL) * Math.pow(j, 0.8)
      return {
        x: snap(from.x + (to.x - from.x) * e),
        y: snap(from.y + (to.y - from.y) * (j * j * 0.35 + e * 0.65) - LIFT * 4 * j * (1 - j)),
        c: c,
      }
    }

    function land(t) {
      scope.postMessage({ type: 'land' }) // 真吉祥物现身
      var cell = landedTarget.cell || 2
      var tx, ty
      if (mascot) {
        tx = landedTarget.x + (mascot.box[0] + mascot.box[2] / 2) * cell
        ty = landedTarget.y + (mascot.box[1] + mascot.box[3]) * cell
      } else {
        tx = landedTarget.x + 30 * cell
        ty = landedTarget.y + 49 * cell
      }
      splash(tx, ty)
      if (!landedTarget.mascot) burst(tx, ty - 10 * cell, 14) // 没有真吉祥物接班：碎成像素散掉
      go('land', t)
    }

    /* ── 画吉祥物：帧表里取一格，按 52 格网格摆好（可旋转、可半透明） ── */

    function drawMascot(index, gx, gy, c, alpha, rot) {
      if (!mascot) return
      var b = mascot.box
      var fw = mascot.artW, fh = mascot.artH
      var x = gx + b[0] * c, y = gy + b[1] * c
      var w = b[2] * c, h = b[3] * c
      var sx = (index % 8) * fw, sy = Math.floor(index / 8) * fh
      ctx.globalAlpha = alpha == null ? 1 : alpha
      if (rot) {
        ctx.save()
        ctx.translate(Math.round(x + w / 2), Math.round(y + h / 2))
        ctx.rotate(rot)
        ctx.drawImage(mascot.bitmap, sx, sy, fw, fh, -w / 2, -h / 2, w, h)
        ctx.restore()
      } else {
        ctx.drawImage(mascot.bitmap, sx, sy, fw, fh, Math.round(x), Math.round(y), w, h)
      }
      ctx.globalAlpha = 1
    }

    /* ── 像素碎屑：泡泡破掉、炸开、落地水花共用 ───────────── */

    function burst(x, y, count) {
      for (var i = 0; i < count; i++) {
        var ang = Math.random() * Math.PI * 2
        var v = 40 + Math.random() * 90
        shards.push({ x: x, y: y, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v - 30, born: null, life: 420 + Math.random() * 200, c: Math.random() < 0.5 ? FOAM : BLUE, s: Math.random() < 0.3 ? 6 : 4 })
      }
    }

    function splash(x, y) {
      for (var i = 0; i < 9; i++) {
        var ang = Math.PI * (1.08 + 0.84 * i / 8) // 扇形朝上
        var v = 70 + (i % 3) * 30
        shards.push({ x: x + (i - 4) * 6, y: y, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v - 40, born: null, life: LAND_MS, c: i % 2 ? BLUE : FOAM, s: i % 3 === 0 ? 6 : 4, outline: true })
      }
    }

    function drawShards() {
      for (var i = shards.length - 1; i >= 0; i--) {
        var s = shards[i]
        if (s.born === null) s.born = clock
        var age = (clock - s.born) / 1000
        var u = (clock - s.born) / s.life
        if (u >= 1) { shards.splice(i, 1); continue }
        var x = snap(s.x + s.vx * age)
        var y = snap(s.y + s.vy * age + 260 * age * age)
        if (s.outline) { ctx.fillStyle = NAVY; ctx.fillRect(x - 1, y - 1, s.s + 2, s.s + 2) }
        ctx.fillStyle = s.c
        ctx.fillRect(x, y, s.s, s.s)
      }
    }

    /* ── 底色：整块 → 碎成方块消失 ─────────────────────────── */

    function drawVeil(p) {
      ctx.fillStyle = veilColor
      if (p <= 0) { ctx.fillRect(0, 0, W, H); return }
      if (p >= 1) return
      if (!blocks) {
        blocks = []
        for (var y = 0; y < H; y += BLOCK) {
          for (var x = 0; x < W; x += BLOCK) {
            // 从中心往外碎，带点随机
            var d = Math.hypot((x - W / 2) / W, (y - H * 0.45) / H)
            blocks.push({ x: x, y: y, k: Math.min(0.98, d * 0.9 + Math.random() * 0.35) })
          }
        }
      }
      for (var i = 0; i < blocks.length; i++) {
        var b = blocks[i]
        if (b.k > p) ctx.fillRect(b.x, b.y, BLOCK, BLOCK)
        else if (b.k > p - 0.08) ctx.fillRect(b.x + BLOCK / 4, b.y + BLOCK / 4, BLOCK / 2, BLOCK / 2) // 碎前先缩一下
      }
    }

    /* ── 工具 ─────────────────────────────────────────────── */

    function snap(v) { return Math.round(v / 2) * 2 }
    function ease(u) { return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2 }
  }
})()
