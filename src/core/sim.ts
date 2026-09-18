import { CHARACTERS, CHARACTER_LIST, CharacterId, headHitScale } from './characters'
import { angleDiff, atan2A, cosA, sinA, len } from './fixedmath'
import { BTN_ADS, BTN_DASH, BTN_FIRE, BTN_RELOAD, BTN_SPRINT, BTN_SWAP, Input } from './input'
import { COVER_DIST, GameMap, SANDBAG_HP, TILE, TILE_SANDBAG, isWallAt, nearSandbag, rayCast } from './map'
import { BashDef, SNIPER_GRAZE_FRAC } from './weapons'
import { circlesOverlap, moveCircle, pointLineDistance, segmentHitsCircle } from './physics'
import { makeRng, rand, randInt } from './rng'
import {
  BLOCK_CHANCE,
  BLOCK_COST,
  BLOCK_LOCK_TICKS,
  Bullet,
  COUNTDOWN_TICKS,
  DASH_SPEED,
  DASH_TICKS,
  GameState,
  MAX_PLAYERS,
  MEDKIT_HEAL_FRAC,
  MEDKIT_RADIUS,
  MEDKIT_TTL,
  MIN_PLAYERS,
  MatchConfig,
  DASH_COST,
  PLAYER_RADIUS,
  PlayerState,
  RESPAWN_TICKS,
  SPAWN_PROTECT_TICKS,
  STAMINA_MAX,
  CHICKEN_HEAL,
  GIYEOL,
  JUPEOL,
  UWON,
  CHICKEN_MAXHP_CAP,
  CHICKEN_MAXHP_PER_KILL,
  SPRINT_COST,
  SPRINT_MIN,
  SPRINT_MUL,
  STAMINA_REGEN,
  PUNGWOL,
  CHIM,
  SWAP_GRACE_TICKS,
  isEnemy,
  teamKills,
} from './state'
import { HEAD_AIM_FRAC, HEAD_FRAC, PART_BODY, PART_HEAD, PART_LEGS, PART_MULT, WEAPONS, falloff, headMult, partForOffset } from './weapons'

const MAX_RECOIL_MUL = 3

export function createState(cfg: MatchConfig, map: GameMap): GameState {
  const rng = makeRng(cfg.seed)
  const n = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, cfg.chars.length))
  const players: PlayerState[] = []
  for (let i = 0; i < n; i++) {
    const p = makePlayer(i, cfg.chars[i], cfg.teams?.[i] ?? i)
    // 아직 아무도 안 들어온 자리는 판에 나오지 않는다 (난입하면 그때 채운다)
    if (cfg.absent?.[i]) {
      p.left = true
      p.vacant = true
      p.alive = false
      p.hp = 0
    }
    players.push(p)
  }
  const state: GameState = {
    tick: 0,
    rng,
    phase: 'countdown',
    phaseTimer: COUNTDOWN_TICKS,
    targetKills: cfg.targetKills,
    players,
    bullets: [],
    nextBulletId: 1,
    winner: -1,
    sandbags: {},
    medkits: [],
    nextMedkitId: 1,
    events: [],
  }
  // 같은 맵 객체로 다시 시작해도 똑같이 시작하도록 부서진 모래주머니를 되돌린다
  for (const i of map.sandbagIdx) {
    map.tiles[i] = TILE_SANDBAG
    state.sandbags[i] = SANDBAG_HP
  }
  // 초기 스폰: 첫 사람은 무작위, 다음 사람은 이미 놓인 모두에게서 가장 먼 곳
  const used: { x: number; y: number }[] = []
  const first = map.spawns[randInt(rng, 0, map.spawns.length)]
  placeAt(players[0], first)
  used.push(first)
  for (let i = 1; i < n; i++) {
    const s = farthestSpawn(map, used, rng, 1)
    placeAt(players[i], s)
    used.push(s)
  }
  // 빈 자리는 아직 아무 데도 없다 (난입할 때 살아 있는 사람들에게서 먼 곳에 넣는다)
  // 처음엔 맵 중앙을 바라본다
  for (const p of players) p.aim = atan2A(map.ph / 2 - p.y, map.pw / 2 - p.x)
  return state
}

