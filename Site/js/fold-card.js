/* iPhone Duo in a case card.
 * A light version of the scene in devices.html: same model and screens,
 * one looping move (closed → unfold → hold → fold shut), a soft float and
 * a tilt towards the cursor. Starts loading when the card nears the
 * viewport, renders only while it's on screen. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const box = document.querySelector('[data-fold-card]');
if (box) init(box);

function init(box) {
  const canvas = box.querySelector('canvas');
  const card = box.closest('.case') || box;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const FOV = 14;

  let started = false, visible = false;
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible && !started) { started = true; start().catch(console.warn); }
  }, { rootMargin: '300px' }).observe(box);

  async function start() {
    // Safari: GLTFLoader's createImageBitmap path sometimes gives empty textures
    const isSafari = /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent);
    if (isSafari) globalThis.createImageBitmap = undefined;

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
    const [gltf, inner, cover] = await Promise.all([
      loader.loadAsync('assets/fold.glb'),
      videoTexture('assets/fold-inner.mp4'),
      new THREE.TextureLoader().loadAsync('assets/fold-cover.png'),
    ]);
    const model = gltf.scene;

    // Our UI on both screens, unaffected by lights
    const screens = [['Front_Screen', inner], ['Back_Screen', cover]].map(([name, tex]) => {
      tex.flipY = false;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      const mesh = model.getObjectByName(name);
      mesh.material = mesh.material.clone();
      Object.assign(mesh.material, { emissiveMap: tex, emissiveIntensity: 1, toneMapped: false, metalness: 0, roughness: 0.25 });
      mesh.material.emissive.set(0xffffff);
      mesh.material.needsUpdate = true;
      return mesh;
    });

    // Fold clip, scrubbed by hand: 0 = open, 1 = closed
    const mixer = new THREE.AnimationMixer(model);
    const clip = THREE.AnimationClip.findByName(gltf.animations, 'open-close');
    const action = mixer.clipAction(clip);
    action.play(); action.paused = true;
    const setFold = v => { action.time = THREE.MathUtils.clamp(v, 0, 1) * clip.duration; mixer.update(0); };
    setFold(0);

    // Face the inner screen to the camera and centre the model
    model.updateMatrixWorld(true);
    const mb = new THREE.Box3().setFromObject(model, true);
    const sb = new THREE.Box3().setFromObject(screens[0], true);
    const faceDir = sb.getCenter(new THREE.Vector3()).sub(mb.getCenter(new THREE.Vector3())).normalize();
    model.quaternion.premultiply(new THREE.Quaternion().setFromUnitVectors(faceDir, new THREE.Vector3(0, 0, 1)));
    model.updateMatrixWorld(true);
    model.position.sub(new THREE.Box3().setFromObject(model, true).getCenter(new THREE.Vector3()));

    const centre = new THREE.Group(), pivot = new THREE.Group();
    centre.add(model); pivot.add(centre); scene.add(pivot);

    // Pose centre and size along the fold, to keep it centred and framed
    const N = 20, samples = [];
    for (let i = 0; i <= N; i++) {
      setFold(i / N); pivot.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(model, true);
      samples.push({ c: b.getCenter(new THREE.Vector3()), r: b.getSize(new THREE.Vector3()).length() / 2 });
    }
    const sampleAt = v => {
      const x = THREE.MathUtils.clamp(v, 0, 1) * N, i = Math.min(N - 1, Math.floor(x)), f = x - i;
      return { c: samples[i].c.clone().lerp(samples[i + 1].c, f), r: THREE.MathUtils.lerp(samples[i].r, samples[i + 1].r, f) };
    };
    const R = samples[0].r;

    function resize() {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
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

    // One loop, seconds: closed, unfold, hold open, fold shut
    const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const seg = (t, a, b) => ease(THREE.MathUtils.clamp((t - a) / (b - a), 0, 1));
    const LOOP = 10;
    function pose(t) {
      const open = seg(t, 1.2, 3.4), shut = seg(t, 6.6, 8.6);
      const fold = 1 - open + shut;
      const ry = THREE.MathUtils.lerp(24, -10, open) + (24 + 10) * shut;
      const rx = THREE.MathUtils.lerp(12, 6, open) + 6 * shut;
      return { fold, ry, rx };
    }

    const d2r = THREE.MathUtils.degToRad, clock = new THREE.Clock();
    let t = 0;
    box.classList.add('is-ready');

    renderer.setAnimationLoop(() => {
      const dt = Math.min(clock.getDelta(), 0.05);
      if (!visible) return;
      t += dt;
      const k = reduceMotion ? { fold: 0, ry: -10, rx: 6 } : pose(t % LOOP);

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

      // Fit: open pose fills the card, closed one is framed a bit closer
      const zoom = THREE.MathUtils.lerp(1, R / s.r, 0.6);
      const tan = Math.tan(d2r(FOV) / 2);
      const half = Math.min(tan, tan * camera.aspect);
      camera.position.set(0, 0, (R * 0.82) / Math.sin(Math.atan(half)) / zoom);
      camera.lookAt(0, 0, 0);
      renderer.render(scene, camera);
    });
  }
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
