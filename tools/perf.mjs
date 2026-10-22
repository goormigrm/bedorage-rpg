// 프레임 비용 계측 (2026-10-22 사용자: "철면수심전용맵이 그래픽이 높아서 렉 · 무서운 버전도 최대한 최적화").
// 개발 서버(5173)를 띄운 채로:  node tools/perf.mjs [bright|dark] [지역 번호 …]
// 화질 '높게' 고정(자동으로 내려가지 않게) · 1920×1080 · 소리 끔 · 4인 봇 파티를 지역마다 옮겨 6초씩 잰다.
// 재는 것: 한 프레임 CPU ms(그중 3D 그리기) · GPU ms(EXT_disjoint_timer_query) · 그리기 호출 · 삼각형 · 켜진 빛 · 화면 간격.
// 깔린 Chrome 을 쓴다 (playwright 가 받은 크로미움은 이 PC 에서 실행이 막힌다 — spawn UNKNOWN).
import { chromium } from 'playwright'

const args = process.argv.slice(2)
// prof=1: 지역마다 CPU 프로파일(CDP)을 떠서 제 시간(self)이 큰 함수 25개를 적는다
const PROF = args.includes('prof=1')
// why=1: 지역마다 프레임마다 셰이더를 다시 고르는(getProgram) 재질을 센다 — customProgramCacheKey 가 그때만 불린다
const WHY = args.includes('why=1')
const skin = args[0] === 'dark' ? 'dark' : 'bright'
const areas = args.slice(1).filter((a) => !a.includes('=')).map(Number).filter((n) => n >= 0)
const AREAS = areas.length ? areas : [0, 1, 9, 17]

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] })
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
page.on('pageerror', (e) => console.log('페이지 오류:', String(e).slice(0, 200)))
await page.addInitScript(() => {
  try {
    localStorage.setItem('brpg.muted', '1')
    localStorage.setItem('brpg.gfx', 'high')
    localStorage.setItem('brpg.hud', 'normal')
  } catch {
    /* 저장소 없음 */
  }
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
await page.goto('http://localhost:5173/bedorage-rpg/?shot=1')
await page.waitForFunction(() => !!document.querySelector('#btn-host'), null, { timeout: 60000 })
await sleep(2000)
await page.evaluate(async (skin) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const btn = (t) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === t)
  window.__lobby?.selectChar?.('cheolmyeon')
  btn('게임 만들기')?.click()
  await sleep(700)
  document.querySelector(`#seg-skin button[data-v="${skin}"]`)?.click()
  await sleep(200)
  btn('만들기')?.click()
  await sleep(1600)
  const cb = document.querySelector('input[type=checkbox]')
  if (cb && !cb.checked) cb.click()
  await sleep(900)
  btn('▶ 게임 시작')?.click()
}, skin)
await page.waitForFunction(() => window.__bd?.phase?.() === 'playing' && window.__session?.renderer?.ready, null, { timeout: 120000 })
await sleep(3000)
const gpuName = await page.evaluate(async () => {
  const S = window.__session
  S.sfx?.setMuted?.(true)
  // 첫 판 소개 글(시작하기) 닫기 — 덮인 채로 재면 그 창 그리기까지 들어간다
  document.querySelector('.ending.intro .ending-go')?.click()
  // 자동 조종(autopilot)은 쓰지 않는다 — 그 길은 0.5초에 한 번만 그린다(방 지키기용). 나는 서 있고 봇 셋이 싸운다
  const url = performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes('/src/core/sim.ts'))
  window.__perfSim = await import(url)
  const r = S.renderer
  const gl = r.gl.getContext()
  r.gl.info.autoReset = false
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2')
  const P = (window.__perf = { on: false, cpu: [], draw: [], gpu: [], calls: 0, tris: 0, n: 0, pending: [] })
  const draw0 = r.draw
  let dc = 0
  r.draw = function (...a) {
    const t = performance.now()
    draw0.apply(this, a)
    dc = performance.now() - t
  }
  // session.frame 은 인스턴스 함수 — rAF 가 this.frame 으로 부르니 바꿔 끼우면 그 길로 온다
  const frame0 = S.frame
  S.frame = (now) => {
    if (!P.on) return frame0(now)
    r.gl.info.reset()
    let q = null
    if (ext) {
      q = gl.createQuery()
      gl.beginQuery(ext.TIME_ELAPSED_EXT, q)
    }
    const a = performance.now()
    frame0(now)
    P.cpu.push(performance.now() - a)
    P.draw.push(dc)
    if (q) {
      gl.endQuery(ext.TIME_ELAPSED_EXT)
      P.pending.push(q)
    }
    P.calls += r.gl.info.render.calls
    P.tris += r.gl.info.render.triangles
    P.n++
    for (let i = P.pending.length - 1; i >= 0; i--) {
      const p = P.pending[i]
      if (!gl.getQueryParameter(p, gl.QUERY_RESULT_AVAILABLE)) continue
      if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) P.gpu.push(gl.getQueryParameter(p, gl.QUERY_RESULT) / 1e6)
      gl.deleteQuery(p)
      P.pending.splice(i, 1)
    }
  }
  const e = gl.getExtension('WEBGL_debug_renderer_info')
  return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?'
})
console.log('GPU:', gpuName, '· 분위기:', skin)