function makePlayer(id: number, char: PlayerState['char'], team: number): PlayerState {
  const c = CHARACTERS[char]
  const w = WEAPONS[c.weapon]
  return {
    id,
    team,
    char,
    x: 0,
    y: 0,
    aim: 0,
    hp: c.maxHp,
    maxHp: c.maxHp,
    alive: true,
    respawnTimer: 0,
    weapon: c.weapon,
    ammo: w.magSize,
    reloadTimer: 0,
    fireCooldown: 0,
    recoil: 0,
    ads: false,
    aimDist: 0,
    dashTimer: 0,
    dashCooldown: 0,
    dashDx: 0,
    dashDy: 0,
    lastHitTick: -10000,
    prevFire: false,
    kills: 0,
    deaths: 0,
    legInjury: 0,
    invuln: SPAWN_PROTECT_TICKS,
    moving: false,
    sprinting: false,
    aliveTicks: 0,
    left: false,
    vacant: false,
    choosing: false,
    streak: 0,
    stamina: c.staminaMax ?? STAMINA_MAX,
    staminaMax: c.staminaMax ?? STAMINA_MAX,
    blockLock: 0,
    shots: 0,
    hits: 0,
    heads: 0,
    dmgDealt: 0,
    dmgTaken: 0,
    bestStreak: 0,
    killStreak: 0,
  }
}

function placeAt(p: PlayerState, s: { x: number; y: number }): void {
  p.x = s.x
  p.y = s.y
}

/**
 * 기준점들(적·이미 배치된 사람)로부터의 최소 거리가 가장 먼 스폰 상위 topN 개 중 무작위.
 * 기준점이 없으면 아무 스폰이나.
 */
function farthestSpawn(
  map: GameMap,
  from: { x: number; y: number }[],
  rng: GameState['rng'],
  topN: number,
): { x: number; y: number } {
  if (from.length === 0) return map.spawns[randInt(rng, 0, map.spawns.length)]
  const scored = map.spawns.map((s, i) => {
    let d = Infinity
    for (const f of from) d = Math.min(d, len(s.x - f.x, s.y - f.y))
    return { s, i, d }
  })
  scored.sort((a, b) => b.d - a.d || a.i - b.i)
  const top = scored.slice(0, Math.min(topN, scored.length))
  return top[randInt(rng, 0, top.length)].s
}

export function step(state: GameState, map: GameMap, inputs: Input[]): void {
  const ev = state.events
  ev.length = 0

  if (state.phase === 'countdown') {
    state.phaseTimer--
    if (state.phaseTimer <= 0) {
      state.phase = 'playing'
      ev.push({ type: 'start' })
    }
  }

  for (let i = 0; i < state.players.length; i++) {
    stepPlayer(state, map, state.players[i], inputs[i])
  }

  stepBullets(state, map)
  stepMedkits(state)

  state.tick++
}

/**
 * 바닥의 힐팩: 시간이 지나면 사라지고, 다친 사람이 밟으면 회복된다.
 * 죽인 사람이 이어서 싸울 수 있게 해 주는 장치라, 체력이 가득이면 줍지 않고 남겨 둔다.
 */
function stepMedkits(state: GameState): void {
  if (state.medkits.length === 0) return
  let write = 0
  for (let i = 0; i < state.medkits.length; i++) {
    const m = state.medkits[i]
    m.ttl--
    if (m.ttl <= 0) continue
    let taken = false
    // 플레이어 순서대로 본다 (동시에 밟으면 번호가 앞선 사람이 줍는다 — 양쪽 화면에서 같아야 한다)
    for (const p of state.players) {
      if (!p.alive || p.left || p.choosing) continue
      const max = p.maxHp
      if (p.hp >= max) continue
      const dx = p.x - m.x
      const dy = p.y - m.y
      if (dx * dx + dy * dy > (MEDKIT_RADIUS + PLAYER_RADIUS) * (MEDKIT_RADIUS + PLAYER_RADIUS)) continue
      const amount = Math.min(max - p.hp, Math.round(max * MEDKIT_HEAL_FRAC))
      p.hp += amount
      state.events.push({ type: 'heal', p: p.id, x: m.x, y: m.y, amount })
      taken = true
      break
    }
    if (!taken) state.medkits[write++] = m
  }
  state.medkits.length = write
}

/**
 * 빈 자리에 사람을 넣는다 (난입·재입장).
 * 호스트가 정한 틱에 **모두가 같이** 호출해야 결정론이 유지된다.
 * 들어오자마자 맞지 않도록 스폰 보호를 준다.
 */
