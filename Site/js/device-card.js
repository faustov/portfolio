/* Live 3D devices in case cards: <div data-device-card="iphone|fold"><canvas></div>
 * A light version of the scene in devices.html: same models and screens,
 * one looping move per device, a soft float and a tilt towards the cursor.
 * Each card loads when it nears the viewport and renders only while visible. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// Safari: GLTFLoader's createImageBitmap path sometimes gives empty textures
const isSafari = /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent);
if (isSafari) globalThis.createImageBitmap = undefined;

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const FOV = 14;
const d2r = THREE.MathUtils.degToRad;
const lerp = THREE.MathUtils.lerp;
const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const seg = (t, a, b) => ease(THREE.MathUtils.clamp((t - a) / (b - a), 0, 1));

const DEVICES = {
  // iPhone: slow turn from one side to the other and back
  iphone: {
    model: 'assets/iphone.glb',
    screens: [{ mesh: 'Front_Screen', texture: () => phoneScreen('assets/fold-cover.png', 1320, 2868) }],
    fit: 1.0,
    loop: 10,
    pose: t => {
      const a = seg(t, 0.5, 4.5), b = seg(t, 5.5, 9.5);
      return { ry: lerp(-22, 22, a) - 44 * b, rx: 8, fold: 0 };
    },
    still: { ry: -12, rx: 6, fold: 0 },
  },
  // iPhone Duo: closed → unfold → hold open → fold shut
  fold: {
    model: 'assets/fold.glb',
    screens: [
      { mesh: 'Front_Screen', texture: () => videoTexture('assets/fold-inner.mp4') },
      { mesh: 'Back_Screen', texture: () => new THREE.TextureLoader().loadAsync('assets/fold-cover.png') },
    ],
    fold: 'open-close',
    fit: 0.82,
    loop: 10,
    pose: t => {
      const open = seg(t, 1.2, 3.4), shut = seg(t, 6.6, 8.6);
      return { fold: 1 - open + shut, ry: lerp(24, -10, open) + 34 * shut, rx: lerp(12, 6, open) + 6 * shut };
    },
    still: { ry: -10, rx: 6, fold: 0 },
  },
};

for (const box of document.querySelectorAll('[data-device-card]')) {
  const cfg = DEVICES[box.dataset.deviceCard];
  if (!cfg) continue;
  const state = { visible: false, started: false };
  new IntersectionObserver(([e]) => {
    state.visible = e.isIntersecting;
    if (state.visible && !state.started) { state.started = true; start(box, cfg, state).catch(console.warn); }
  }, { rootMargin: '300px' }).observe(box);
}

async function start(box, cfg, state) {
  const canvas = box.querySelector('canvas');
  const card = box.closest('.case') || box;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.add(new THREE.AmbientLight(0xffffff, 0.4));
  const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(2, 3, 4); scene.add(key);
  const fill = new THREE.DirectionalLight(0xbfd4ff, 0.8); fill.position.set(-3, 1, -2); scene.add(fill);
  const camera = new THREE.PerspectiveCamera(FOV, 4 / 3, 0.01, 1000);

  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const [gltf, ...texes] = await Promise.all([loader.loadAsync(cfg.model), ...cfg.screens.map(s => s.texture())]);
  const model = gltf.scene;

  // Our UI on the screens, unaffected by lights
  const screens = cfg.screens.map((sc, i) => {
    const tex = texes[i];
    tex.flipY = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const mesh = model.getObjectByName(sc.mesh);
    mesh.material = mesh.material.clone();
    Object.assign(mesh.material, { emissiveMap: tex, emissiveIntensity: 1, toneMapped: false, metalness: 0, roughness: 0.25 });
    mesh.material.emissive.set(0xffffff);
    mesh.material.needsUpdate = true;
    return mesh;
  });

  // Fold clip, scrubbed by hand: 0 = open, 1 = closed
  let setFold = () => {};
  if (cfg.fold) {
    const mixer = new THREE.AnimationMixer(model);
    const clip = THREE.AnimationClip.findByName(gltf.animations, cfg.fold);
    const action = mixer.clipAction(clip);
    action.play(); action.paused = true;
    setFold = v => { action.time = THREE.MathUtils.clamp(v, 0, 1) * clip.duration; mixer.update(0); };
    setFold(0);
  }
  const precise = !!cfg.fold;   // skinned meshes need per-vertex bounds

  // Face the main screen to the camera and centre the model
  model.updateMatrixWorld(true);
  const mb = new THREE.Box3().setFromObject(model, precise);
  const sb = new THREE.Box3().setFromObject(screens[0], precise);
  const faceDir = sb.getCenter(new THREE.Vector3()).sub(mb.getCenter(new THREE.Vector3())).normalize();
  model.quaternion.premultiply(new THREE.Quaternion().setFromUnitVectors(faceDir, new THREE.Vector3(0, 0, 1)));
  model.updateMatrixWorld(true);
  model.position.sub(new THREE.Box3().setFromObject(model, precise).getCenter(new THREE.Vector3()));

  const centre = new THREE.Group(), pivot = new THREE.Group();
  centre.add(model); pivot.add(centre); scene.add(pivot);

  // Pose centre and size along the fold, to keep it centred and framed
  const N = cfg.fold ? 20 : 0, samples = [];
  for (let i = 0; i <= N; i++) {
    setFold(N ? i / N : 0); pivot.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(model, precise);
    samples.push({ c: b.getCenter(new THREE.Vector3()), r: b.getSize(new THREE.Vector3()).length() / 2 });
  }
  const sampleAt = v => {
    if (!N) return samples[0];
    const x = THREE.MathUtils.clamp(v, 0, 1) * N, i = Math.min(N - 1, Math.floor(x)), f = x - i;
    return { c: samples[i].c.clone().lerp(samples[i + 1].c, f), r: lerp(samples[i].r, samples[i + 1].r, f) };
  };
  const R = samples[0].r;

  const resize = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(canvas);
  resize();

  // Cursor tilt, only while the pointer is over the card
  const look = { x: 0, y: 0, tx: 0, ty: 0 };
  card.addEventListener('pointermove', e => {
    const r = box.getBoundingClientRect();
    look.tx = ((e.clientX - r.left) / r.width - 0.5) * 2;
    look.ty = ((e.clientY - r.top) / r.height - 0.5) * 2;
  });
  card.addEventListener('pointerleave', () => { look.tx = 0; look.ty = 0; });

  const clock = new THREE.Clock();
  let t = 0;
  box.classList.add('is-ready');

  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    if (!state.visible) return;
    t += dt;
    const k = reduceMotion ? cfg.still : cfg.pose(t % cfg.loop);

    setFold(k.fold);
    const s = sampleAt(k.fold);
    centre.position.copy(s.c).negate();

    look.x += (look.tx - look.x) * (1 - Math.exp(-dt * 4));
    look.y += (look.ty - look.y) * (1 - Math.exp(-dt * 4));
    const fl = reduceMotion ? 0 : 1;
    pivot.rotation.set(
      d2r(k.rx + look.y * 8 + Math.sin(t * 1.1) * 0.6 * fl),
      d2r(k.ry + look.x * 12),
      d2r(Math.sin(t * 0.8) * 0.4 * fl));
    pivot.position.y = Math.sin(t * 1.6) * 0.012 * R * fl;

    // Fit to the card; a folded pose is framed a bit closer
    const zoom = lerp(1, R / s.r, 0.6);
    const tan = Math.tan(d2r(FOV) / 2);
    const half = Math.min(tan, tan * camera.aspect);
    camera.position.set(0, 0, (R * cfg.fit) / Math.sin(Math.atan(half)) / zoom);
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
  });
}

function videoTexture(url) {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    Object.assign(v, { src: url, muted: true, loop: true, playsInline: true, autoplay: true, preload: 'auto' });
    v.setAttribute('playsinline', '');
    v.addEventListener('loadeddata', () => { v.play().catch(() => {}); resolve(new THREE.VideoTexture(v)); }, { once: true });
    v.addEventListener('error', () => reject(new Error('video ' + url)), { once: true });
  });
}

/* Phone screen from a shorter screenshot: fit it to the width below the
 * status bar and fill the rest with the screenshot's own background. */
async function phoneScreen(url, w, h) {
  const img = new Image();
  img.src = url;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = w / 2; c.height = h / 2;
  const x = c.getContext('2d');
  // background = the screenshot's bottom-left pixel
  const probe = document.createElement('canvas'); probe.width = probe.height = 1;
  const px = probe.getContext('2d');
  px.drawImage(img, 2, img.naturalHeight - 2, 1, 1, 0, 0, 1, 1);
  const [r, g, b] = px.getImageData(0, 0, 1, 1).data;
  x.fillStyle = `rgb(${r},${g},${b})`;
  x.fillRect(0, 0, c.width, c.height);
  const top = c.height * 0.055, ih = c.width * img.naturalHeight / img.naturalWidth;
  x.drawImage(img, 0, top, c.width, ih);
  return new THREE.CanvasTexture(c);
}
