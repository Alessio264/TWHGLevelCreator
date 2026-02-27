/* =====================================================
   WORLD'S HARDEST GAME – LEVEL EDITOR  (v6)

   Changes:
   - Home screen (level manager) shown on load
   - No pre-made levels when creating a new one (blank canvas)
   - No conveyors
   - Ice: locks direction on entry, player loses control until tile exits
   - Sliders paired with manual number inputs
   - Player speed configurable per level
   - All improvements to intuitiveness
   ===================================================== */

// -------------------------------------------------------
// CONSTANTS
// -------------------------------------------------------
const TILE         = 32;
const PLAYER_SIZE  = 22;
const COIN_RADIUS  = 7;
const ENEMY_RADIUS = 12;

const TILE_EMPTY      = 0;
const TILE_WALL       = 1;
const TILE_GOAL       = 2;
const TILE_ICE        = 3;
const TILE_CHECKPOINT = 4;

const KEY_COLORS = ['#e8c200','#e03030','#2244cc','#20aa40','#cc44cc','#cc7700'];

const COLOR = {
  bg_light:   '#c8d8f0',
  bg_dark:    '#b0c0e0',
  wall:       '#1a1a2e',
  goal:       '#28a845',
  player:     '#e03030',
  coin:       '#f0c020',
  coin_bd:    '#b08010',
  enemy:      '#1a3acc',
  enemy_bd:   '#0d1e88',
  orbit:      '#aa22ee',
  orbit_bd:   '#660099',
  sel_ring:   '#ff6600',
  path_line:  'rgba(255,120,0,0.8)',
  grid_line:  'rgba(100,120,180,0.18)',
  spawn_mark: 'rgba(220,50,50,0.2)',
  ice:        '#a0e0ff',
  ice_bd:     '#60b0e0',
  checkpoint: '#ff8c00',
  checkpoint_bd: '#cc6600',
  checkpoint_done: '#999',
};

// -------------------------------------------------------
// MULTI-LEVEL STATE
// -------------------------------------------------------
let levelCollection = [];
let currentLevelIdx = 0;
let nextLevelId     = 1;

function getCurrentLevel() { return levelCollection[currentLevelIdx]; }

function blankLevelData(name) {
  const cols = 28, rows = 18;
  const g = [];
  for (let r = 0; r < rows; r++) g[r] = new Array(cols).fill(TILE_EMPTY);
  return {
    id: nextLevelId++,
    name: name || ('Level ' + nextLevelId),
    COLS: cols, ROWS: rows,
    grid: g,
    playerSpawn: { gx: 2, gy: Math.floor(rows / 2) },
    coins: [], enemies: [], keys: [], doors: [],
    timeLimit: 0,
    playerSpeed: 120,
    idCounter: 0,
  };
}

function saveCurrentEditorState() {
  const lv = getCurrentLevel();
  if (!lv) return;
  lv.COLS = COLS; lv.ROWS = ROWS;
  lv.grid        = JSON.parse(JSON.stringify(grid));
  lv.playerSpawn = { ...playerSpawn };
  lv.coins       = JSON.parse(JSON.stringify(coins));
  lv.enemies     = JSON.parse(JSON.stringify(enemies));
  lv.keys        = JSON.parse(JSON.stringify(keys));
  lv.doors       = JSON.parse(JSON.stringify(doors));
  lv.timeLimit   = currentTimeLimit;
  lv.playerSpeed = currentPlayerSpeed;
  lv.name        = document.getElementById('current-level-name-input').value.trim() || lv.name;
  lv.idCounter   = idCounter;
}

function loadLevelIntoEditor(lv) {
  COLS = lv.COLS || 28; ROWS = lv.ROWS || 18;
  grid        = JSON.parse(JSON.stringify(lv.grid));
  playerSpawn = { ...lv.playerSpawn };
  coins       = JSON.parse(JSON.stringify(lv.coins   || []));
  enemies     = JSON.parse(JSON.stringify(lv.enemies || []));
  keys        = JSON.parse(JSON.stringify(lv.keys    || []));
  doors       = JSON.parse(JSON.stringify(lv.doors   || []));
  currentTimeLimit   = lv.timeLimit   || 0;
  currentPlayerSpeed = lv.playerSpeed || 120;
  idCounter   = lv.idCounter || 0;

  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      if (grid[r][c] === undefined) grid[r][c] = TILE_EMPTY;

  // Purge old conveyor tile values (4-7 in v5) → empty
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      if (grid[r][c] >= 4 && grid[r][c] <= 7) grid[r][c] = TILE_EMPTY;
  // v5 checkpoint was 8 → now 4
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      if (grid[r][c] === 8) grid[r][c] = TILE_CHECKPOINT;

  document.getElementById('current-level-name-input').value = lv.name || '';
  selectedId = null; selectedType = null;
  undoStack = [];

  updateTimeLimitUI();
  updateSpeedUI();
  resizeCanvas();
  refreshContextPanel();
  drawEditor();
  updateSizeStatus();
}

function normalizeLevelData(data) {
  return {
    id: nextLevelId++,
    name: data.name || 'Imported Level',
    COLS: data.COLS || 28,
    ROWS: data.ROWS || 18,
    grid: data.grid || [],
    playerSpawn: data.playerSpawn || { gx:2, gy:9 },
    coins: data.coins || [],
    enemies: (data.enemies || []).map(en => ({
      keyframes:[], phase:0, forward:true, duration:3, loopMode:false,
      cx:0, cy:0, radius:3*TILE, orbitDuration:4, startAngle:0, clockwise:true, type:'linear',
      ...en,
    })),
    keys:  data.keys  || [],
    doors: data.doors || [],
    timeLimit: data.timeLimit || 0,
    playerSpeed: data.playerSpeed || 120,
    idCounter: data.idCounter || 0,
  };
}

// -------------------------------------------------------
// EDITOR STATE
// -------------------------------------------------------
let COLS = 28, ROWS = 18;
let grid        = [];
let playerSpawn = { gx: 2, gy: 9 };
let coins       = [], enemies = [], keys = [], doors = [];
let idCounter   = 0;
let currentTimeLimit   = 0;
let currentPlayerSpeed = 120;

let selectedId   = null;
let selectedType = null;
let currentTool  = 'wall';

let pathMode = false, pathModeState = 0, pathTemp = null, pathAddKf = false;
let centerMode = false;
let linkDoorMode = false, linkDoorKeyId = null;
let undoStack = [];
const MAX_UNDO = 60;

let playMode = false;

const canvas = document.getElementById('game-canvas');
const ctx    = canvas.getContext('2d');

// -------------------------------------------------------
// PLAY STATE
// -------------------------------------------------------
let player        = null;
let playerVx      = 0, playerVy = 0;
let playerOnIce   = false;   // true while standing on ice
let iceLockedVx   = 0, iceLockedVy = 0;  // the velocity locked at the moment of ice entry
let playerDying   = false;
let deathCooldown = 0;
let playCoins = [], playEnemies = [], playDoors = [], playKeys = [];
let deaths = 0, keysDown = {};
let collectedKeyIds = new Set();
let animFrameId = null, lastTime = 0;
let playTimer = 0;
let checkpointPos = null;

// -------------------------------------------------------
// HELPERS
// -------------------------------------------------------
function newId() { return ++idCounter; }
function initGrid() {
  grid = [];
  for (let r = 0; r < ROWS; r++) grid[r] = new Array(COLS).fill(TILE_EMPTY);
}
function tileCenter(gx, gy) { return { px: gx*TILE + TILE/2, py: gy*TILE + TILE/2 }; }
function inBounds(gx, gy)   { return gx >= 0 && gx < COLS && gy >= 0 && gy < ROWS; }
function mouseToPixel(e) {
  const rect = canvas.getBoundingClientRect(), s = canvas._scale;
  return { px: (e.clientX - rect.left) / s, py: (e.clientY - rect.top) / s };
}
function pixelToGrid(px, py) { return { gx: Math.floor(px/TILE), gy: Math.floor(py/TILE) }; }
function formatTime(s) {
  const m = Math.floor(s/60), sec = Math.floor(s%60);
  return `${m}:${sec.toString().padStart(2,'0')}`;
}
function setStatus(msg) {
  const el = document.getElementById('status-msg'); el.textContent = msg;
  setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 3000);
}
function updateSizeStatus() {
  document.getElementById('status-size').textContent = `${COLS}×${ROWS}`;
}
function isDoorAt(gx, gy) { return doors.some(d => d.gx===gx && d.gy===gy); }
function doorAt(gx, gy)   { return doors.find(d => d.gx===gx && d.gy===gy); }

// -------------------------------------------------------
// CANVAS SIZING
// -------------------------------------------------------
function resizeCanvas() {
  const area = document.getElementById('canvas-area');
  const maxW = area.clientWidth  - 16;
  const maxH = area.clientHeight - 16;
  const scale = Math.min(maxW / (COLS*TILE), maxH / (ROWS*TILE), 1.8);
  canvas.width  = Math.floor(COLS*TILE*scale);
  canvas.height = Math.floor(ROWS*TILE*scale);
  canvas._scale = scale;
}
window.addEventListener('resize', () => { resizeCanvas(); playMode ? drawPlay() : drawEditor(); });

// -------------------------------------------------------
// UNDO
// -------------------------------------------------------
function snapshot() {
  undoStack.push(JSON.stringify({ grid, coins, enemies, keys, doors, playerSpawn, COLS, ROWS }));
  if (undoStack.length > MAX_UNDO) undoStack.shift();
}
function undo() {
  if (!undoStack.length) { setStatus('Nothing to undo.'); return; }
  const s = JSON.parse(undoStack.pop());
  grid = s.grid; coins = s.coins; enemies = s.enemies;
  keys = s.keys||[]; doors = s.doors||[];
  playerSpawn = s.playerSpawn;
  if (s.COLS && s.ROWS) { COLS = s.COLS; ROWS = s.ROWS; }
  selectedId = null; selectedType = null;
  resizeCanvas(); refreshContextPanel(); drawEditor(); updateSizeStatus();
  setStatus('Undo applied.');
}

// -------------------------------------------------------
// FLOOD FILL
// -------------------------------------------------------
function floodFill(gx, gy, targetTile) {
  const startTile = grid[gy][gx];
  if (startTile === targetTile) return;
  snapshot();
  const queue=[{gx,gy}], visited=new Set();
  while (queue.length) {
    const {gx:cx, gy:cy} = queue.shift(), k = cx+','+cy;
    if (visited.has(k) || !inBounds(cx,cy)) continue;
    if (grid[cy][cx] !== startTile) continue;
    visited.add(k); grid[cy][cx] = targetTile;
    if (targetTile !== TILE_EMPTY) {
      coins = coins.filter(c => !(c.gx===cx && c.gy===cy));
      keys  = keys.filter(k => !(k.gx===cx && k.gy===cy));
    }
    queue.push({gx:cx-1,gy:cy},{gx:cx+1,gy:cy},{gx:cx,gy:cy-1},{gx:cx,gy:cy+1});
  }
  drawEditor();
}

