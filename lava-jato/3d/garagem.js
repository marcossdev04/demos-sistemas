/* Garagem 3D da página de reserva.
   Modelos: Kenney Car Kit (CC0) · Motor: three.js (MIT)
   A página chama window.Garagem.set({ porte, cor, limpo, cera, pretinho, varrer }). */
import * as THREE from './three.module.min.js';
import { GLTFLoader } from './GLTFLoader.js';
import { RoomEnvironment } from './RoomEnvironment.js';

const BASE = new URL('./carros/', import.meta.url).href;
const ARQ = { p: 'hatchback-sports.glb', m: 'sedan.glb', g: 'suv.glb' };
// célula do atlas de cores (512x512, 16 colunas x 4 linhas) usada como pintura em cada modelo
const PINTURA = { p: [1, 7], m: [1, 13], g: [1, 7] };
const SUJA = [[2, 7], [2, 5]]; // frisos, para-choques e pneus também pegam lama
const CW = 32, CH = 128;
const COMPR = { p: 3.9, m: 4.3, g: 4.4, moto: 2.4 };

let renderer, scene, camera, pmrem, host, raf = 0, ativo = true;
const carros = {}; let atual = null, alvo = 'none';
const estado = { porte: null, cor: '#AEB5BB', limpo: false, cera: false, pretinho: false };
let sujeira = 1, sujeiraAlvo = 1;
let giro = -0.65, vel = 0.0022, arrastando = false, ultX = 0;
let atlasImg = null;

function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

function pintaAtlas(ctx, k, cor, lama) {
  ctx.drawImage(atlasImg, 0, 0);
  const [r, c] = PINTURA[k] || [1, 7]; const x = c * CW, y = r * CH;
  const rgb = hexRgb(cor); const g = ctx.createLinearGradient(0, y, 0, y + CH);
  g.addColorStop(0, `rgb(${mix(rgb, [255, 255, 255], .16)})`); g.addColorStop(.5, `rgb(${rgb})`); g.addColorStop(1, `rgb(${mix(rgb, [0, 0, 0], .32)})`);
  ctx.fillStyle = g; ctx.fillRect(x - CW, y, CW * 2, CH); // a coluna lisa ao lado também vira a cor nova
  if (lama <= 0.01) return;
  const cel = [[r, c], [r, c - 1], ...SUJA];
  let s = 7; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (const [rr, cc] of cel) {
    const cx = cc * CW, cy = rr * CH;
    const w = ctx.createLinearGradient(0, cy, 0, cy + CH);
    w.addColorStop(0, 'rgba(110,86,56,0)'); w.addColorStop(.45, `rgba(110,86,56,${.25 * lama})`); w.addColorStop(1, `rgba(92,70,44,${.75 * lama})`);
    ctx.fillStyle = w; ctx.fillRect(cx, cy, CW, CH);
    for (let i = 0; i < 90; i++) {
      const py = cy + CH * Math.pow(rnd(), .55); const px = cx + rnd() * CW; const rad = .6 + rnd() * 2.6;
      ctx.fillStyle = `rgba(${78 + rnd() * 30 | 0},${60 + rnd() * 20 | 0},${38 + rnd() * 14 | 0},${(.35 + rnd() * .5) * lama})`;
      ctx.beginPath(); ctx.arc(px, py, rad, 0, 7); ctx.fill();
    }
  }
}
function atualizaTextura(car) {
  if (!car.ctx) return;
  pintaAtlas(car.ctx, car.k, estado.cor, sujeira);
  car.tex.needsUpdate = true;
}