export function joinPlayer(state: GameState, map: GameMap, idx: number, char: CharacterId, team: number): void {
  const p = state.players[idx]
  if (!p) return
  p.left = false
  p.vacant = false
  p.char = char
  p.weapon = CHARACTERS[char].weapon
  p.team = team
  p.kills = 0
  p.deaths = 0
  p.streak = 0
  p.killStreak = 0
  p.bestStreak = 0
  p.shots = 0
  p.hits = 0
  p.heads = 0
  p.dmgDealt = 0
  p.dmgTaken = 0
  p.choosing = false
  p.respawnTimer = 0
  respawn(state, map, p)
  state.events.push({ type: 'join', p: idx, char })
}

/** 경기 도중 나간 사람 처리 (호스트가 정한 틱에 모두가 같이 호출해야 결정론이 유지된다) */
export function dropPlayer(state: GameState, idx: number): void {
  const p = state.players[idx]
  if (!p || p.left) return
  p.left = true
  p.alive = false
  p.hp = 0
  p.respawnTimer = 0
  state.events.push({ type: 'leave', p: idx })
}

function stepPlayer(state: GameState, map: GameMap, p: PlayerState, input: Input | undefined): void {
  const c = CHARACTERS[p.char]
  const w = WEAPONS[p.weapon]
  p.moving = false
  if (p.left) return
  if (!input) input = { mx: 0, my: 0, aim: p.aim, buttons: 0, char: 0 }
  const playing = state.phase === 'playing'
  const swap = (input.buttons & BTN_SWAP) !== 0 && playing

  if (!p.alive) {
    if (state.phase === 'over') return
    if (p.respawnTimer > 0) p.respawnTimer--
    if (swap && !p.choosing) {
      p.choosing = true
      state.events.push({ type: 'choose', p: p.id })
    }
    if (p.choosing) {
      if (input.char <= 0) return // 고르는 동안은 소환하지 않는다
      const def = CHARACTER_LIST[input.char - 1]
      if (def && def.id !== p.char) {
        p.char = def.id
        p.weapon = def.weapon
        state.events.push({ type: 'swap', p: p.id, char: def.id })
      }
      p.choosing = false
    }
    if (p.respawnTimer <= 0) respawn(state, map, p)
    return
  }

  if (playing) p.aliveTicks++ // 카운트다운은 세지 않는다 → 시작 직후 3초도 교체 가능
  // 리스폰 직후(3초 안) Tab: 소환을 물리고 캐릭터를 다시 고른다
  if (swap && p.aliveTicks <= SWAP_GRACE_TICKS && !p.choosing) {
    p.alive = false
    p.choosing = true
    p.respawnTimer = RESPAWN_TICKS
    p.ads = false
    p.dashTimer = 0
    state.events.push({ type: 'choose', p: p.id })
    return
  }
  if (p.fireCooldown > 0) p.fireCooldown--
  if (p.dashCooldown > 0) p.dashCooldown--
  // 근접 무기는 기력이 방어에도 쓰이므로 빨리 찬다. 단 막는 중에는 차지 않는다 —
  // 그래야 계속 쏘면 방어가 결국 뚫린다 (막고 버티기만 하면 무적이 되던 문제)
  if (p.blockLock > 0) p.blockLock--
  // 달리기(Shift): 움직이는 동안에만, 기력이 남아 있을 때만. 정조준·구르기 중에는 달리지 않는다.
  // 회복보다 **먼저** 계산해야 달리는 동안 기력이 차지 않는다.
  // 달리던 중이면 0 까지 쓰고, 새로 시작하려면 SPRINT_MIN 만큼은 차 있어야 한다
  p.sprinting =
    playing &&
    (input.mx !== 0 || input.my !== 0) &&
    p.dashTimer === 0 &&
    p.stamina >= (p.sprinting ? Number.MIN_VALUE : SPRINT_MIN) &&
    p.stamina > 0 &&
    (input.buttons & BTN_SPRINT) !== 0 &&
    (input.buttons & BTN_ADS) === 0
  if (p.sprinting) p.stamina = Math.max(0, p.stamina - SPRINT_COST)
  if (p.dashTimer === 0 && p.blockLock === 0 && !p.sprinting && p.stamina < p.staminaMax) {
    p.stamina = Math.min(p.staminaMax, p.stamina + STAMINA_REGEN * (w.melee ? 2.4 : 1))
  }
  if (p.invuln > 0) p.invuln--
  if (p.legInjury > 0) p.legInjury--
  if (p.reloadTimer > 0) {
    p.reloadTimer--
    if (p.reloadTimer === 0) p.ammo = w.magSize
  }
  const recover = c.id === 'chim' ? w.recoilRecover * CHIM.recoverMul : w.recoilRecover
  p.recoil = Math.max(0, p.recoil - recover)

  // 매직덕 패시브: 피격 3초 후 초당 4 회복
  if (c.id === 'magic' && state.tick - p.lastHitTick > 180 && p.hp < p.maxHp) {
    p.hp = Math.min(p.maxHp, p.hp + 6 / 60)
  }

  p.aim = input.aim & 1023
  p.aimDist = (input.aimDist ?? 0) * 4
  p.ads = playing && (input.buttons & BTN_ADS) !== 0 && p.dashTimer === 0

  // 이동
  let mx = input.mx
  let my = input.my
  if (!playing) {
    mx = 0
    my = 0
  }
  if (p.dashTimer > 0) {
    p.dashTimer--
    const r = moveCircle(map, p.x, p.y, PLAYER_RADIUS, p.dashDx * DASH_SPEED, p.dashDy * DASH_SPEED)
    p.x = r.x
    p.y = r.y
    p.moving = true
  } else if (mx !== 0 || my !== 0) {
    const inv = mx !== 0 && my !== 0 ? 0.70710678 : 1
    let speed = c.speed * w.moveMul
    if (p.sprinting) speed *= SPRINT_MUL
    if (p.ads && c.id !== 'oknyang') speed *= 0.6 // 옥냥덕 패시브: 정조준해도 느려지지 않음
    if (p.legInjury > 0) speed *= 0.7
    const r = moveCircle(map, p.x, p.y, PLAYER_RADIUS, mx * inv * speed, my * inv * speed)
    p.x = r.x
    p.y = r.y
    p.moving = true
  }

  // 대시
  if (
    playing &&
    input.buttons & BTN_DASH &&
    p.dashCooldown === 0 &&
    p.dashTimer === 0 &&
    p.stamina >= (c.id === 'pungwol' ? PUNGWOL.dashCost : DASH_COST) &&
    (mx !== 0 || my !== 0)
  ) {
    p.stamina -= c.id === 'pungwol' ? PUNGWOL.dashCost : DASH_COST // 풍월덕: 구르기가 싸다(패시브)
    const inv = mx !== 0 && my !== 0 ? 0.70710678 : 1
    p.dashDx = mx * inv
    p.dashDy = my * inv
    p.dashTimer = c.id === 'juwoojae' ? Math.round(DASH_TICKS * 1.3) : DASH_TICKS // 우재덕: 대시 거리 +30%
    p.dashCooldown = c.dashCooldown
    p.ads = false
    if (c.id === 'uwon') p.invuln = Math.max(p.invuln, p.dashTimer + UWON.invulnAfterDash) // 우원덕: 대시가 끝난 뒤에도 잠깐 무적
    state.events.push({ type: 'dash', p: p.id })
  }

  // 재장전
  if (playing && input.buttons & BTN_RELOAD && p.reloadTimer === 0 && p.ammo < w.magSize) {
    p.reloadTimer = w.reloadTicks
    state.events.push({ type: 'reload', p: p.id })
  }

  // 사격
  const firePressed = (input.buttons & BTN_FIRE) !== 0
  const trigger = w.auto ? firePressed : firePressed && !p.prevFire
  p.prevFire = firePressed
  if (playing && trigger && p.dashTimer === 0) {
    // 저격총을 조준경 없이 쏘면 개머리판 후려치기 — 탄도 재장전도 안 본다 (재장전 중에도 가까운 적은 칠 수 있다, 2026-09-05)
    if (w.bash && !p.ads) {
      if (p.fireCooldown === 0) bashSwing(state, map, p, w.bash)
    } else {
      const infinite = w.magSize === 0
      if (!infinite && p.ammo === 0 && p.reloadTimer === 0) {
        p.reloadTimer = w.reloadTicks
        state.events.push({ type: 'reload', p: p.id })
      } else if (p.fireCooldown === 0 && p.reloadTimer === 0 && (infinite || p.ammo > 0)) {
        fire(state, map, p)
      }
    }
  }
}