// -------------------------------------------------------
// PATH HELPERS
// -------------------------------------------------------
function getWaypoints(en) {
  const wps = [{px:en.x1,py:en.y1}];
  for (const kf of (en.keyframes||[])) wps.push({px:kf.px,py:kf.py});
  wps.push({px:en.x2,py:en.y2}); return wps;
}
function totalPathLength(en) {
  const wps=getWaypoints(en); let len=0;
  for (let i=1;i<wps.length;i++) len+=Math.hypot(wps[i].px-wps[i-1].px, wps[i].py-wps[i-1].py);
  return len;
}
function positionAlongPath(en, t) {
  const wps=getWaypoints(en), total=totalPathLength(en);
  if (total<1) return {px:en.x1,py:en.y1};
  let dist=t*total;
  for (let i=1;i<wps.length;i++) {
    const seg=Math.hypot(wps[i].px-wps[i-1].px, wps[i].py-wps[i-1].py);
    if (dist<=seg || i===wps.length-1) {
      const f=seg>0?Math.min(dist/seg,1):0;
      return {px:wps[i-1].px+(wps[i].px-wps[i-1].px)*f, py:wps[i-1].py+(wps[i].py-wps[i-1].py)*f};
    }
    dist-=seg;
  }
  return {px:en.x2,py:en.y2};
}