// exp=1: 첫 지역에서 하나씩 꺼 보며(후처리 · 그림자 · HUD 캔버스) 화면 간격이 어떻게 바뀌나
const EXP = args.includes('exp=1')
const pct = (a, q) => (a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * q))] : 0)
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)
const f = (v) => v.toFixed(1).padStart(5)
for (const area of AREAS) {
  await page.evaluate((area) => {
    const s = window.__bd.state()
    if (s.players[0].area !== area) for (let i = 0; i < s.players.length; i++) window.__perfSim.warpPlayer(s, window.__session.mapOf, i, area)
  }, area)
  await sleep(1500)
  await page.waitForFunction(() => !window.__session.renderer.areaCompiling && !window.__session.renderer.areaHold, null, { timeout: 90000 }).catch(() => {})
  await sleep(5000)
  let cdp = null
  if (PROF) {
    cdp = await page.context().newCDPSession(page)
    await cdp.send('Profiler.enable')
    await cdp.send('Profiler.setSamplingInterval', { interval: 200 })
    await cdp.send('Profiler.start')
  }
  const a = await page.evaluate(async () => {
    const P = window.__perf
    P.cpu = []
    P.draw = []
    P.gpu = []
    P.calls = P.tris = P.n = 0
    const iv = []
    let last = performance.now()
    P.on = true
    await new Promise((res) => {
      const t0 = last
      const step = (t) => {
        iv.push(t - last)
        last = t
        if (t - t0 < 6000) requestAnimationFrame(step)
        else res()
      }
      requestAnimationFrame(step)
    })
    P.on = false
    let lights = 0
    window.__session.renderer.scene.traverse((o) => {
      if (o.isLight && o.visible && !o.isAmbientLight && !o.isHemisphereLight) lights++
    })
    return { iv, cpu: P.cpu, draw: P.draw, gpu: P.gpu, calls: P.calls / P.n, tris: P.tris / P.n, lights, mons: window.__bd.view().monsters.filter((m) => m.hp > 0).length }
  })
  console.log(
    `지역 ${String(area).padStart(2)} · 괴물 ${String(a.mons).padStart(3)} · 간격 ${f(avg(a.iv))} (95% ${f(pct(a.iv, 0.95))} · 최대 ${f(Math.max(...a.iv))})` +
      ` · CPU ${f(avg(a.cpu))} (95% ${f(pct(a.cpu, 0.95))} · 3D ${f(avg(a.draw))}) · GPU ${f(avg(a.gpu))} (95% ${f(pct(a.gpu, 0.95))}) ms` +
      ` · 호출 ${a.calls.toFixed(0)} · 삼각형 ${(a.tris / 1000).toFixed(0)}k · 빛 ${a.lights}`,
  )
  if (EXP) {
    for (const v of (process.env.EXP_V ?? 'base,post,shadow,scale85,hud,base').split(',')) {
      const r = await page.evaluate(async (v) => {
        const R = window.__session.renderer
        const P = window.__perf
        R.setPost(v !== 'post')
        R.setShadows(v !== 'shadow')
        if (v === 'scale85') R.setRenderScale(0.85)
        // 후처리 장면 그림의 MSAA 표본 수 (msaa4 · msaa2 — 기본 0 · FXAA)
        const rt = R.post.scene
        const ms = v === 'msaa4' ? 4 : v === 'msaa2' ? 2 : 0
        if (rt.samples !== ms) {
          rt.samples = ms
          rt.dispose()
        }
        const hud = document.querySelectorAll('canvas')[1]
        if (hud) hud.style.visibility = v === 'hud' ? 'hidden' : ''
        await new Promise((res) => setTimeout(res, 800))
        P.cpu = []
        P.gpu = []
        P.on = true
        const iv = []
        let last = performance.now()
        await new Promise((res) => {
          const t0 = last
          const step = (t) => {
            iv.push(t - last)
            last = t
            if (t - t0 < 4000) requestAnimationFrame(step)
            else res()
          }
          requestAnimationFrame(step)
        })
        P.on = false
        R.setPost(true)
        R.setShadows(true)
        R.setRenderScale(1)
        if (hud) hud.style.visibility = ''
        return { iv, cpu: P.cpu, gpu: P.gpu }
      }, v)
      console.log(`   ${v.padEnd(8)} 간격 ${f(avg(r.iv))} (95% ${f(pct(r.iv, 0.95))}) · CPU ${f(avg(r.cpu))} · GPU ${f(avg(r.gpu))} (95% ${f(pct(r.gpu, 0.95))})`)
    }
  }
  if (WHY) {
    const rows = await page.evaluate(async () => {
      const r = window.__session.renderer
      const gl = r.gl
      const tu = performance.getEntriesByType('resource').map((e) => e.name).find((n) => /\/deps\/three\.js/.test(n))
      const THREE = await import(tu)
      // 지금 그리는 것 (renderBufferDirect 의 인자) — 셰이더를 다시 고르는 까닭을 그 물체로 따진다
      let cur = null
      const rbd = gl.renderBufferDirect
      gl.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
        cur = { scene, geometry, material, object }
        return rbd.call(this, camera, scene, geometry, material, object, group)
      }
      const cnt = new Map()
      const proto = THREE.Material.prototype
      const orig0 = proto.customProgramCacheKey
      const all = []
      const hook = (m) => {
        if (Object.prototype.hasOwnProperty.call(m, '__ck')) return
        const own = Object.prototype.hasOwnProperty.call(m, 'customProgramCacheKey') ? m.customProgramCacheKey : null
        m.__ck = own
        all.push(m)
        m.customProgramCacheKey = function () {
          const mp = gl.properties.get(m)
          const c = cur && cur.material === m ? cur : null
          const w = []
          if (!c) w.push('그리기 밖(compile · 그림자)')
          else {
            const g = c.geometry
            const o = c.object
            const rt = gl.getRenderTarget()
            const cs = rt === null ? gl.outputColorSpace : THREE.ColorManagement.workingColorSpace
            const tm = m.toneMapped ? (rt === null ? gl.toneMapping : 0) : 0
            if (m.version !== mp.__version) w.push('version')
            if (mp.needsLights && mp.lightsStateVersion !== undefined) w.push('빛?')
            if (mp.outputColorSpace !== cs) w.push('색공간')
            if (!!o.isInstancedMesh !== !!mp.instancing) w.push('inst')
            if (o.isInstancedMesh && !!o.instanceColor !== !!mp.instancingColor) w.push('inst색')
            if (!!o.isSkinnedMesh !== !!mp.skinning) w.push('skin')
            if (m.fog && mp.fog !== c.scene?.fog) w.push('fog')
            const va = m.vertexColors === true && !!g.attributes.color && g.attributes.color.itemSize === 4
            if (mp.vertexAlphas !== va) w.push('va')
            if (mp.morphTargets !== !!g.morphAttributes.position) w.push('morph')
            if (mp.toneMapping !== tm) w.push('톤')
            if (!w.length) w.push('?')
          }
          const chain = []
          for (let q = c?.object; q && chain.length < 3; q = q.parent) chain.push(q.name || q.type)
          const k = `${m.type}#${m.id} ${w.join(',')} · ${c ? `${c.object.type} ${c.geometry.type}` : ''} @${chain.join('<')}`
          cnt.set(k, (cnt.get(k) ?? 0) + 1)
          return (own ?? orig0).call(this)
        }
      }
      r.scene.traverse((o) => {
        for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) hook(m)
      })
      // 장면 밖 재질(그림자 깊이 · 후처리 · 새로 생긴 것)
      proto.customProgramCacheKey = function () {
        const k = `(장면 밖) ${this.type}#${this.id}`
        cnt.set(k, (cnt.get(k) ?? 0) + 1)
        return orig0.call(this)
      }
      const t0 = performance.now()
      let f0 = 0
      await new Promise((res) => {
        const step = () => {
          f0++
          if (performance.now() - t0 < 2000) requestAnimationFrame(step)
          else res()
        }
        requestAnimationFrame(step)
      })
      proto.customProgramCacheKey = orig0
      gl.renderBufferDirect = rbd
      for (const m of all) {
        if (m.__ck) m.customProgramCacheKey = m.__ck
        else delete m.customProgramCacheKey
        delete m.__ck
      }
      return [...cnt].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `${(v / f0).toFixed(1).padStart(6)}/프레임  ${k}`)
    })
    for (const l of rows) console.log('  ', l)
  }
  if (cdp) {
    const { profile } = await cdp.send('Profiler.stop')
    const dt = profile.timeDeltas
    const self = new Map()
    const byId = new Map(profile.nodes.map((n) => [n.id, n]))
    let total = 0
    profile.samples.forEach((id, i) => {
      const n = byId.get(id)
      const cf = n.callFrame
      const key = `${cf.functionName || '(익명)'} ${cf.url.replace(/^.*\/(src|node_modules)\//, '$1/').replace(/\?.*$/, '')}:${cf.lineNumber + 1}`
      const t = (dt[i] ?? 0) / 1000
      total += t
      self.set(key, (self.get(key) ?? 0) + t)
    })
    const top = [...self].sort((x, y) => y[1] - x[1]).slice(0, 25)
    for (const [k, t] of top) console.log(`   ${((t / total) * 100).toFixed(1).padStart(5)}%  ${k}`)
    // 우리 코드(src/)의 함수마다 포함 시간 (부른 것까지) — 어느 갱신 · 그리기가 큰지
    const selfOf = new Map()
    profile.samples.forEach((id, i) => selfOf.set(id, (selfOf.get(id) ?? 0) + (dt[i] ?? 0) / 1000))
    const incl = new Map()
    const walk = (n, stack) => {
      let t = selfOf.get(n.id) ?? 0
      const cf = n.callFrame
      const key = cf.url.includes('/src/') || process.env.PROF_ALL ? `${cf.functionName || '(익명)'} ${cf.url.replace(/^.*\/src\//, 'src/').replace(/\?.*$/, '')}:${cf.lineNumber + 1}` : null
      const fresh = key && !stack.has(key)
      if (fresh) stack.add(key)
      for (const c of n.children ?? []) t += walk(byId.get(c), stack)
      if (fresh) {
        stack.delete(key)
        incl.set(key, (incl.get(key) ?? 0) + t)
      }
      return t
    }
    walk(profile.nodes[0], new Set())
    console.log('   — 포함 시간 (src) —')
    for (const [k, t] of [...incl].sort((x, y) => y[1] - x[1]).slice(0, 30)) console.log(`   ${((t / total) * 100).toFixed(1).padStart(5)}%  ${k}`)
    await cdp.detach()
  }
}
await browser.close()