/** 총구에서 나간 이 각도의 탄이 적의 머리(중심)를 정확히 겨누는가 → 모래주머니를 넘어간다 */
/**
 * 엄폐 사격이 모래주머니를 넘기는 거리. 붙은 자루 한 줄(최대 3칸 두께)까지만 넘긴다.
 * 이걸 넘어선 자루는 엄폐 중이어도 막는다.
 */
const COVER_REACH = COVER_DIST + TILE * 3

/**
 * 쏠 때 커서(조준점)가 올라가 있는 적. 헤드샷과 '머리 조준' 모래주머니 관통은 이 사람에게만 난다.
 * 조준점 = 내 위치 + 조준 각도 × 조준 거리. 거리가 0(조준점 없음)이면 아무도 아니다.
 */
function aimedEnemy(state: GameState, p: PlayerState): number {
  if (p.aimDist <= 0) return -1
  const ax = p.x + cosA(p.aim) * p.aimDist
  const ay = p.y + sinA(p.aim) * p.aimDist
  for (const e of state.players) {
    if (!isEnemy(p, e) || !e.alive || e.left) continue
    if (len(ax - e.x, ay - e.y) <= PLAYER_RADIUS * HEAD_AIM_FRAC * headHitScale(e.char)) return e.id
  }
  return -1
}