// -------------------------------------------------------
// DRAWING — EDITOR
// -------------------------------------------------------
function drawEditor() {
  const s = canvas._scale; ctx.save(); ctx.scale(s,s);
  for (let r=0;r<ROWS;r++) for (let c=0;c<COLS;c++) {
    const t=grid[r][c];
    ctx.fillStyle = (r+c)%2===0 ? COLOR.bg_light : COLOR.bg_dark;
    ctx.fillRect(c*TILE,r*TILE,TILE,TILE);
    if      (t===TILE_WALL)       drawWallTile(c,r);
    else if (t===TILE_GOAL)       drawGoalTile(c,r);
    else if (t===TILE_ICE)        drawIceTile(c,r);
    else if (t===TILE_CHECKPOINT) drawCheckpointTile(c,r,false);
  }
  for (const door of doors)
    drawDoorTile(door.gx, door.gy, door.keyId, door.id===selectedId && selectedType==='door');

  // Grid lines
  ctx.strokeStyle=COLOR.grid_line; ctx.lineWidth=0.5;
  for (let r=0;r<=ROWS;r++) { ctx.beginPath();ctx.moveTo(0,r*TILE);ctx.lineTo(COLS*TILE,r*TILE);ctx.stroke(); }
  for (let c=0;c<=COLS;c++) { ctx.beginPath();ctx.moveTo(c*TILE,0);ctx.lineTo(c*TILE,ROWS*TILE);ctx.stroke(); }

  // Spawn
  ctx.fillStyle=COLOR.spawn_mark; ctx.fillRect(playerSpawn.gx*TILE,playerSpawn.gy*TILE,TILE,TILE);
  const sc=tileCenter(playerSpawn.gx,playerSpawn.gy); renderPlayer(sc.px,sc.py,0.7);

  for (const coin of coins) { const c=tileCenter(coin.gx,coin.gy); renderCoin(c.px,c.py); }
  for (const k of keys) { const c=tileCenter(k.gx,k.gy); renderKey(c.px,c.py,k.color,k.id===selectedId&&selectedType==='key'); }
  for (const en of enemies) drawEnemyEditor(en, en.id===selectedId&&selectedType==='enemy');

  if (pathMode&&pathModeState>=1&&pathTemp) {
    ctx.save(); ctx.globalAlpha=0.85;
    ctx.beginPath();ctx.arc(pathTemp.px,pathTemp.py,8,0,Math.PI*2);
    ctx.fillStyle='#ff6600';ctx.fill();
    ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

function drawWallTile(c,r) {
  ctx.fillStyle=COLOR.wall; ctx.fillRect(c*TILE,r*TILE,TILE,TILE);
  ctx.fillStyle='rgba(255,255,255,0.07)';
  ctx.fillRect(c*TILE+1,r*TILE+1,TILE-2,4); ctx.fillRect(c*TILE+1,r*TILE+1,4,TILE-2);
}
function drawGoalTile(c,r) {
  ctx.fillStyle=COLOR.goal; ctx.fillRect(c*TILE,r*TILE,TILE,TILE);
  ctx.fillStyle='rgba(255,255,255,0.12)'; ctx.fillRect(c*TILE+2,r*TILE+2,TILE-4,TILE/2-2);
}
function drawIceTile(c,r) {
  ctx.fillStyle=COLOR.ice; ctx.fillRect(c*TILE,r*TILE,TILE,TILE);
  ctx.strokeStyle=COLOR.ice_bd; ctx.lineWidth=1.5; ctx.strokeRect(c*TILE+1,r*TILE+1,TILE-2,TILE-2);
  ctx.fillStyle='rgba(255,255,255,0.35)'; ctx.fillRect(c*TILE+3,r*TILE+3,TILE/2,4);
  // snowflake hint
  ctx.fillStyle='rgba(180,230,255,0.8)'; ctx.font='bold 10px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('❄', c*TILE+TILE/2, r*TILE+TILE/2);
}
function drawCheckpointTile(c,r,activated) {
  ctx.fillStyle=activated?COLOR.checkpoint_done:COLOR.checkpoint;
  ctx.fillRect(c*TILE,r*TILE,TILE,TILE);
  ctx.strokeStyle=activated?'#777':COLOR.checkpoint_bd;
  ctx.lineWidth=2; ctx.strokeRect(c*TILE+1,r*TILE+1,TILE-2,TILE-2);
  ctx.fillStyle='rgba(255,255,255,0.8)'; ctx.font='bold 13px Arial';
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('✓', c*TILE+TILE/2, r*TILE+TILE/2);
}
function drawDoorTile(gx,gy,keyId,isSel) {
  const key=keys.find(k=>k.id===keyId), col=key?key.color:'#888';
  ctx.fillStyle=col; ctx.globalAlpha=0.8; ctx.fillRect(gx*TILE,gy*TILE,TILE,TILE); ctx.globalAlpha=1;
  ctx.strokeStyle='rgba(0,0,0,0.3)'; ctx.lineWidth=2; ctx.strokeRect(gx*TILE+1,gy*TILE+1,TILE-2,TILE-2);
  ctx.fillStyle='rgba(0,0,0,0.35)'; ctx.fillRect(gx*TILE+TILE-8,gy*TILE+TILE/2-3,4,6);
  if (isSel) {
    ctx.strokeStyle='#ff6600'; ctx.lineWidth=3; ctx.setLineDash([4,3]);
    ctx.strokeRect(gx*TILE+1.5,gy*TILE+1.5,TILE-3,TILE-3); ctx.setLineDash([]);
  }
}

function drawEnemyEditor(en,isSel) {
  ctx.save();
  if (en.type==='orbit') {
    ctx.globalAlpha=isSel?1:0.5;
    ctx.beginPath();ctx.arc(en.cx,en.cy,en.radius,0,Math.PI*2);
    ctx.strokeStyle='#aa22ee';ctx.lineWidth=isSel?2:1;ctx.setLineDash([5,4]);ctx.stroke();ctx.setLineDash([]);
    ctx.beginPath();ctx.arc(en.cx,en.cy,4,0,Math.PI*2);ctx.fillStyle='#aa22ee';ctx.fill();
    const a=(en.startAngle||0)*Math.PI/180;
    const bx=en.cx+Math.cos(a)*en.radius, by=en.cy+Math.sin(a)*en.radius;
    ctx.globalAlpha=isSel?1:0.7;
    renderEnemy(bx,by,isSel,COLOR.orbit,COLOR.orbit_bd,'#cc88ff');
  } else {
    const wps=getWaypoints(en), hasPath=totalPathLength(en)>2;
    ctx.globalAlpha=isSel?0.95:0.42;
    if (hasPath) {
      ctx.beginPath();ctx.moveTo(wps[0].px,wps[0].py);
      for (let i=1;i<wps.length;i++) ctx.lineTo(wps[i].px,wps[i].py);
      if (en.loopMode) ctx.closePath();
      ctx.strokeStyle=COLOR.path_line;ctx.lineWidth=isSel?2.5:1.5;ctx.setLineDash([6,4]);ctx.stroke();ctx.setLineDash([]);
      ctx.globalAlpha=isSel?1:0.5;
      ctx.beginPath();ctx.arc(en.x1,en.y1,isSel?8:5,0,Math.PI*2);
      ctx.fillStyle='#ff6600';ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=1.5;ctx.stroke();
      if (isSel) { ctx.fillStyle='#fff';ctx.font='bold 7px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('A',en.x1,en.y1); }
      for (let i=0;i<(en.keyframes||[]).length;i++) {
        const kf=en.keyframes[i];ctx.globalAlpha=isSel?1:0.5;
        ctx.beginPath();ctx.arc(kf.px,kf.py,isSel?6:4,0,Math.PI*2);
        ctx.fillStyle='#00bbcc';ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=1.5;ctx.stroke();
        if (isSel) { ctx.fillStyle='#fff';ctx.font='bold 6px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(i+1,kf.px,kf.py); }
      }
      ctx.globalAlpha=isSel?1:0.5;
      ctx.beginPath();ctx.arc(en.x2,en.y2,isSel?8:5,0,Math.PI*2);
      ctx.fillStyle='#ff3399';ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=1.5;ctx.stroke();
      if (isSel) { ctx.fillStyle='#fff';ctx.font='bold 7px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('B',en.x2,en.y2); }
    }
    const sp=positionAlongPath(en,en.phase||0);ctx.globalAlpha=isSel?1:0.65;
    renderEnemy(sp.px,sp.py,isSel,COLOR.enemy,COLOR.enemy_bd,'#6688ff');
  }
  ctx.restore();
}

// -------------------------------------------------------
// RENDERING HELPERS
// -------------------------------------------------------
function renderPlayer(cx,cy,alpha) {
  ctx.globalAlpha=alpha; const h=PLAYER_SIZE/2;
  ctx.fillStyle=COLOR.player; ctx.fillRect(cx-h,cy-h,PLAYER_SIZE,PLAYER_SIZE);
  ctx.strokeStyle='#801010';ctx.lineWidth=2;ctx.strokeRect(cx-h,cy-h,PLAYER_SIZE,PLAYER_SIZE);
  ctx.fillStyle='rgba(255,200,200,0.4)';ctx.fillRect(cx-h+2,cy-h+2,PLAYER_SIZE/2,4);
  ctx.globalAlpha=1;
}
function renderCoin(cx,cy) {
  ctx.beginPath();ctx.arc(cx,cy,COIN_RADIUS,0,Math.PI*2);
  ctx.fillStyle=COLOR.coin;ctx.fill();ctx.strokeStyle=COLOR.coin_bd;ctx.lineWidth=2;ctx.stroke();
  ctx.beginPath();ctx.arc(cx-2,cy-2,COIN_RADIUS/2.5,0,Math.PI*2);
  ctx.fillStyle='rgba(255,255,200,0.6)';ctx.fill();
}
function renderEnemy(cx,cy,selected,col,bd,shine) {
  if (selected) {
    ctx.beginPath();ctx.arc(cx,cy,ENEMY_RADIUS+5,0,Math.PI*2);
    ctx.strokeStyle=COLOR.sel_ring;ctx.lineWidth=3;ctx.stroke();
  }
  ctx.beginPath();ctx.arc(cx+2,cy+2,ENEMY_RADIUS,0,Math.PI*2);
  ctx.fillStyle='rgba(0,0,0,0.2)';ctx.fill();
  ctx.beginPath();ctx.arc(cx,cy,ENEMY_RADIUS,0,Math.PI*2);
  const g=ctx.createRadialGradient(cx-3,cy-3,2,cx,cy,ENEMY_RADIUS);
  g.addColorStop(0,shine);g.addColorStop(1,col);
  ctx.fillStyle=g;ctx.fill();ctx.strokeStyle=bd;ctx.lineWidth=2;ctx.stroke();
  ctx.beginPath();ctx.arc(cx-4,cy-4,3,0,Math.PI*2);
  ctx.fillStyle='rgba(255,255,255,0.6)';ctx.fill();
}
function renderKey(cx,cy,color,selected) {
  ctx.save();ctx.translate(cx,cy);
  if (selected) {
    ctx.beginPath();ctx.arc(0,0,13,0,Math.PI*2);
    ctx.strokeStyle=COLOR.sel_ring;ctx.lineWidth=2.5;ctx.stroke();
  }
  ctx.beginPath();ctx.arc(-3,0,7,0,Math.PI*2);
  ctx.fillStyle=color;ctx.fill();ctx.strokeStyle='rgba(0,0,0,0.4)';ctx.lineWidth=2;ctx.stroke();
  ctx.beginPath();ctx.arc(-3,0,3.5,0,Math.PI*2);ctx.fillStyle='rgba(0,0,0,0.28)';ctx.fill();
  ctx.fillStyle=color;
  ctx.fillRect(4,-2.5,9,5);ctx.fillRect(8,2.5,3,3);ctx.fillRect(11,2.5,2,2);
  ctx.restore();
}

// -------------------------------------------------------
// DRAWING — PLAY MODE
// -------------------------------------------------------
function drawPlay() {
  const s=canvas._scale;ctx.save();ctx.scale(s,s);
  for (let r=0;r<ROWS;r++) for (let c=0;c<COLS;c++) {
    const t=grid[r][c];
    ctx.fillStyle=(r+c)%2===0?COLOR.bg_light:COLOR.bg_dark;
    ctx.fillRect(c*TILE,r*TILE,TILE,TILE);
    if      (t===TILE_WALL)       drawWallTile(c,r);
    else if (t===TILE_GOAL)       drawGoalTile(c,r);
    else if (t===TILE_ICE)        drawIceTile(c,r);
    else if (t===TILE_CHECKPOINT) {
      const activated = checkpointPos && checkpointPos.gx===c && checkpointPos.gy===r;
      drawCheckpointTile(c,r,activated);
    }
  }
  for (const d of playDoors) if (!d.open) {
    const key=keys.find(k=>k.id===d.keyId), col=key?key.color:'#888';
    ctx.fillStyle=col;ctx.globalAlpha=0.85;ctx.fillRect(d.gx*TILE,d.gy*TILE,TILE,TILE);ctx.globalAlpha=1;
    ctx.strokeStyle='rgba(0,0,0,0.3)';ctx.lineWidth=2;ctx.strokeRect(d.gx*TILE+1,d.gy*TILE+1,TILE-2,TILE-2);
    ctx.fillStyle='rgba(0,0,0,0.35)';ctx.fillRect(d.gx*TILE+TILE-8,d.gy*TILE+TILE/2-3,4,6);
  }
  for (const coin of playCoins) { const c=tileCenter(coin.gx,coin.gy);renderCoin(c.px,c.py); }
  for (const k of playKeys) if (!k.collected) renderKey(k.px,k.py,k.color,false);
  for (const en of playEnemies) {
    if (en.type==='orbit') renderEnemy(en.px,en.py,false,COLOR.orbit,COLOR.orbit_bd,'#cc88ff');
    else                   renderEnemy(en.px,en.py,false,COLOR.enemy,COLOR.enemy_bd,'#6688ff');
  }
  if (player && !playerDying) {
    const alpha = deathCooldown>0 ? (Math.sin(deathCooldown*18)*0.5+0.5) : 1;
    renderPlayer(player.x,player.y,alpha);
  }
  ctx.restore();
}

// -------------------------------------------------------
// MOUSE — EDITOR
// -------------------------------------------------------
let isMouseDown=false, lastTileKey=null;

canvas.addEventListener('mousedown', e => {
  if (playMode) return;
  if (centerMode)   { handleCenterClick(e); return; }
  if (pathMode)     { handlePathClick(e); return; }
  if (linkDoorMode) { handleLinkDoorClick(e); return; }
  isMouseDown=true; lastTileKey=null;
  handleEditorClick(e,true);
});
canvas.addEventListener('mousemove', e => {
  if (playMode) return;
  const {px,py}=mouseToPixel(e), {gx,gy}=pixelToGrid(px,py);
  if (inBounds(gx,gy)) document.getElementById('status-grid').textContent=`${gx}, ${gy}`;
  if (pathMode) {
    drawEditor();
    if (pathTemp && inBounds(gx,gy)) {
      const s=canvas._scale; ctx.save();ctx.scale(s,s);
      const tc=tileCenter(gx,gy);
      ctx.beginPath();ctx.moveTo(pathTemp.px,pathTemp.py);ctx.lineTo(tc.px,tc.py);
      ctx.strokeStyle=COLOR.path_line;ctx.lineWidth=2;ctx.setLineDash([6,4]);ctx.globalAlpha=0.7;ctx.stroke();ctx.setLineDash([]);
      ctx.beginPath();ctx.arc(tc.px,tc.py,6,0,Math.PI*2);ctx.fillStyle='#ff3399';ctx.globalAlpha=0.85;ctx.fill();
      ctx.restore();
    }
    return;
  }
  if (!isMouseDown) return;
  handleEditorClick(e,false);
});
canvas.addEventListener('mouseup',    ()=>{isMouseDown=false;lastTileKey=null;});
canvas.addEventListener('mouseleave', ()=>{isMouseDown=false;lastTileKey=null;});

const TOOL_TO_TILE = { wall:TILE_WALL, goal:TILE_GOAL, ice:TILE_ICE, checkpoint:TILE_CHECKPOINT };

function handleEditorClick(e, isFirst) {
  const {px,py}=mouseToPixel(e), {gx,gy}=pixelToGrid(px,py);
  if (!inBounds(gx,gy)) return;
  const tileKey=gx+','+gy;

  if (currentTool==='fill') {
    if (!isFirst) return;
    const targetTile=TOOL_TO_TILE[document.querySelector('.tool-btn.active')?.dataset.tool]??TILE_WALL;
    floodFill(gx,gy,targetTile); return;
  }

  if (TOOL_TO_TILE[currentTool]!==undefined) {
    if (lastTileKey===tileKey) return; lastTileKey=tileKey; snapshot();
    grid[gy][gx]=TOOL_TO_TILE[currentTool];
    doors=doors.filter(d=>!(d.gx===gx&&d.gy===gy));
    if (TOOL_TO_TILE[currentTool]===TILE_WALL) removePlaceables(gx,gy);
    drawEditor(); return;
  }
  if (currentTool==='erase') {
    if (lastTileKey===tileKey) return; lastTileKey=tileKey; snapshot();
    grid[gy][gx]=TILE_EMPTY; doors=doors.filter(d=>!(d.gx===gx&&d.gy===gy));
    removePlaceables(gx,gy); drawEditor(); return;
  }
  if (currentTool==='player') {
    if (!isFirst) return; snapshot(); playerSpawn={gx,gy}; drawEditor(); return;
  }
  if (currentTool==='coin') {
    if (lastTileKey===tileKey) return; lastTileKey=tileKey;
    if (grid[gy][gx]===TILE_WALL||isDoorAt(gx,gy)) return;
    if (coins.some(c=>c.gx===gx&&c.gy===gy)) return;
    snapshot(); coins.push({gx,gy}); drawEditor(); return;
  }
  if (currentTool==='enemy') {
    if (!isFirst) return;
    if (grid[gy][gx]===TILE_WALL) return; snapshot();
    const tc=tileCenter(gx,gy);
    enemies.push({
      id:newId(),type:'linear',gx,gy,
      x1:tc.px,y1:tc.py,x2:tc.px,y2:tc.py,
      keyframes:[],phase:0,forward:true,duration:3,loopMode:false,
      cx:tc.px,cy:tc.py,radius:3*TILE,orbitDuration:4,startAngle:0,clockwise:true,
    });
    drawEditor(); return;
  }
  if (currentTool==='key') {
    if (!isFirst) return;
    if (grid[gy][gx]===TILE_WALL||isDoorAt(gx,gy)) return;
    if (keys.some(k=>k.gx===gx&&k.gy===gy)) return;
    snapshot(); keys.push({id:newId(),gx,gy,color:KEY_COLORS[0]}); drawEditor(); return;
  }
  if (currentTool==='door') {
    if (lastTileKey===tileKey) return; lastTileKey=tileKey;
    if (isDoorAt(gx,gy)) { snapshot();doors=doors.filter(d=>!(d.gx===gx&&d.gy===gy));drawEditor();return; }
    if (grid[gy][gx]===TILE_WALL||grid[gy][gx]===TILE_GOAL) return;
    snapshot(); doors.push({id:newId(),gx,gy,keyId:null}); drawEditor(); return;
  }
  if (currentTool==='select') {
    if (!isFirst) return; selectAt(px,py);
  }
}
function removePlaceables(gx,gy) {
  coins=coins.filter(c=>!(c.gx===gx&&c.gy===gy));
  keys=keys.filter(k=>!(k.gx===gx&&k.gy===gy));
}

// -------------------------------------------------------
// SELECT
// -------------------------------------------------------
function selectAt(px,py) {
  for (const en of enemies) {
    let bx,by;
    if (en.type==='orbit') {
      const a=(en.startAngle||0)*Math.PI/180;
      bx=en.cx+Math.cos(a)*en.radius; by=en.cy+Math.sin(a)*en.radius;
      if (Math.hypot(en.cx-px,en.cy-py)<=8) { selectedId=en.id;selectedType='enemy';refreshContextPanel();drawEditor();return; }
    } else { const sp=positionAlongPath(en,en.phase||0);bx=sp.px;by=sp.py; }
    if (Math.hypot(bx-px,by-py)<=ENEMY_RADIUS+8) { selectedId=en.id;selectedType='enemy';refreshContextPanel();drawEditor();return; }
  }
  for (const k of keys) {
    const c=tileCenter(k.gx,k.gy);
    if (Math.hypot(c.px-px,c.py-py)<=TILE/2) { selectedId=k.id;selectedType='key';refreshContextPanel();drawEditor();return; }
  }
  const {gx,gy}=pixelToGrid(px,py);
  if (inBounds(gx,gy)) { const door=doorAt(gx,gy);if (door){selectedId=door.id;selectedType='door';refreshContextPanel();drawEditor();return;} }
  selectedId=null;selectedType=null;refreshContextPanel();drawEditor();
}

// -------------------------------------------------------
// PATH MODE
// -------------------------------------------------------
function enterPathMode(addingKf) {
  if (!enemies.find(x=>x.id===selectedId)) { setStatus('Select an enemy first.'); return; }
  pathMode=true;pathModeState=0;pathTemp=null;pathAddKf=addingKf;
  canvas.classList.add('path-mode');
  const hint=document.getElementById('path-hint'); hint.classList.remove('hidden');
  if (addingKf) { hint.textContent='Click to place a waypoint.'; document.getElementById('btn-add-keyframe').textContent='Cancel'; }
  else { hint.textContent='Click point A on the canvas.'; document.getElementById('btn-set-path').textContent='Cancel'; }
}
function exitPathMode(cancelled) {
  pathMode=false;pathModeState=0;pathTemp=null;canvas.classList.remove('path-mode');
  document.getElementById('path-hint').classList.add('hidden');
  document.getElementById('btn-set-path').textContent='📍 Set Path (A → B)';
  document.getElementById('btn-add-keyframe').textContent='+ Add Waypoint';
  if (!cancelled) setStatus('Path saved.');
  drawEditor();
}
function handlePathClick(e) {
  const {px,py}=mouseToPixel(e),{gx,gy}=pixelToGrid(px,py);
  if (!inBounds(gx,gy)) return;
  const tc=tileCenter(gx,gy);
  if (pathAddKf) {
    const en=enemies.find(x=>x.id===selectedId);
    if (en) { snapshot();en.keyframes=en.keyframes||[];en.keyframes.push({px:tc.px,py:tc.py});refreshContextPanel(); }
    exitPathMode(false); return;
  }
  if (pathModeState===0) {
    pathTemp={px:tc.px,py:tc.py};pathModeState=1;
    document.getElementById('path-hint').textContent=`A=(${gx},${gy})  Click point B.`;
  } else {
    const en=enemies.find(x=>x.id===selectedId);
    if (en) { snapshot();en.x1=pathTemp.px;en.y1=pathTemp.py;en.x2=tc.px;en.y2=tc.py;en.keyframes=[];refreshContextPanel(); }
    exitPathMode(false);
  }
}
document.getElementById('btn-set-path').addEventListener('click',()=>{ pathMode?exitPathMode(true):enterPathMode(false); });
document.getElementById('btn-add-keyframe').addEventListener('click',()=>{ pathMode?exitPathMode(true):enterPathMode(true); });

// -------------------------------------------------------
// CENTER MODE
// -------------------------------------------------------
function enterCenterMode() {
  centerMode=true;canvas.classList.add('center-mode');
  const h=document.getElementById('center-hint');h.classList.remove('hidden');
  h.textContent='Click anywhere to set the orbit center.';
  document.getElementById('btn-set-center').textContent='Cancel';
}
function exitCenterMode() {
  centerMode=false;canvas.classList.remove('center-mode');
  document.getElementById('center-hint').classList.add('hidden');
  document.getElementById('btn-set-center').textContent='🎯 Set Center Point';
}
function handleCenterClick(e) {
  const {px,py}=mouseToPixel(e),en=enemies.find(o=>o.id===selectedId);
  if (en) { snapshot();en.cx=px;en.cy=py;drawEditor(); }
  exitCenterMode();
}
document.getElementById('btn-set-center').addEventListener('click',()=>{
  if (centerMode){exitCenterMode();return;}
  const en=enemies.find(x=>x.id===selectedId);
  if (!en||en.type!=='orbit'){setStatus('Select an orbit enemy first.');return;}
  enterCenterMode();
});

// -------------------------------------------------------
// LINK DOOR MODE
// -------------------------------------------------------
function enterLinkDoorMode() {
  linkDoorMode=true;linkDoorKeyId=selectedId;
  const h=document.getElementById('link-door-hint');h.classList.remove('hidden');
  h.textContent='Click a door tile to link it to this key.';
  document.getElementById('btn-link-door').textContent='Cancel';
}
function exitLinkDoorMode() {
  linkDoorMode=false;linkDoorKeyId=null;
  document.getElementById('link-door-hint').classList.add('hidden');
  document.getElementById('btn-link-door').textContent='🔗 Link a Door';
}
function handleLinkDoorClick(e) {
  const {px,py}=mouseToPixel(e),{gx,gy}=pixelToGrid(px,py);
  const door=inBounds(gx,gy)?doorAt(gx,gy):null;
  if (door) { snapshot();door.keyId=linkDoorKeyId;setStatus(`Door (${gx},${gy}) linked.`);refreshContextPanel();drawEditor(); }
  else setStatus('That is not a door tile.');
  exitLinkDoorMode();
}
document.getElementById('btn-link-door').addEventListener('click',()=>{
  if (linkDoorMode){exitLinkDoorMode();return;}
  if (!selectedId||selectedType!=='key'){setStatus('Select a key first.');return;}
  enterLinkDoorMode();
});

// -------------------------------------------------------
// CONTEXT PANEL
// -------------------------------------------------------
function refreshContextPanel() {
  document.querySelectorAll('.panel-block').forEach(p=>p.classList.add('hidden'));
  if (!selectedId||!selectedType) { document.getElementById('panel-default').classList.remove('hidden');return; }

  if (selectedType==='enemy') {
    const en=enemies.find(e=>e.id===selectedId); if (!en) { deselect();return; }
    document.getElementById('panel-enemy').classList.remove('hidden');
    const isOrbit=en.type==='orbit';
    document.getElementById('tab-linear').classList.toggle('active',!isOrbit);
    document.getElementById('tab-orbit').classList.toggle('active',isOrbit);
    document.getElementById('linear-settings').classList.toggle('hidden',isOrbit);
    document.getElementById('orbit-settings').classList.toggle('hidden',!isOrbit);
    if (!isOrbit) {
      syncSliderNum('enemy-duration', en.duration||3);
      syncSliderNum('enemy-phase', en.phase||0);
      document.getElementById('mode-bounce').classList.toggle('active',!en.loopMode);
      document.getElementById('mode-loop').classList.toggle('active',!!en.loopMode);
      document.getElementById('dir-fwd').classList.toggle('active',en.forward!==false);
      document.getElementById('dir-bwd').classList.toggle('active',en.forward===false);
      const kfl=document.getElementById('keyframes-list');kfl.innerHTML='';
      (en.keyframes||[]).forEach((kf,i)=>{
        const div=document.createElement('div');div.className='kf-entry';
        const gkf=pixelToGrid(kf.px,kf.py);
        div.innerHTML=`<span>WP${i+1} (${gkf.gx},${gkf.gy})</span>`;
        const btn=document.createElement('button');btn.textContent='✕';
        btn.onclick=()=>{snapshot();en.keyframes.splice(i,1);refreshContextPanel();drawEditor();};
        div.appendChild(btn);kfl.appendChild(div);
      });
      const hasPath=totalPathLength(en)>2;
      const rd=document.getElementById('path-readout');
      if (hasPath) { rd.classList.remove('hidden');document.getElementById('path-readout-text').textContent=`${Math.round(totalPathLength(en))}px · ${(en.keyframes||[]).length} WPs`; }
      else rd.classList.add('hidden');
    } else {
      syncSliderNum('orbit-radius', en.radius/TILE);
      syncSliderNum('orbit-duration', en.orbitDuration||4);
      syncSliderNum('orbit-angle', en.startAngle||0);
      document.getElementById('orbit-cw').classList.toggle('active',en.clockwise!==false);
      document.getElementById('orbit-ccw').classList.toggle('active',en.clockwise===false);
    }
  } else if (selectedType==='key') {
    const k=keys.find(x=>x.id===selectedId); if (!k){deselect();return;}
    document.getElementById('panel-key').classList.remove('hidden');
    document.querySelectorAll('#key-color-swatches .color-swatch').forEach(sw=>{
      sw.classList.toggle('active',sw.dataset.color===k.color);
    });
    const linked=doors.filter(d=>d.keyId===k.id);
    const dl=document.getElementById('key-doors-list');dl.innerHTML='';
    if (!linked.length) {
      const p=document.createElement('p');p.className='inst-text';p.textContent='No doors linked.';dl.appendChild(p);
    } else linked.forEach(d=>{
      const div=document.createElement('div');div.className='door-entry';
      div.innerHTML=`<span>Door (${d.gx},${d.gy})</span>`;
      const btn=document.createElement('button');btn.textContent='✕';
      btn.onclick=()=>{snapshot();d.keyId=null;refreshContextPanel();drawEditor();};
      div.appendChild(btn);dl.appendChild(div);
    });
  } else if (selectedType==='door') {
    const door=doors.find(d=>d.id===selectedId); if (!door){deselect();return;}
    document.getElementById('panel-door').classList.remove('hidden');
    const k=keys.find(x=>x.id===door.keyId);
    const val=document.getElementById('door-key-val');
    val.textContent=k?`Key (${k.gx},${k.gy})`:'None'; val.style.color=k?k.color:'';
  }
}
function deselect() {
  selectedId=null;selectedType=null;
  document.querySelectorAll('.panel-block').forEach(p=>p.classList.add('hidden'));
  document.getElementById('panel-default').classList.remove('hidden');
}

// Sync a slider+number pair to a value
function syncSliderNum(id, val) {
  const slider=document.getElementById(id), num=document.getElementById(id+'-num');
  if (slider) slider.value=val;
  if (num) num.value=val;
}

// Helper: bind a slider+num pair together
function bindSliderNum(id, onChange) {
  const slider=document.getElementById(id), num=document.getElementById(id+'-num');
  if (!slider||!num) return;
  slider.addEventListener('input',()=>{ num.value=slider.value; onChange(parseFloat(slider.value)); });
  num.addEventListener('change',()=>{
    let v=parseFloat(num.value);
    if (isNaN(v)) v=parseFloat(slider.min)||0;
    v=Math.max(parseFloat(slider.min)||0, Math.min(parseFloat(slider.max)||9999, v));
    slider.value=v; num.value=v; onChange(v);
  });
}

// -------------------------------------------------------
// PANEL CONTROLS
// -------------------------------------------------------
document.getElementById('tab-linear').addEventListener('click',()=>{
  const en=enemies.find(x=>x.id===selectedId);if (!en) return;
  snapshot();en.type='linear';refreshContextPanel();drawEditor();
});
document.getElementById('tab-orbit').addEventListener('click',()=>{
  const en=enemies.find(x=>x.id===selectedId);if (!en) return;
  snapshot();en.type='orbit';refreshContextPanel();drawEditor();
});

bindSliderNum('enemy-duration', v=>{ const en=enemies.find(x=>x.id===selectedId);if (en) en.duration=v; });
bindSliderNum('enemy-phase', v=>{ const en=enemies.find(x=>x.id===selectedId);if (en){en.phase=v;drawEditor();} });
bindSliderNum('orbit-radius', v=>{ const en=enemies.find(o=>o.id===selectedId);if (en){en.radius=v*TILE;drawEditor();} });
bindSliderNum('orbit-duration', v=>{ const en=enemies.find(o=>o.id===selectedId);if (en) en.orbitDuration=v; });
bindSliderNum('orbit-angle', v=>{ const en=enemies.find(o=>o.id===selectedId);if (en){en.startAngle=v;drawEditor();} });

document.getElementById('mode-bounce').addEventListener('click',()=>{
  const en=enemies.find(x=>x.id===selectedId);if (!en) return;
  en.loopMode=false;document.getElementById('mode-bounce').classList.add('active');document.getElementById('mode-loop').classList.remove('active');
});
document.getElementById('mode-loop').addEventListener('click',()=>{
  const en=enemies.find(x=>x.id===selectedId);if (!en) return;
  en.loopMode=true;document.getElementById('mode-loop').classList.add('active');document.getElementById('mode-bounce').classList.remove('active');
});
document.getElementById('dir-fwd').addEventListener('click',()=>{
  const en=enemies.find(x=>x.id===selectedId);if (!en) return;
  en.forward=true;document.getElementById('dir-fwd').classList.add('active');document.getElementById('dir-bwd').classList.remove('active');drawEditor();
});
document.getElementById('dir-bwd').addEventListener('click',()=>{
  const en=enemies.find(x=>x.id===selectedId);if (!en) return;
  en.forward=false;document.getElementById('dir-fwd').classList.remove('active');document.getElementById('dir-bwd').classList.add('active');drawEditor();
});
document.getElementById('btn-delete-enemy').addEventListener('click',()=>{
  snapshot();enemies=enemies.filter(e=>e.id!==selectedId);
  if (pathMode) exitPathMode(true); if (centerMode) exitCenterMode();
  selectedId=null;selectedType=null;refreshContextPanel();drawEditor();
});
document.getElementById('orbit-cw').addEventListener('click',()=>{
  const en=enemies.find(o=>o.id===selectedId);if (!en) return;
  en.clockwise=true;document.getElementById('orbit-cw').classList.add('active');document.getElementById('orbit-ccw').classList.remove('active');
});
document.getElementById('orbit-ccw').addEventListener('click',()=>{
  const en=enemies.find(o=>o.id===selectedId);if (!en) return;
  en.clockwise=false;document.getElementById('orbit-cw').classList.remove('active');document.getElementById('orbit-ccw').classList.add('active');
});
document.querySelectorAll('#key-color-swatches .color-swatch').forEach(sw=>{
  sw.addEventListener('click',()=>{
    const k=keys.find(x=>x.id===selectedId);if (!k) return;
    snapshot();k.color=sw.dataset.color;
    document.querySelectorAll('#key-color-swatches .color-swatch').forEach(s=>s.classList.remove('active'));
    sw.classList.add('active');drawEditor();
  });
});
document.getElementById('btn-delete-key').addEventListener('click',()=>{
  snapshot();doors.forEach(d=>{if (d.keyId===selectedId) d.keyId=null;});
  keys=keys.filter(k=>k.id!==selectedId);selectedId=null;selectedType=null;
  if (linkDoorMode) exitLinkDoorMode();refreshContextPanel();drawEditor();
});
document.getElementById('btn-delete-door').addEventListener('click',()=>{
  const door=doors.find(d=>d.id===selectedId);if (!door) return;
  snapshot();doors=doors.filter(d=>d.id!==selectedId);selectedId=null;selectedType=null;refreshContextPanel();drawEditor();
});

// -------------------------------------------------------
// TOOL BUTTONS
// -------------------------------------------------------
document.querySelectorAll('.tool-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    if (playMode) return;
    currentTool=btn.dataset.tool;
    document.querySelectorAll('.tool-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('status-tool').textContent='Tool: '+btn.querySelector('.tool-label').textContent.trim();
    if (currentTool!=='select') {
      if (pathMode) exitPathMode(true);
      if (centerMode) exitCenterMode();
      if (linkDoorMode) exitLinkDoorMode();
      selectedId=null;selectedType=null;refreshContextPanel();drawEditor();
    }
  });
});

const TOOL_KEYS = {
  '1':'wall','2':'erase','3':'goal','4':'player','5':'coin',
  '6':'enemy','7':'key','8':'door','9':'ice','k':'checkpoint',
  's':'select','f':'fill',
};

// -------------------------------------------------------
// TIME LIMIT + SPEED UI
// -------------------------------------------------------
function updateTimeLimitUI() {
  const isOn=currentTimeLimit>0;
  document.getElementById('timelimit-off').classList.toggle('active',!isOn);
  document.getElementById('timelimit-on').classList.toggle('active',isOn);
  const row=document.getElementById('timelimit-row');
  if (isOn) {
    row.classList.remove('hidden');
    syncSliderNum('timelimit',currentTimeLimit);
  } else row.classList.add('hidden');
}
function updateSpeedUI() {
  syncSliderNum('speed',currentPlayerSpeed);
}
document.getElementById('timelimit-off').addEventListener('click',()=>{ currentTimeLimit=0;updateTimeLimitUI(); });
document.getElementById('timelimit-on').addEventListener('click',()=>{ if(!currentTimeLimit)currentTimeLimit=60;updateTimeLimitUI(); });
bindSliderNum('timelimit',v=>{ currentTimeLimit=v; });
bindSliderNum('speed',v=>{ currentPlayerSpeed=v; });

// -------------------------------------------------------
// SIDEBAR TOGGLE
// -------------------------------------------------------
let sidebarVisible=true;
document.getElementById('btn-sidebar-toggle').addEventListener('click',toggleSidebar);
function toggleSidebar() {
  sidebarVisible=!sidebarVisible;
  document.getElementById('toolbar').classList.toggle('collapsed',!sidebarVisible);
  setTimeout(()=>{ resizeCanvas(); playMode?drawPlay():drawEditor(); },230);
}

// -------------------------------------------------------
// KEYBOARD
// -------------------------------------------------------
document.addEventListener('keydown', e=>{
  if (e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA') return;
  if (playMode) {
    keysDown[e.key]=true;
    if (e.key==='r'||e.key==='R') { resetPlayState();return; }
    if (e.key==='Escape') { stopPlay();return; }
    return;
  }
  if (e.key==='Tab') { e.preventDefault();toggleSidebar();return; }
  if (e.key==='Escape') {
    if (pathMode){exitPathMode(true);return;}
    if (centerMode){exitCenterMode();return;}
    if (linkDoorMode){exitLinkDoorMode();return;}
  }
  if ((e.ctrlKey||e.metaKey)&&e.key==='z') { e.preventDefault();undo();return; }
  const toolFor=TOOL_KEYS[e.key.toLowerCase()];
  if (toolFor&&!e.ctrlKey&&!e.metaKey) {
    const btn=document.querySelector(`.tool-btn[data-tool="${toolFor}"]`);
    if (btn) btn.click();
  }
});
document.addEventListener('keyup',e=>{ keysDown[e.key]=false; });

// -------------------------------------------------------
// GRID RESIZE
// -------------------------------------------------------
document.getElementById('btn-resize').addEventListener('click',()=>{
  const body=document.getElementById('modal-body');
  body.innerHTML=`
    <div class="resize-controls">
      <div class="resize-row"><label>Columns:</label><input type="number" id="inp-cols" min="4" max="80" value="${COLS}" /></div>
      <div class="resize-row"><label>Rows:</label><input type="number" id="inp-rows" min="4" max="50" value="${ROWS}" /></div>
      <p class="resize-note">Shrinking crops the level and removes out-of-bounds objects.</p>
    </div>`;
  document.getElementById('modal-title').textContent='Change Grid Size';
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('modal-confirm').textContent='Apply';
  document.getElementById('modal-confirm').onclick=()=>{
    const nc=Math.max(4,Math.min(80,parseInt(document.getElementById('inp-cols').value)||COLS));
    const nr=Math.max(4,Math.min(50,parseInt(document.getElementById('inp-rows').value)||ROWS));
    applyGridResize(nc,nr);
    document.getElementById('modal-overlay').classList.add('hidden');
  };
});
function applyGridResize(nc,nr) {
  snapshot();
  const ng=[];
  for (let r=0;r<nr;r++) { ng[r]=[];for (let c=0;c<nc;c++) ng[r][c]=(r<ROWS&&c<COLS)?grid[r][c]:TILE_EMPTY; }
  COLS=nc;ROWS=nr;grid=ng;
  playerSpawn.gx=Math.min(playerSpawn.gx,COLS-1); playerSpawn.gy=Math.min(playerSpawn.gy,ROWS-1);
  coins=coins.filter(c=>inBounds(c.gx,c.gy));keys=keys.filter(k=>inBounds(k.gx,k.gy));
  doors=doors.filter(d=>inBounds(d.gx,d.gy));
  enemies=enemies.filter(en=>en.type==='orbit'||inBounds(Math.floor(en.x1/TILE),Math.floor(en.y1/TILE)));
  resizeCanvas();drawEditor();updateSizeStatus();setStatus(`Grid resized to ${COLS}×${ROWS}.`);
}

// -------------------------------------------------------
// TOP BAR
// -------------------------------------------------------
document.getElementById('btn-undo').addEventListener('click',undo);
document.getElementById('btn-clear').addEventListener('click',()=>{
  if (!confirm('Clear the entire level?')) return;
  undoStack=[];initGrid();coins=[];enemies=[];keys=[];doors=[];
  playerSpawn={gx:2,gy:Math.floor(ROWS/2)};selectedId=null;selectedType=null;
  if (pathMode) exitPathMode(true);if (centerMode) exitCenterMode();if (linkDoorMode) exitLinkDoorMode();
  refreshContextPanel();drawEditor();setStatus('Level cleared.');
});
document.getElementById('btn-play').addEventListener('click',togglePlay);

// Level name sync
document.getElementById('current-level-name-input').addEventListener('input', e=>{
  const lv=getCurrentLevel();if (lv) lv.name=e.target.value;
  renderHomeScreen();
});

// Export current level
document.getElementById('btn-save').addEventListener('click',()=>{
  saveCurrentEditorState();
  const lv=getCurrentLevel();
  const json=JSON.stringify(lv, null, 2);
  const body=document.getElementById('modal-body');
  body.innerHTML='<textarea spellcheck="false" readonly></textarea>';
  body.querySelector('textarea').value=json;
  document.getElementById('modal-title').textContent='Export Level JSON';
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('modal-confirm').textContent='Copy to Clipboard';
  document.getElementById('modal-confirm').onclick=()=>{
    navigator.clipboard.writeText(json).catch(()=>{});
    document.getElementById('modal-overlay').classList.add('hidden');
    setStatus('Copied to clipboard.');
  };
});

document.getElementById('modal-cancel').addEventListener('click',()=>{
  document.getElementById('modal-overlay').classList.add('hidden');
});

// -------------------------------------------------------
// HOME SCREEN
// -------------------------------------------------------
function showHomeScreen() {
  // Main menu
  if (playMode) stopPlay();
  if (currentLevelIdx >= 0 && levelCollection.length > 0) saveCurrentEditorState();
  document.getElementById('editor-screen').classList.add('hidden');
  document.getElementById('create-screen').classList.add('hidden');
  document.getElementById('online-screen').classList.add('hidden');
  document.getElementById('home-screen').classList.remove('hidden');
}

function showCreateScreen() {
  document.getElementById('home-screen').classList.add('hidden');
  document.getElementById('create-screen').classList.remove('hidden');
  renderHomeScreen();
}

function openEditor(idx) {
  currentLevelIdx = idx;
  document.getElementById('home-screen').classList.add('hidden');
  document.getElementById('create-screen').classList.add('hidden');
  document.getElementById('editor-screen').classList.remove('hidden');
  loadLevelIntoEditor(levelCollection[idx]);
}

function renderHomeScreen() {
  const list = document.getElementById('home-levels-list');
  const empty = document.getElementById('home-empty');
  list.innerHTML = '';

  if (levelCollection.length === 0) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  document.getElementById('home-levels-count').textContent = `Your Levels (${levelCollection.length})`;

  levelCollection.forEach((lv, idx) => {
    const card = document.createElement('div');
    card.className = 'home-level-card';
    const coinCount = (lv.coins||[]).length;
    const enemyCount = (lv.enemies||[]).length;
    const meta = [
      `${lv.COLS}×${lv.ROWS}`,
      coinCount ? `${coinCount} coin${coinCount!==1?'s':''}` : '',
      enemyCount ? `${enemyCount} enem${enemyCount!==1?'ies':'y'}` : '',
      lv.timeLimit ? `${lv.timeLimit}s limit` : '',
    ].filter(Boolean).join(' · ');

    card.innerHTML = `
      <div class="home-level-num">${idx+1}</div>
      <div class="home-level-info">
        <div class="home-level-name">${escHtml(lv.name||'Untitled')}</div>
        <div class="home-level-meta">${meta||'Empty level'}</div>
      </div>
      <div class="home-level-actions">
        <button class="home-level-btn play-btn" title="Play">▶</button>
        <button class="home-level-btn" title="Edit">✏</button>
        <button class="home-level-btn" title="Duplicate">⧉</button>
        <button class="home-level-btn del-btn" title="Delete">🗑</button>
      </div>`;

    card.querySelector('.play-btn').addEventListener('click', e => { e.stopPropagation(); playLevelFromHome(idx); });
    card.querySelectorAll('.home-level-btn')[1].addEventListener('click', e => { e.stopPropagation(); openEditor(idx); });
    card.querySelectorAll('.home-level-btn')[2].addEventListener('click', e => { e.stopPropagation(); duplicateLevel(idx); });
    card.querySelector('.del-btn').addEventListener('click', e => { e.stopPropagation(); deleteLevel(idx); });
    card.addEventListener('click', () => openEditor(idx));
    list.appendChild(card);
  });
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function playLevelFromHome(idx) {
  openEditor(idx);
  // wait one frame for editor to initialize
  requestAnimationFrame(()=>startPlay());
}

function duplicateLevel(idx) {
  const copy = JSON.parse(JSON.stringify(levelCollection[idx]));
  copy.id = nextLevelId++;
  copy.name = copy.name + ' copy';
  levelCollection.splice(idx+1, 0, copy);
  renderHomeScreen();
  setStatus('Level duplicated.');
}
function deleteLevel(idx) {
  if (!confirm(`Delete "${levelCollection[idx].name}"?`)) return;
  levelCollection.splice(idx, 1);
  if (currentLevelIdx >= levelCollection.length) currentLevelIdx = Math.max(0, levelCollection.length-1);
  renderHomeScreen();
}

document.getElementById('btn-home').addEventListener('click', showHomeScreen);

document.getElementById('home-btn-new').addEventListener('click', () => {
  const lv = blankLevelData('Level ' + (levelCollection.length + 1));
  levelCollection.push(lv);
  openEditor(levelCollection.length - 1);
});

document.getElementById('create-btn-back').addEventListener('click', showHomeScreen);

// Import
function openImportModal(onSuccess) {
  const body = document.getElementById('modal-body');
  body.innerHTML = '<textarea spellcheck="false" placeholder="Paste JSON here (single level or full collection)..."></textarea>';
  document.getElementById('modal-title').textContent = 'Import Level(s)';
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('modal-confirm').textContent = 'Import';
  document.getElementById('modal-confirm').onclick = () => {
    try {
      const data = JSON.parse(body.querySelector('textarea').value);
      if (data.levels && Array.isArray(data.levels)) {
        data.levels.forEach(lv => levelCollection.push(normalizeLevelData(lv)));
        setStatus(`Imported ${data.levels.length} level(s).`);
      } else if (data.grid) {
        levelCollection.push(normalizeLevelData(data));
        setStatus('Level imported.');
      } else throw new Error('Unrecognized format.');
      document.getElementById('modal-overlay').classList.add('hidden');
      if (onSuccess) onSuccess();
    } catch(err) { alert('Could not import: '+err.message); }
  };
}

// Export all
function exportAll() {
  saveCurrentEditorState();
  const json = JSON.stringify({ version:6, levels:levelCollection }, null, 2);
  const body = document.getElementById('modal-body');
  body.innerHTML = '<textarea spellcheck="false" readonly></textarea>';
  body.querySelector('textarea').value = json;
  document.getElementById('modal-title').textContent = 'Export All Levels';
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('modal-confirm').textContent = 'Copy to Clipboard';
  document.getElementById('modal-confirm').onclick = () => {
    navigator.clipboard.writeText(json).catch(()=>{});
    document.getElementById('modal-overlay').classList.add('hidden');
    setStatus('Copied to clipboard.');
  };
}

document.getElementById('home-btn-import').addEventListener('click', () => openImportModal(renderHomeScreen));
document.getElementById('home-btn-save-all').addEventListener('click', exportAll);

// -------------------------------------------------------
// PLAY MODE
// -------------------------------------------------------
function togglePlay() { playMode ? stopPlay() : startPlay(); }

function startPlay() {
  saveCurrentEditorState();
  playMode=true;
  if (pathMode) exitPathMode(true);if (centerMode) exitCenterMode();if (linkDoorMode) exitLinkDoorMode();
  const btn=document.getElementById('btn-play');
  btn.textContent='■ Stop'; btn.style.cssText='background:#cc2222;border-color:#991111;color:#fff;';
  document.getElementById('hud').classList.remove('hidden');
  document.getElementById('win-overlay').classList.add('hidden');
  deaths=0;playTimer=0;
  buildPlayState();lastTime=0;
  canvas.style.cursor='default';
  document.getElementById('statusbar').style.display='none';
  if (animFrameId) cancelAnimationFrame(animFrameId);
  animFrameId=requestAnimationFrame(ts=>{lastTime=ts;gameLoop(ts);});
}

function stopPlay() {
  playMode=false;
  if (animFrameId){cancelAnimationFrame(animFrameId);animFrameId=null;}
  const btn=document.getElementById('btn-play');
  btn.textContent='▶ Play';btn.style.cssText='';
  document.getElementById('hud').classList.add('hidden');
  document.getElementById('win-overlay').classList.add('hidden');
  canvas.style.cursor='crosshair';
  document.getElementById('statusbar').style.display='';
  playerDying=false;playerOnIce=false;
  document.getElementById('death-flash').classList.remove('active');
  drawEditor();
}

function buildPlayState() {
  playCoins=coins.map(c=>({...c}));
  playKeys=keys.map(k=>{const c=tileCenter(k.gx,k.gy);return{...k,px:c.px,py:c.py,collected:false};});
  playDoors=doors.map(d=>({...d,open:false}));
  collectedKeyIds=new Set(); checkpointPos=null;
  playerVx=0;playerVy=0;playerOnIce=false;iceLockedVx=0;iceLockedVy=0;
  playerDying=false;deathCooldown=0;
  playEnemies=enemies.map(en=>{
    if (en.type==='orbit') {
      const a=(en.startAngle||0)*Math.PI/180;
      const angularSpeed=(2*Math.PI)/(en.orbitDuration||4)*(en.clockwise!==false?1:-1);
      return{...en,angle:a,angularSpeed,px:en.cx+Math.cos(a)*en.radius,py:en.cy+Math.sin(a)*en.radius};
    } else {
      const len=totalPathLength(en),sp=positionAlongPath(en,en.phase||0);
      const speed=len>0?len/(en.duration||3):60;
      const dir=en.forward!==false?1:-1;
      return{...en,px:sp.px,py:sp.py,t:(en.phase||0)*len,dir,speed,len};
    }
  });
  keysDown={};
  resetPlayerPos();updateHUD();
}

function resetPlayState() {
  const cp=checkpointPos,d=deaths,t=playTimer;
  buildPlayState();checkpointPos=cp;deaths=d;playTimer=t;
  if (cp) {const c=tileCenter(cp.gx,cp.gy);player={x:c.px,y:c.py};}
  updateHUD();
}
function resetPlayerPos() {
  const spawn=checkpointPos||playerSpawn;
  const c=tileCenter(spawn.gx,spawn.gy);
  player={x:c.px,y:c.py};playerVx=0;playerVy=0;
  playerOnIce=false;iceLockedVx=0;iceLockedVy=0;
  document.getElementById('hud-msg').textContent='';
}

// -------------------------------------------------------
// GAME LOOP
// -------------------------------------------------------
function gameLoop(ts) {
  if (!playMode) return;
  const dt=Math.min((ts-lastTime)/1000,0.05);lastTime=ts;
  updatePlay(dt);drawPlay();
  animFrameId=requestAnimationFrame(gameLoop);
}

function updatePlay(dt) {
  if (!player||playerDying) return;

  // Timer
  playTimer+=dt;
  if (currentTimeLimit>0) {
    const remaining=currentTimeLimit-playTimer;
    const tel=document.getElementById('hud-timer');
    tel.classList.remove('hidden');
    if (remaining<=0) { tel.textContent='0:00';tel.classList.add('urgent');die();return; }
    tel.textContent=formatTime(remaining);
    tel.classList.toggle('urgent',remaining<10);
  } else document.getElementById('hud-timer').classList.add('hidden');

  // Where is the player tile?
  const half=PLAYER_SIZE/2;
  const pgx=Math.floor(player.x/TILE), pgy=Math.floor(player.y/TILE);
  const currentTileType=inBounds(pgx,pgy)?grid[pgy][pgx]:TILE_EMPTY;
  const nowOnIce=currentTileType===TILE_ICE;

  // ICE MECHANIC:
  // When entering ice: lock in current velocity direction. Player loses input control.
  // When leaving ice: restore normal input.
  if (nowOnIce && !playerOnIce) {
    // Just stepped onto ice — lock direction
    playerOnIce=true;
    const speed=Math.hypot(playerVx,playerVy);
    if (speed>5) {
      // preserve the direction we entered with
      iceLockedVx=playerVx;
      iceLockedVy=playerVy;
    } else {
      // standing still onto ice — use last input direction
      let ix=0,iy=0;
      if (keysDown['ArrowLeft']||keysDown['a']||keysDown['A']) ix=-1;
      if (keysDown['ArrowRight']||keysDown['d']||keysDown['D']) ix=1;
      if (keysDown['ArrowUp']||keysDown['w']||keysDown['W']) iy=-1;
      if (keysDown['ArrowDown']||keysDown['s']||keysDown['S']) iy=1;
      if (ix||iy) {
        const f=ix&&iy?1/Math.SQRT2:1;
        iceLockedVx=ix*f*currentPlayerSpeed;
        iceLockedVy=iy*f*currentPlayerSpeed;
      } else {
        // No input — slide with no velocity (player stays put if they walk onto ice without moving)
        iceLockedVx=0; iceLockedVy=0;
      }
    }
  } else if (!nowOnIce && playerOnIce) {
    // Just left ice — restore normal control
    playerOnIce=false;
    playerVx=0;playerVy=0;
  }

  // Movement
  if (playerOnIce) {
    playerVx=iceLockedVx;
    playerVy=iceLockedVy;
  } else {
    let ix=0,iy=0;
    if (keysDown['ArrowLeft']||keysDown['a']||keysDown['A']) ix=-1;
    if (keysDown['ArrowRight']||keysDown['d']||keysDown['D']) ix=1;
    if (keysDown['ArrowUp']||keysDown['w']||keysDown['W']) iy=-1;
    if (keysDown['ArrowDown']||keysDown['s']||keysDown['S']) iy=1;
    if (ix&&iy){const f=1/Math.SQRT2;ix*=f;iy*=f;}
    playerVx=ix*currentPlayerSpeed;
    playerVy=iy*currentPlayerSpeed;
  }

  // Try to move
  const dx=playerVx*dt,dy=playerVy*dt;
  const newX=moveAxis(player.x,player.y,dx,0).x;
  const newY=moveAxis(newX,player.y,0,dy).y;

  // If on ice and we hit a wall, stop ice sliding
  if (playerOnIce) {
    if (newX===player.x && dx!==0) { iceLockedVx=0; }
    if (newY===player.y && dy!==0) { iceLockedVy=0; }
    // If both components are 0, ice effect is done
    if (iceLockedVx===0 && iceLockedVy===0) { playerOnIce=false; }
  }

  player.x=newX;player.y=newY;
  player.x=Math.max(half,Math.min(COLS*TILE-half,player.x));
  player.y=Math.max(half,Math.min(ROWS*TILE-half,player.y));

  // Update enemies
  for (const en of playEnemies) {
    if (en.type==='orbit') {
      en.angle+=en.angularSpeed*dt;
      en.px=en.cx+Math.cos(en.angle)*en.radius;
      en.py=en.cy+Math.sin(en.angle)*en.radius;
    } else {
      if (en.len<1) continue;
      if (en.loopMode) { en.t=(en.t+en.speed*dt)%en.len; }
      else {
        en.t+=en.speed*dt*en.dir;
        if (en.t>=en.len){en.t=en.len;en.dir=-1;}
        if (en.t<=0){en.t=0;en.dir=1;}
      }
      const pos=positionAlongPath(en,en.t/en.len);
      en.px=pos.px;en.py=pos.py;
    }
  }

  // Coins
  playCoins=playCoins.filter(coin=>{
    const c=tileCenter(coin.gx,coin.gy);
    return Math.hypot(player.x-c.px,player.y-c.py)>COIN_RADIUS+half-3;
  });

  // Keys
  for (const k of playKeys) {
    if (k.collected) continue;
    if (Math.hypot(player.x-k.px,player.y-k.py)<TILE/2+4) {
      k.collected=true;collectedKeyIds.add(k.id);
      for (const d of playDoors) if (d.keyId===k.id) d.open=true;
      flashMsg('🔑 Key collected!',900);
    }
  }

  // Checkpoint
  const cpgx=Math.floor(player.x/TILE),cpgy=Math.floor(player.y/TILE);
  if (inBounds(cpgx,cpgy)&&grid[cpgy][cpgx]===TILE_CHECKPOINT) {
    if (!checkpointPos||checkpointPos.gx!==cpgx||checkpointPos.gy!==cpgy) {
      checkpointPos={gx:cpgx,gy:cpgy};
      flashMsg('🏁 Checkpoint!',900);
    }
  }

  // Enemy collision
  if (deathCooldown>0) { deathCooldown-=dt; }
  else {
    for (const en of playEnemies) {
      if (Math.hypot(player.x-en.px,player.y-en.py)<ENEMY_RADIUS+half-3) { die();return; }
    }
  }

  // Goal
  if (inBounds(pgx,pgy)&&grid[pgy][pgx]===TILE_GOAL&&playCoins.length===0) { win();return; }

  updateHUD();
}

function flashMsg(msg,ms) {
  document.getElementById('hud-msg').textContent=msg;
  setTimeout(()=>{if (playMode) document.getElementById('hud-msg').textContent='';},ms);
}

function die() {
  deaths++;playerDying=true;
  const flash=document.getElementById('death-flash');
  flash.classList.remove('active');void flash.offsetWidth;flash.classList.add('active');
  document.getElementById('hud-msg').textContent='☠';
  setTimeout(()=>{
    if (!playMode) return;
    playerDying=false;
    const spawn=checkpointPos||playerSpawn;
    const c=tileCenter(spawn.gx,spawn.gy);
    player={x:c.px,y:c.py};playerVx=0;playerVy=0;
    playerOnIce=false;iceLockedVx=0;iceLockedVy=0;
    deathCooldown=0.6;
    // Reset enemies & items, keep checkpoint & deaths & timer
    const cp=checkpointPos,d=deaths,t=playTimer;
    buildPlayState();checkpointPos=cp;deaths=d;playTimer=t;
    const c2=tileCenter((cp||playerSpawn).gx,(cp||playerSpawn).gy);
    player={x:c2.px,y:c2.py};deathCooldown=0.6;
    document.getElementById('hud-msg').textContent='';
    updateHUD();
  },500);
}

function win() {
  cancelAnimationFrame(animFrameId);animFrameId=null;
  playMode=false;  // fully stop so no timer ticks
  const finalTime=playTimer;  // capture before anything resets it
  const lv=getCurrentLevel();
  document.getElementById('win-level-name').textContent=lv?lv.name:'';
  document.getElementById('win-deaths').textContent=deaths;
  document.getElementById('win-time').textContent=formatTime(finalTime);
  document.getElementById('win-overlay').classList.remove('hidden');
}

document.getElementById('btn-win-edit').addEventListener('click',()=>{
  document.getElementById('win-overlay').classList.add('hidden');
  // playMode is already false after win(); just restore editor visuals
  const btn=document.getElementById('btn-play');
  btn.textContent='▶ Play';btn.style.cssText='';
  document.getElementById('hud').classList.add('hidden');
  canvas.style.cursor='crosshair';
  document.getElementById('statusbar').style.display='';
  playerDying=false;playerOnIce=false;
  document.getElementById('death-flash').classList.remove('active');
  drawEditor();
});
document.getElementById('btn-win-retry').addEventListener('click',()=>{
  document.getElementById('win-overlay').classList.add('hidden');
  deaths=0;playTimer=0;playMode=true;buildPlayState();
  document.getElementById('hud').classList.remove('hidden');
  if (!animFrameId) animFrameId=requestAnimationFrame(ts=>{lastTime=ts;gameLoop(ts);});
});
document.getElementById('btn-win-home').addEventListener('click',()=>{
  document.getElementById('win-overlay').classList.add('hidden');
  // Restore editor state then go home
  const btn=document.getElementById('btn-play');
  btn.textContent='▶ Play';btn.style.cssText='';
  document.getElementById('hud').classList.add('hidden');
  canvas.style.cursor='crosshair';
  document.getElementById('statusbar').style.display='';
  playerDying=false;playerOnIce=false;
  document.getElementById('death-flash').classList.remove('active');
  showHomeScreen();
});

function moveAxis(cx,cy,dx,dy) {
  const nx=cx+dx,ny=cy+dy,h=PLAYER_SIZE/2-1;
  const corners=[{x:nx-h,y:ny-h},{x:nx+h,y:ny-h},{x:nx-h,y:ny+h},{x:nx+h,y:ny+h}];
  for (const c of corners) {
    const gx=Math.floor(c.x/TILE),gy=Math.floor(c.y/TILE);
    if (!inBounds(gx,gy)) return {x:cx,y:cy};
    if (grid[gy][gx]===TILE_WALL) return {x:cx,y:cy};
    const pd=playDoors.find(d=>d.gx===gx&&d.gy===gy);
    if (pd&&!pd.open) return {x:cx,y:cy};
  }
  return {x:nx,y:ny};
}

function updateHUD() {
  document.getElementById('hud-deaths').textContent=`Deaths: ${deaths}`;
  const total=coins.length,remaining=playCoins.length;
  document.getElementById('hud-coins').textContent=`Coins: ${total-remaining}/${total}`;
  const hk=document.getElementById('hud-keys');
  if (keys.length>0){hk.classList.remove('hidden');hk.textContent=`Keys: ${collectedKeyIds.size}/${keys.length}`;}
  else hk.classList.add('hidden');
}

// -------------------------------------------------------
// HOME CTA BUTTONS
// -------------------------------------------------------
document.getElementById('home-btn-create').addEventListener('click', showCreateScreen);
document.getElementById('home-btn-online').addEventListener('click', showOnlineScreen);

// -------------------------------------------------------
// ONLINE LEVELS  (uses JSONBlob as free cloud storage)
// -------------------------------------------------------
// JSONBlob blob ID — shared by all users of this game.
// On first load it will be empty; you can seed it by uploading levels.
const ONLINE_BLOB_ID = 'whg-levels-v1';  // unique key stored in localStorage
const JSONBLOB_BASE = 'https://jsonblob.com/api/jsonBlob';

let onlineLevels = [];

function showOnlineScreen() {
  document.getElementById('home-screen').classList.add('hidden');
  document.getElementById('online-screen').classList.remove('hidden');
  loadOnlineLevels();
}
function hideOnlineScreen() {
  document.getElementById('online-screen').classList.add('hidden');
  document.getElementById('home-screen').classList.remove('hidden');
}

document.getElementById('online-btn-back').addEventListener('click', hideOnlineScreen);

async function loadOnlineLevels() {
  const listEl = document.getElementById('online-levels-list');
  const emptyEl = document.getElementById('online-empty');
  const loadingEl = document.getElementById('online-loading');
  listEl.innerHTML = '';
  emptyEl.classList.add('hidden');
  loadingEl.classList.remove('hidden');

  // Try to get blob ID from localStorage
  let blobId = localStorage.getItem('dodgefield-blob-id');
  if (!blobId) {
    loadingEl.classList.add('hidden');
    emptyEl.classList.remove('hidden');
    return;
  }
  try {
    const resp = await fetch(`${JSONBLOB_BASE}/${blobId}`, { headers: { 'Accept': 'application/json' } });
    if (!resp.ok) throw new Error('Not found');
    const data = await resp.json();
    onlineLevels = data.levels || [];
    loadingEl.classList.add('hidden');
    renderOnlineLevels();
  } catch(e) {
    loadingEl.classList.add('hidden');
    emptyEl.classList.remove('hidden');
    document.getElementById('online-empty').querySelector('#home-empty-text').textContent = 'Could not load levels. Check your connection.';
  }
}

function renderOnlineLevels() {
  const listEl = document.getElementById('online-levels-list');
  const emptyEl = document.getElementById('online-empty');
  const countEl = document.getElementById('online-levels-count');
  listEl.innerHTML = '';
  if (!onlineLevels.length) { emptyEl.classList.remove('hidden'); return; }
  emptyEl.classList.add('hidden');
  countEl.textContent = `COMMUNITY LEVELS (${onlineLevels.length})`;
  onlineLevels.forEach((lv, idx) => {
    const card = document.createElement('div');
    card.className = 'home-level-card';
    const coinCount = (lv.coins||[]).length;
    const enemyCount = (lv.enemies||[]).length;
    const meta = [
      `${lv.COLS}×${lv.ROWS}`,
      coinCount ? `${coinCount} coin${coinCount!==1?'s':''}` : '',
      enemyCount ? `${enemyCount} enem${enemyCount!==1?'ies':'y'}` : '',
      lv.timeLimit ? `${lv.timeLimit}s limit` : '',
      lv.author ? `by ${escHtml(lv.author)}` : '',
    ].filter(Boolean).join(' · ');

    card.innerHTML = `
      <div class="home-level-num">${idx+1}</div>
      <div class="home-level-info">
        <div class="home-level-name">${escHtml(lv.name||'Untitled')}</div>
        <div class="home-level-meta">${meta||'Empty level'}</div>
      </div>
      <div class="home-level-actions">
        <button class="home-level-btn play-btn" title="Play">▶ Play</button>
      </div>`;
    card.querySelector('.play-btn').addEventListener('click', e => {
      e.stopPropagation();
      playOnlineLevel(lv);
    });
    card.addEventListener('click', () => playOnlineLevel(lv));
    listEl.appendChild(card);
  });
}

function playOnlineLevel(lv) {
  // Deep clone the level and load it as read-only play
  const clone = JSON.parse(JSON.stringify(normalizeLevelData(lv)));
  // Add to collection temporarily
  levelCollection.push(clone);
  const idx = levelCollection.length - 1;
  currentLevelIdx = idx;
  document.getElementById('online-screen').classList.add('hidden');
  document.getElementById('editor-screen').classList.remove('hidden');
  loadLevelIntoEditor(clone);
  // Hide edit controls since it's an online level
  document.getElementById('topbar-actions').dataset.onlineMode = '1';
  document.getElementById('btn-play').style.display = 'none';
  // Start playing immediately with no stop button
  startPlayOnline(clone, idx);
}

function startPlayOnline(lv, idx) {
  saveCurrentEditorState();
  playMode = true;
  if (pathMode) exitPathMode(true); if (centerMode) exitCenterMode(); if (linkDoorMode) exitLinkDoorMode();
  // Show a "Back" button instead of Stop
  const btn = document.getElementById('btn-play');
  btn.textContent = '← Back'; btn.style.cssText = 'display:block;'; btn.style.background = '#555';
  btn.onclick = () => {
    stopPlay();
    // Remove temporary level
    levelCollection.splice(idx, 1);
    btn.onclick = null;
    document.getElementById('btn-play').style.display = '';
    document.getElementById('btn-play').textContent = '▶ Play';
    document.getElementById('btn-play').style.cssText = '';
    document.getElementById('topbar-actions').dataset.onlineMode = '0';
    document.getElementById('online-screen').classList.remove('hidden');
    document.getElementById('editor-screen').classList.add('hidden');
  };
  document.getElementById('hud').classList.remove('hidden');
  document.getElementById('win-overlay').classList.add('hidden');
  deaths = 0; playTimer = 0;
  buildPlayState(); lastTime = 0;
  canvas.style.cursor = 'default';
  document.getElementById('statusbar').style.display = 'none';
  if (animFrameId) cancelAnimationFrame(animFrameId);
  animFrameId = requestAnimationFrame(ts => { lastTime = ts; gameLoop(ts); });
}

// -------------------------------------------------------
// UPLOAD WIZARD (multi-step)
// -------------------------------------------------------
function openUploadWizard() {
  document.getElementById('upload-modal').classList.remove('hidden');
  showUploadStep(1);
  document.getElementById('upload-textarea').value = '';
  document.getElementById('upload-preview').classList.add('hidden');
  document.getElementById('upload-error').classList.add('hidden');
  document.getElementById('upload-author').value = '';
  document.getElementById('upload-collection-id').value = '';
}
function closeUploadWizard() {
  document.getElementById('upload-modal').classList.add('hidden');
}
function showUploadStep(n) {
  [1,2,3,4].forEach(i => {
    document.getElementById(`upload-step-${i}`).classList.toggle('hidden', i !== n);
  });
}

document.getElementById('online-btn-upload').addEventListener('click', openUploadWizard);
document.getElementById('upload-btn-cancel-1').addEventListener('click', closeUploadWizard);
document.getElementById('upload-step1-next').addEventListener('click', () => showUploadStep(2));
document.getElementById('upload-step2-back').addEventListener('click', () => showUploadStep(1));
document.getElementById('upload-step3-back').addEventListener('click', () => showUploadStep(2));

document.getElementById('upload-textarea').addEventListener('input', e => {
  const val = e.target.value.trim();
  const prev = document.getElementById('upload-preview');
  const err  = document.getElementById('upload-error');
  const nextBtn = document.getElementById('upload-step2-next');
  if (!val) { prev.classList.add('hidden'); err.classList.add('hidden'); nextBtn.disabled = true; return; }
  try {
    const data = JSON.parse(val);
    if (data.grid) {
      prev.classList.remove('hidden'); err.classList.add('hidden'); nextBtn.disabled = false;
      document.getElementById('upload-preview-name').textContent = '📦 ' + (data.name || 'Untitled');
      const coins = (data.coins||[]).length, enemies = (data.enemies||[]).length;
      document.getElementById('upload-preview-meta').textContent =
        `${data.COLS||28}×${data.ROWS||18} · ${coins} coin${coins!==1?'s':''} · ${enemies} enem${enemies!==1?'ies':'y'}`;
    } else { prev.classList.add('hidden'); err.classList.remove('hidden'); nextBtn.disabled = true; }
  } catch { prev.classList.add('hidden'); err.classList.remove('hidden'); nextBtn.disabled = true; }
});

document.getElementById('upload-step2-next').addEventListener('click', () => showUploadStep(3));

document.getElementById('upload-btn-submit').addEventListener('click', async () => {
  const val = document.getElementById('upload-textarea').value.trim();
  let levelData;
  try {
    levelData = JSON.parse(val);
    if (!levelData.grid) throw new Error('bad level');
  } catch { showUploadStep(2); return; }

  const authorName = document.getElementById('upload-author').value.trim() || 'Anonymous';
  const manualBlobId = document.getElementById('upload-collection-id').value.trim();
  levelData.author = authorName;

  const btn = document.getElementById('upload-btn-submit');
  btn.textContent = '⏳ Uploading…'; btn.disabled = true;

  try {
    let blobId = manualBlobId || localStorage.getItem('dodgefield-blob-id');
    if (!blobId) {
      const resp = await fetch(JSONBLOB_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ levels: [levelData] })
      });
      if (!resp.ok) throw new Error('Server error ' + resp.status);
      const url = resp.headers.get('Location') || '';
      blobId = url.split('/').pop();
      localStorage.setItem('dodgefield-blob-id', blobId);
      onlineLevels = [levelData];
    } else {
      // Load current levels first to avoid overwriting
      try {
        const getResp = await fetch(`${JSONBLOB_BASE}/${blobId}`, { headers: { 'Accept': 'application/json' } });
        if (getResp.ok) { const d = await getResp.json(); onlineLevels = d.levels || []; }
      } catch {}
      onlineLevels.push(levelData);
      const putResp = await fetch(`${JSONBLOB_BASE}/${blobId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ levels: onlineLevels })
      });
      if (!putResp.ok) throw new Error('Server error ' + putResp.status);
      localStorage.setItem('dodgefield-blob-id', blobId);
    }
    // Show success step
    document.getElementById('upload-success-id').textContent = blobId;
    showUploadStep(4);
    renderOnlineLevels();
  } catch(e) {
    alert('Upload failed: ' + e.message + '\n\nMake sure you\'re connected to the internet.');
  } finally {
    btn.textContent = '🚀 Publish!'; btn.disabled = false;
  }
});

document.getElementById('upload-btn-copy-id').addEventListener('click', () => {
  const id = document.getElementById('upload-success-id').textContent;
  navigator.clipboard.writeText(id).catch(() => {});
  document.getElementById('upload-btn-copy-id').textContent = '✅ Copied!';
  setTimeout(() => document.getElementById('upload-btn-copy-id').textContent = '📋 Copy ID', 2000);
});
document.getElementById('upload-btn-done').addEventListener('click', closeUploadWizard);

// Connect to someone's collection
document.getElementById('online-btn-connect').addEventListener('click', () => {
  const id = prompt('Enter the Collection ID you want to connect to:');
  if (id && id.trim()) {
    localStorage.setItem('dodgefield-blob-id', id.trim());
    loadOnlineLevels();
  }
});

function init() {
  levelCollection = [];
  showHomeScreen();
}
init();
