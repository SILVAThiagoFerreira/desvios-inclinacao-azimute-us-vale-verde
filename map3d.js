/* ============================================================
   Mapa 3D de execução — Desvios de Perfuração
   Recebe os furos visíveis do mapa 2D (evento "map3d:data", publicado
   por app.js) e desenha planejado (cilindros cinza), executado (linhas
   vermelhas) e emboques (esferas azuis) em uma cena girável.
   ============================================================ */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const COLORS = {
  planned: 0x6c747b,
  real: 0xe20613,
  collar: 0x1d2a9c,
  background: 0xfbfbfc,
  gridMain: 0xb8bec4,
  gridSub: 0xdfe3e7,
};

function main() {
  const root = document.getElementById("map3d-root");
  const statusEl = document.getElementById("map3d-status");
  const exagSel = document.getElementById("map3d-exag");
  const resetBtn = document.getElementById("map3d-reset");
  if (!root || !statusEl) return;

  const UP = new THREE.Vector3(0, 1, 0);
  let renderer, scene, camera, controls, group, home = null;
  let current = [];

  const setStatus = (text) => {
    statusEl.textContent = text || "";
    statusEl.classList.toggle("is-visible", Boolean(text));
  };

  try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
  } catch (e) {
    console.error("WebGL indisponível:", e);
    setStatus("WebGL indisponível neste navegador — mapa 3D não pode ser exibido.");
    return;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(COLORS.background, 1);
  root.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100000);
  scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  const sun = new THREE.DirectionalLight(0xffffff, 0.9);
  sun.position.set(1, 2, 1.5);
  scene.add(sun);
  group = new THREE.Group();
  scene.add(group);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  const resize = () => {
    const w = root.clientWidth || 1;
    const h = root.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  if ("ResizeObserver" in window) new ResizeObserver(resize).observe(root);
  else window.addEventListener("resize", resize);
  resize();

  const clearGroup = () => {
    while (group.children.length) {
      const obj = group.children.pop();
      obj.traverse((node) => {
        node.geometry?.dispose();
        node.material?.dispose();
      });
    }
  };

  const resetView = () => {
    if (!home) return;
    camera.position.copy(home.position);
    controls.target.copy(home.target);
    controls.update();
  };

  function build(holes) {
    clearGroup();
    const exag = Number(exagSel?.value) || 1;

    // Bounds nas coordenadas originais (x, y em planta; z em profundidade/cota)
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    const bound = (p) => {
      if (!p || ![p.x, p.y, p.z].every(Number.isFinite)) return false;
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
      return true;
    };
    holes.forEach((h) => {
      bound(h.collar);
      (h.planned || []).forEach(bound);
      (h.real || []).forEach(bound);
    });
    if (!Number.isFinite(minX)) {
      setStatus("Sem geometria 3D para o filtro atual.");
      home = null;
      return;
    }
    setStatus("");

    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
    const extent = Math.max(maxX - minX, maxY - minY, 1);
    const rad = Math.max(extent * 0.0022, 0.15);
    // Planta (x, y) vira o plano XZ da cena; Y da cena é a cota (z) com exagero.
    const toWorld = (p) => new THREE.Vector3(p.x - cx, (p.z - cz) * exag, -(p.y - cy));

    const plannedSegs = [];
    const realPts = [];
    const collars = [];
    holes.forEach((h) => {
      if (h.planned && h.planned.length >= 2 && h.planned.slice(0, 2).every((p) => Number.isFinite(p.x))) {
        plannedSegs.push([toWorld(h.planned[0]), toWorld(h.planned[1])]);
      }
      if (h.real && h.real.length >= 2) {
        for (let i = 0; i < h.real.length - 1; i++) {
          realPts.push(toWorld(h.real[i]), toWorld(h.real[i + 1]));
        }
      }
      const c = h.collar || (h.planned && h.planned[0]) || (h.real && h.real[0]);
      if (c && Number.isFinite(c.x)) collars.push(toWorld(c));
    });

    // Planejado: tubos (cilindros) de cada furo
    if (plannedSegs.length) {
      const geom = new THREE.CylinderGeometry(1, 1, 1, 6, 1, false);
      const mat = new THREE.MeshStandardMaterial({ color: COLORS.planned, roughness: 0.6 });
      const mesh = new THREE.InstancedMesh(geom, mat, plannedSegs.length);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion();
      const mid = new THREE.Vector3(), dir = new THREE.Vector3(), sc = new THREE.Vector3();
      let n = 0;
      plannedSegs.forEach(([a, b]) => {
        dir.subVectors(b, a);
        const len = dir.length();
        if (len < 1e-6) return;
        mid.addVectors(a, b).multiplyScalar(0.5);
        q.setFromUnitVectors(UP, dir.normalize());
        sc.set(rad, len, rad);
        m.compose(mid, q, sc);
        mesh.setMatrixAt(n++, m);
      });
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      group.add(mesh);
    }

    // Executado: linhas vermelhas por segmento
    if (realPts.length) {
      const geom = new THREE.BufferGeometry().setFromPoints(realPts);
      const mat = new THREE.LineBasicMaterial({ color: COLORS.real });
      group.add(new THREE.LineSegments(geom, mat));
    }

    // Emboques: esferas azuis
    if (collars.length) {
      const geom = new THREE.SphereGeometry(rad * 1.6, 8, 6);
      const mat = new THREE.MeshStandardMaterial({ color: COLORS.collar, roughness: 0.4 });
      const mesh = new THREE.InstancedMesh(geom, mat, collars.length);
      const m = new THREE.Matrix4();
      collars.forEach((p, i) => { m.makeTranslation(p.x, p.y, p.z); mesh.setMatrixAt(i, m); });
      mesh.instanceMatrix.needsUpdate = true;
      group.add(mesh);
    }

    // Caixa envolvente em coordenadas da cena
    const box = new THREE.Box3();
    plannedSegs.forEach(([a, b]) => { box.expandByPoint(a); box.expandByPoint(b); });
    realPts.forEach((p) => box.expandByPoint(p));
    collars.forEach((p) => box.expandByPoint(p));

    // Chão de referência logo abaixo dos furos
    const size = new THREE.Vector3();
    box.getSize(size);
    const gridSize = Math.max(size.x, size.z, 1) * 1.4;
    const grid = new THREE.GridHelper(gridSize, 20, COLORS.gridMain, COLORS.gridSub);
    grid.position.y = box.min.y - rad * 2;
    group.add(grid);

    // Enquadramento inicial e limites de zoom
    const target = box.getCenter(new THREE.Vector3());
    const R = Math.max(size.length() / 2, 1);
    const position = target.clone().add(new THREE.Vector3(R * 1.3, R * 1.0, R * 1.9));
    home = { target, position };
    camera.near = R / 1000;
    camera.far = R * 100;
    camera.updateProjectionMatrix();
    controls.minDistance = R * 0.1;
    controls.maxDistance = R * 8;
    resetView();
  }

  const animate = () => {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  };
  animate();

  resetBtn?.addEventListener("click", resetView);
  exagSel?.addEventListener("change", () => build(current));
  document.addEventListener("map3d:data", (e) => {
    current = Array.isArray(e.detail) ? e.detail : [];
    build(current);
  });

  // Se o mapa 2D já tiver publicado antes deste módulo carregar
  if (Array.isArray(window.__map3d)) {
    current = window.__map3d;
    build(current);
  }
}

main();