function aimsAtHead(state: GameState, map: GameMap, shooter: PlayerState, mx: number, my: number, a: number, headTarget: number): boolean {
  if (headTarget < 0) return false
  const dx = cosA(a)
  const dy = sinA(a)
  for (const e of state.players) {
    if (e.id !== headTarget || !isEnemy(shooter, e) || !e.alive || e.left) continue
    const t = (e.x - mx) * dx + (e.y - my) * dy
    if (t <= 0 || t > 1200) continue
    if (len(mx + dx * t - e.x, my + dy * t - e.y) > PLAYER_RADIUS * HEAD_FRAC * headHitScale(e.char)) continue
    if (rayCast(map, mx, my, e.x, e.y, 'sight').blocked) continue
    return true
  }
  return false
}

/** 저격총 개머리판: 가까운 부채꼴 안의 적을 살짝 친다. 총알이 아니라 막기(후라이팬)도 안 걸린다 */
function bashSwing(state: GameState, map: GameMap, p: PlayerState, bash: BashDef): void {
  p.fireCooldown = bash.interval
  state.events.push({ type: 'bash', p: p.id, x: p.x, y: p.y, aim: p.aim })
  const range = bash.range + PLAYER_RADIUS
  for (const victim of state.players) {
    if (!isEnemy(p, victim) || !victim.alive || victim.left || victim.invuln > 0 || victim.dashTimer > 0) continue
    const dx = victim.x - p.x
    const dy = victim.y - p.y
    if (len(dx, dy) > range) continue
    if (Math.abs(angleDiff(atan2A(dy, dx), p.aim)) > bash.arc) continue
    if (rayCast(map, p.x, p.y, victim.x, victim.y, 'bullet', true).blocked) continue
    p.shots++
    hurt(state, p, victim, bash.damage, PART_BODY, victim.x, victim.y)
  }
}

/** 근접 무기(후라이팬): 부채꼴 안의 적을 바로 때린다 */
function meleeSwing(state: GameState, map: GameMap, p: PlayerState): void {
  const w = WEAPONS[p.weapon]
  const range = (w.meleeRange ?? 60) + PLAYER_RADIUS
  const arc = w.meleeArc ?? 150
  for (const victim of state.players) {
    if (!isEnemy(p, victim) || !victim.alive || victim.left || victim.invuln > 0 || victim.dashTimer > 0) continue
    const dx = victim.x - p.x
    const dy = victim.y - p.y
    if (len(dx, dy) > range) continue
    if (Math.abs(angleDiff(atan2A(dy, dx), p.aim)) > arc) continue
    if (rayCast(map, p.x, p.y, victim.x, victim.y, 'bullet', true).blocked) continue
    p.streak = Math.min(99, p.streak + 1)
    hurt(state, p, victim, Math.round(w.damage), PART_BODY, victim.x, victim.y)
  }
}