function preparaCarro(k, gltf) {
  const raiz = new THREE.Group(); const m = gltf.scene;
  const box = new THREE.Box3().setFromObject(m); const tam = box.getSize(new THREE.Vector3());
  const esc = COMPR[k] / Math.max(tam.x, tam.z); m.scale.setScalar(esc);
  const b2 = new THREE.Box3().setFromObject(m); const ctr = b2.getCenter(new THREE.Vector3());
  m.position.set(-ctr.x, -b2.min.y, -ctr.z); raiz.add(m);
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 512; const ctx = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv); tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const corpo = new THREE.MeshPhysicalMaterial({ map: tex, roughness: .5, metalness: .1, clearcoat: 0, clearcoatRoughness: .08, envMapIntensity: 1 });
  const roda = new THREE.MeshPhysicalMaterial({ map: tex, roughness: .8, metalness: 0, clearcoat: 0, clearcoatRoughness: .1 });
  m.traverse(o => {
    if (!o.isMesh) return;
    if (!atlasImg && o.material.map) atlasImg = o.material.map.image;
    const ehRoda = /wheel/i.test(o.parent?.name || '') || /wheel/i.test(o.name);
    o.material = ehRoda ? roda : corpo; o.castShadow = true; o.receiveShadow = true;
  });
  return { k, raiz, ctx, tex, corpo, roda };
}
function moto() {
  const raiz = new THREE.Group();
  const pint = new THREE.MeshPhysicalMaterial({ color: estado.cor, roughness: .4, metalness: .2, clearcoat: .3 });
  const preto = new THREE.MeshStandardMaterial({ color: '#1b1d20', roughness: .7 });
  const metal = new THREE.MeshStandardMaterial({ color: '#9aa3aa', roughness: .3, metalness: .9 });
  const pneu = new THREE.MeshPhysicalMaterial({ color: '#17191c', roughness: .8 });
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => { const me = new THREE.Mesh(geo, mat); me.position.set(x, y, z); me.rotation.set(rx, ry, rz); me.castShadow = true; raiz.add(me); return me; };
  for (const z of [-.78, .78]) { add(new THREE.TorusGeometry(.32, .085, 16, 40), pneu, 0, .43, z, 0, Math.PI / 2); add(new THREE.CylinderGeometry(.24, .24, .06, 24), metal, 0, .43, z, 0, 0, Math.PI / 2); }
  add(new THREE.CapsuleGeometry(.17, .42, 6, 16), pint, 0, .98, .12, Math.PI / 2 - .12);
  add(new THREE.BoxGeometry(.24, .1, .62), preto, 0, .96, -.36, .1);
  add(new THREE.BoxGeometry(.3, .3, .42), metal, 0, .62, -.02);
  add(new THREE.CylinderGeometry(.035, .035, .78, 10), metal, 0, .8, .66, -.42);
  add(new THREE.CylinderGeometry(.03, .03, .62, 10), preto, 0, 1.2, .5, 0, 0, Math.PI / 2);
  add(new THREE.CylinderGeometry(.045, .03, .7, 12), metal, .14, .52, -.5, Math.PI / 2 + .25);
  add(new THREE.BoxGeometry(.2, .12, .4), pint, 0, .86, -.72, -.2);
  const farol = add(new THREE.SphereGeometry(.08, 16, 12), new THREE.MeshStandardMaterial({ color: '#fff', emissive: '#dfeeff', emissiveIntensity: 1.2 }), 0, 1.08, .74);
  farol.castShadow = false;
  const s = COMPR.moto / 2.0; raiz.scale.setScalar(s);
  return { k: 'moto', raiz, corpo: pint, roda: pneu, moto: true };
}

function aplicaMateriais(car, dt) {
  if (!car) return;
  const e = estado; const t = Math.min(1, dt * 4);
  const c = car.corpo;
  c.clearcoat += ((e.cera ? 1 : e.limpo ? .35 : 0) - c.clearcoat) * t;
  c.roughness += ((e.cera ? .22 : e.limpo ? .4 : .7) - c.roughness) * t;
  c.envMapIntensity += ((e.cera ? 1.6 : 1) - c.envMapIntensity) * t;
  const r = car.roda;
  r.roughness += ((e.pretinho ? .18 : .85) - r.roughness) * t;
  r.clearcoat += ((e.pretinho ? 1 : 0) - r.clearcoat) * t;
  if (car.moto) { c.color.set(e.cor); r.color.set(e.pretinho ? '#08090a' : '#17191c'); }
}