function fire(state: GameState, map: GameMap, p: PlayerState): void {
  const w = WEAPONS[p.weapon]
  // 침착덕: 탄퍼짐이 작다(패시브 '침착'). 반동은 소총 연사 간격 동안 다 회복돼 실효가 없어서 퍼짐을 줄인다
  const spread = Math.round((p.ads ? w.spreadAds : w.spreadHip) * (p.char === 'chim' ? CHIM.spreadMul : 1)) + p.recoil
  let mx = p.x + cosA(p.aim) * (PLAYER_RADIUS + 6)
  let my = p.y + sinA(p.aim) * (PLAYER_RADIUS + 6)
  if (isWallAt(map, mx, my)) {
    mx = p.x
    my = p.y
  }
  if (w.melee) {
    p.fireCooldown = w.fireInterval
    p.shots++
    state.events.push({ type: 'fire', p: p.id, x: mx, y: my, aim: p.aim, weapon: p.weapon })
    meleeSwing(state, map, p)
    return
  }
  // 모래주머니에 붙어 쏘면(엄폐) **내가 기댄 자루만** 넘어간다
  const inCover = nearSandbag(map, p.x, p.y)
  const overR = inCover ? COVER_REACH : 0
  const headTarget = aimedEnemy(state, p)
  for (let i = 0; i < w.pellets; i++) {
    const off = spread > 0 ? randInt(state.rng, -spread, spread + 1) : 0
    const a = (p.aim + off) & 1023
    const b: Bullet = {
      id: state.nextBulletId++,
      owner: p.id,
      x: mx,
      y: my,
      px: mx,
      py: my,
      vx: cosA(a) * w.speed,
      vy: sinA(a) * w.speed,
      life: w.life,
      damage: w.damage,
      ads: p.ads,
      ox: p.x,
      oy: p.y,
      weapon: p.weapon,
      hitSomeone: false,
      over: aimsAtHead(state, map, p, mx, my, a, headTarget),
      overR,
      headTarget,
    }
    state.bullets.push(b)
  }
  if (w.magSize > 0) p.ammo--
  p.shots += w.pellets // 명중률을 탄 단위로 재야 산탄총이 왜곡되지 않는다
  p.fireCooldown = w.fireInterval
  p.recoil = Math.min(w.recoil * MAX_RECOIL_MUL * 2, p.recoil + w.recoil * (p.char === 'chim' ? CHIM.recoilMul : 1)) // 침착덕: 발당 반동이 작다
  state.events.push({ type: 'fire', p: p.id, x: mx, y: my, aim: p.aim, weapon: p.weapon })
  if (w.magSize > 0 && p.ammo === 0) {
    p.reloadTimer = w.reloadTicks
    state.events.push({ type: 'reload', p: p.id })
  }
}

function stepBullets(state: GameState, map: GameMap): void {
  const bullets = state.bullets
  let write = 0
  for (let i = 0; i < bullets.length; i++) {
    const b = bullets[i]
    b.px = b.x
    b.py = b.y
    b.x += b.vx
    b.y += b.vy
    b.life--
    let dead = false

    // 엄폐 관통은 총구 근처에서만 (기대고 있는 자루를 넘기려는 것이다)
    const near = b.overR > 0 && (b.px - b.ox) ** 2 + (b.py - b.oy) ** 2 <= b.overR * b.overR
    const tileHit = rayCast(map, b.px, b.py, b.x, b.y, 'bullet', b.over || near)
    if (tileHit.blocked) {
      const aim = state.players[b.owner].aim
      if (tileHit.tile === TILE_SANDBAG) damageSandbag(state, map, tileHit.tx, tileHit.ty, b.damage)
      state.events.push({ type: 'wall', x: b.x, y: b.y, aim })
      dead = true
    }

    if (!dead) {
      const shooter = state.players[b.owner]
      // 적 중 이 선분에 처음(인덱스 순) 걸리는 사람. 탄 길이가 짧아 둘이 동시에 걸리는 일은 드물다.
      for (const victim of state.players) {
        if (!isEnemy(shooter, victim) || !victim.alive || victim.left || victim.invuln > 0 || victim.dashTimer > 0) continue // 대시(구르기) 중 무적
        if (segmentHitsCircle(b.px, b.py, b.x, b.y, victim.x, victim.y, PLAYER_RADIUS)) {
          applyHit(state, b, victim, pointLineDistance(victim.x, victim.y, b.px, b.py, b.vx, b.vy))
          dead = true
          break
        }
      }
    }

    if (!dead && b.life <= 0) dead = true
    // 맞히지 못하고 사라진 탄 → 기열덕 연속 명중 초기화
    if (dead && !b.hitSomeone) state.players[b.owner].streak = Math.max(0, state.players[b.owner].streak - 1)
    if (!dead) bullets[write++] = b
  }
  bullets.length = write
}

function damageSandbag(state: GameState, map: GameMap, tx: number, ty: number, dmg: number): void {
  const i = ty * map.w + tx
  const hp = state.sandbags[i]
  if (hp === undefined) return
  const left = hp - dmg
  if (left <= 0) {
    delete state.sandbags[i]
    map.tiles[i] = 0
    state.events.push({ type: 'break', tx, ty })
  } else {
    state.sandbags[i] = left
  }
}