function troca() {
  const k = alvo === 'none' ? 'g' : alvo; const prox = carros[k]; if (!prox || prox === atual) return;
  const velho = atual; atual = prox;
  prox.raiz.visible = true; prox.raiz.position.x = 6; prox._entra = 0;
  if (velho) velho._sai = 0;
  atualizaTextura(prox);
}
function loop(t0) {
  let ult = performance.now();
  const passo = () => {
    raf = requestAnimationFrame(passo); if (!ativo) return;
    const agora = performance.now(); const dt = Math.min(.05, (agora - ult) / 1000); ult = agora;
    if (!arrastando) { giro += vel; vel += (0.0022 - vel) * .02; }
    for (const car of Object.values(carros)) {
      if (car._entra != null) { car._entra = Math.min(1, car._entra + dt * 1.6); const e = 1 - Math.pow(1 - car._entra, 3); car.raiz.position.x = 6 * (1 - e); if (car._entra >= 1) car._entra = null; }
      if (car._sai != null) { car._sai = Math.min(1, car._sai + dt * 2.2); const e = car._sai * car._sai; car.raiz.position.x = -7 * e; if (car._sai >= 1) { car._sai = null; car.raiz.visible = false; } }
      car.raiz.rotation.y = giro;
    }
    if (Math.abs(sujeira - sujeiraAlvo) > .005) { sujeira += (sujeiraAlvo - sujeira) * Math.min(1, dt * 3.2); if (Math.abs(sujeira - sujeiraAlvo) < .02) sujeira = sujeiraAlvo; if (atual) atualizaTextura(atual); }
    aplicaMateriais(atual, dt);
    renderer.render(scene, camera);
  };
  passo();
}
function ajusta() {
  const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return;
  renderer.setSize(w, h, false); camera.aspect = w / h;
  camera.aspect = w / h; const tv = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)), th = tv * camera.aspect;
  const fr = w < 700 ? .84 : .7; const longe = Math.max(2.5 / (fr * th), 1.6 / (.62 * tv));
  camera.position.set(0, longe * .2, longe); camera.lookAt(0, .55, 0); camera.updateProjectionMatrix();
}

async function init(el) {
  host = el;
  const cv = document.createElement('canvas'); cv.className = 'cf-3d'; cv.setAttribute('aria-hidden', 'true'); host.appendChild(cv);
  renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  scene = new THREE.Scene();
  pmrem = new THREE.PMREMGenerator(renderer); scene.environment = pmrem.fromScene(new RoomEnvironment(), .04).texture;
  camera = new THREE.PerspectiveCamera(28, 1, .1, 100);
  scene.add(new THREE.HemisphereLight('#cfdcff', '#1a1d22', .55));
  const key = new THREE.DirectionalLight('#ffffff', 2.2); key.position.set(3, 8, 4); key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024); Object.assign(key.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 1, far: 20 }); key.shadow.radius = 6; scene.add(key);
  const rim = new THREE.DirectionalLight('#9ec5ff', 1.1); rim.position.set(-6, 3, -5); scene.add(rim);
  const chao = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.ShadowMaterial({ opacity: .55 })); chao.rotation.x = -Math.PI / 2; chao.receiveShadow = true; scene.add(chao);
  ajusta(); addEventListener('resize', ajusta); new ResizeObserver(ajusta).observe(host);
  cv.addEventListener('pointerdown', e => { arrastando = true; ultX = e.clientX; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', e => { if (!arrastando) return; const d = (e.clientX - ultX) * .008; giro += d; vel = d * .6; ultX = e.clientX; });
  const solta = () => { arrastando = false; }; cv.addEventListener('pointerup', solta); cv.addEventListener('pointercancel', solta);
  document.addEventListener('visibilitychange', () => { ativo = !document.hidden; });

  const loader = new GLTFLoader().setPath(BASE);
  const res = await Promise.all(Object.entries(ARQ).map(([k, f]) => loader.loadAsync(f).then(g => [k, g])));
  for (const [k, g] of res) { carros[k] = preparaCarro(k, g); }
  carros.moto = moto();
  for (const car of Object.values(carros)) { car.raiz.visible = false; scene.add(car.raiz); }
  if (!atlasImg) throw new Error('textura não carregou');
  troca(); if (atual) { atual.raiz.position.x = 0; atual._entra = null; }
  loop();
  return true;
}

window.Garagem = {
  pronta: false,
  async iniciar(el) {
    if (this.pronta) { host = el; el.appendChild(renderer.domElement); el.classList.add('tem3d'); ativo = true; ajusta(); return true; }
    try { await init(el); this.pronta = true; el.classList.add('tem3d'); this.set(this._pend || {}); return true; } catch (e) { console.warn('Garagem 3D indisponível:', e); return false; } },
  set(s) {
    if (!this.pronta) { this._pend = s; return; }
    const corMudou = s.cor && s.cor !== estado.cor;
    Object.assign(estado, s);
    sujeiraAlvo = estado.limpo ? 0 : 1;
    if (s.porte !== undefined && (s.porte || 'none') !== alvo) { alvo = s.porte || 'none'; troca(); }
    if (corMudou && atual) atualizaTextura(atual);
  },
  pausar(v) { ativo = !v; },
};
window.dispatchEvent(new Event('garagem-pronta'));