/** 상태(정본)에 맞춰 맵의 모래주머니 타일을 되돌린다 (리싱크 후) */
export function syncSandbags(state: GameState, map: GameMap): void {
  for (const i of map.sandbagIdx) {
    map.tiles[i] = state.sandbags[i] === undefined ? 0 : TILE_SANDBAG
  }
}

/** 실제 피해 적용 (근접·투사체 공용) */
/** 힐팩을 떨군다. 너무 쌓이지 않게 한 사람이 연달아 죽어도 자리를 조금씩 흩는다 */
function dropMedkit(state: GameState, x: number, y: number): void {
  state.medkits.push({ id: state.nextMedkitId++, x, y, ttl: MEDKIT_TTL })
  state.events.push({ type: 'drop', x, y })
  // 오래된 것부터 정리 (동시에 너무 많으면 지저분하고 유리해진다)
  while (state.medkits.length > 6) state.medkits.shift()
}

function hurt(state: GameState, shooter: PlayerState, victim: PlayerState, dmg: number, part: number, hx: number, hy: number): void {
  if (dmg <= 0) return
  shooter.hits++
  if (part === PART_HEAD) shooter.heads++
  shooter.dmgDealt += dmg
  victim.dmgTaken += dmg
  victim.hp -= dmg
  victim.lastHitTick = state.tick
  if (part === PART_LEGS) victim.legInjury = 180
  state.events.push({ type: 'hit', p: victim.id, by: shooter.id, x: hx, y: hy, part, dmg })
  if (victim.hp <= 0) {
    victim.hp = 0
    victim.alive = false
    victim.respawnTimer = victim.char === 'seungwoo' ? 120 : RESPAWN_TICKS
    victim.deaths++
    victim.killStreak = 0
    shooter.kills++
    shooter.killStreak++
    if (shooter.killStreak > shooter.bestStreak) shooter.bestStreak = shooter.killStreak
    if (shooter.char === 'tongdak') {
      // 통천덕: 잡을수록 커진다. 최대 체력 +15(최대 +60), 체력 +20. 죽으면 원래대로(respawn)
      shooter.maxHp = Math.min(CHARACTERS.tongdak.maxHp + CHICKEN_MAXHP_CAP, shooter.maxHp + CHICKEN_MAXHP_PER_KILL)
      shooter.hp = Math.min(shooter.maxHp, shooter.hp + CHICKEN_HEAL)
    }
    state.events.push({ type: 'death', p: victim.id, by: shooter.id, x: victim.x, y: victim.y })
    // 죽은 자리에 힐팩을 남긴다. 이긴 쪽이 그 자리를 차지하면 이어서 싸울 수 있다
    dropMedkit(state, victim.x, victim.y)
    if (teamKills(state, shooter.team) >= state.targetKills && state.phase === 'playing') {
      state.phase = 'over'
      state.winner = shooter.team
      state.events.push({ type: 'over', winner: shooter.team })
    }
  }
}

/** dOff = 탄 궤적과 상대 중심 사이 최단 거리. 가운데를 정확히 맞히면 머리. */
function applyHit(state: GameState, b: Bullet, victim: PlayerState, dOff: number): void {
  const w = WEAPONS[b.weapon]
  const dist = len(victim.x - b.ox, victim.y - b.oy)
  let part = partForOffset(dOff, PLAYER_RADIUS, headHitScale(victim.char))
  if (w.pellets > 1) {
    // 산탄: 커서가 상대 위였고 **정중앙을 지나는 탄**만 머리 (탄 7개가 전부 머리가 되면 과하다)
    if (part === PART_HEAD && b.headTarget !== victim.id) part = PART_BODY
  } else if (b.headTarget === victim.id) {
    // 쏠 때 커서(금색)가 이 사람 위였다 → 탄퍼짐·반동으로 빗겨 맞아도 머리. "금색이면 헤드샷" 을 그대로 지킨다
    part = PART_HEAD
  } else if (part === PART_HEAD) {
    // 궤적이 정중앙을 지나도 커서가 이 사람 위에 없었으면 몸통
    part = PART_BODY
  }
  const mult = part === PART_HEAD ? headMult(w) : PART_MULT[part]
  let dmg = b.damage * mult * falloff(w, dist)
  // 저격 조준경 탄: 맞으면 한 방. 반지름 바깥 30% 를 스치면 체력 grazeLeave(10) 만 남긴다 (2026-09-05 오픈 베타 제보 — 다들 빨라져 잡기 어렵다)
  if (w.lethalAds && b.ads) {
    const graze = dOff > PLAYER_RADIUS * SNIPER_GRAZE_FRAC
    dmg = graze ? Math.max(0, victim.hp - (w.grazeLeave ?? 10)) : victim.hp
  }
  const shooter = state.players[b.owner]
  if (shooter.char === 'jupeol' && dist < JUPEOL.range) dmg *= JUPEOL.mult
  if (shooter.char === 'giyeol') dmg *= 1 + Math.min(GIYEOL.maxStacks, shooter.streak) * GIYEOL.perHit
  dmg = Math.round(dmg)
  b.hitSomeone = true
  shooter.streak = Math.min(99, shooter.streak + 1)
  // 근접 무기(후라이팬)를 든 사람은 앞에서 오는 탄을 기력으로 막는다.
  // 기력 한 통(=피해 181)까지만 막을 수 있고, **막는 동안에는 기력이 차지 않는다**.
  // 예전에는 맞으면서도 기력이 차서, 서서 막기만 해도 총알을 무한히 튕겨 냈다.
  // 그래도 정면 대치에서 너무 세서, 앞에서 온 탄이라도 **BLOCK_CHANCE 확률로만** 막는다(50% → 40%, 2026-09-05 오픈 베타 제보).
  // 추첨은 sim 의 rng 라 양쪽 브라우저에서 같은 결과가 난다.
  // 앞에서 맞고 있으면 **막았든 못 막았든** 기력이 차지 않는다 — 확률을 낮추자 안 막힌 사이사이에 기력이 차서
  // 서서 버티며 회복하는 일이 생겼다(테스트가 잡았다). 기력 통이 150 이라 회복까지 되면 다시 방패가 된다.
  if (WEAPONS[victim.weapon].melee) {
    const from = atan2A(b.oy - victim.y, b.ox - victim.x)
    if (Math.abs(angleDiff(from, victim.aim)) < 213) {
      victim.blockLock = BLOCK_LOCK_TICKS
      if (victim.stamina > 0 && rand(state.rng) < BLOCK_CHANCE) {
        const absorbed = Math.min(dmg, Math.floor(victim.stamina / BLOCK_COST))
        victim.stamina = Math.max(0, victim.stamina - absorbed * BLOCK_COST)
        dmg -= absorbed
        state.events.push({ type: 'block', p: victim.id, x: b.x, y: b.y })
      }
    }
  }
  hurt(state, shooter, victim, dmg, part, b.x, b.y)
}

function respawn(state: GameState, map: GameMap, p: PlayerState): void {
  const c = CHARACTERS[p.char]
  const w = WEAPONS[p.weapon]
  // 살아있는 적 모두에게서 먼 곳 (상위 3곳 중 무작위)
  const enemies: { x: number; y: number }[] = []
  for (const e of state.players) if (isEnemy(p, e) && e.alive && !e.left) enemies.push(e)
  let spot = farthestSpawn(map, enemies, state.rng, 3)
  // 누군가와 겹치면 다른 곳
  for (const e of state.players) {
    if (e.id !== p.id && e.alive && circlesOverlap(spot.x, spot.y, PLAYER_RADIUS, e.x, e.y, PLAYER_RADIUS)) {
      spot = farthestSpawn(map, [spot, ...enemies], state.rng, 1)
      break
    }
  }
  placeAt(p, spot)
  p.maxHp = c.maxHp
  p.hp = c.maxHp
  p.alive = true
  p.ammo = w.magSize
  p.reloadTimer = 0
  p.fireCooldown = 0
  p.recoil = 0
  p.dashTimer = 0
  p.dashCooldown = 0
  p.legInjury = 0
  p.invuln = c.id === 'seungwoo' ? SPAWN_PROTECT_TICKS * 2 : SPAWN_PROTECT_TICKS // 승우덕: 스폰 보호 3초
  p.aliveTicks = 0
  p.lastHitTick = -10000
  p.streak = 0
  p.staminaMax = c.staminaMax ?? STAMINA_MAX
  p.stamina = p.staminaMax
  p.blockLock = 0
  p.sprinting = false
  state.events.push({ type: 'respawn', p: p.id, x: p.x, y: p.y })
}

/** 스냅샷 (events 제외) */
export function snapshot(state: GameState): GameState {
  const { events: _e, ...rest } = state
  const copy = structuredClone(rest) as GameState
  copy.events = []
  return copy
}

/** FNV-1a 32비트 해시. 결정론 검증용. */
export function hashState(state: GameState): number {
  const { events: _e, ...rest } = state
  const s = JSON.stringify(rest)
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}
