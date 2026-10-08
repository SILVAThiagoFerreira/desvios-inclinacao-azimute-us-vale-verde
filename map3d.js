/* ============================================================
   Mapa 3D de execução — Desvios de Perfuração
   Recebe os furos visíveis do mapa 2D (evento "map3d:data", publicado
   por app.js) e desenha planejado (tubos semitransparentes), executado
   (segmentos vermelhos) e emboques (esferas azuis) em uma cena girável.
   Controles: botão esquerdo/direito gira, botão do meio move, roda aproxima.
   Clique em um furo para ver ID e informações.
   ============================================================ */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";

const COLORS = {
  planned: 0x6c747b,
  real: 0xe20613,
  collar: 0x1d2a9c,
  selected: 0xf5b700,
  background: 0xfbfbfc,
  gridMain: 0xb8bec4,
  gridSub: 0xdfe3e7,
};
const PLANNED_OPACITY = 0.4;
// Sensibilidade média: metade da velocidade padrão do OrbitControls
const SPEED = { rotate: 0.5, zoom: 0.5, pan: 0.5 };
const LAYER_KEYS = ["planned", "real", "collar", "grid", "labels"];

function main() {
  const root = document.getElementById("map3d-root");
  const statusEl = document.getElementById("map3d-status");
  const exagSel = document.getElementById("map3d-exag");
  const resetBtn = document.getElementById("map3d-reset");
  const infoEl = document.getElementById("map3d-info");
  const layerInputs = [...document.querySelectorAll("input[data-map3d-layer]")];
  const viewBtns = [...document.querySelectorAll("[data-map3d-view]")];
  const hideBtn = document.getElementById("map3d-hide");
  const menuEl = document.getElementById("map3d-menu");
  const dxfBtn = document.getElementById("map3d-dxf");
  const showAllBtn = document.getElementById("map3d-showall");
  if (!root || !statusEl) return;

  // Chave estável de cada furo (plano + ID; sem ID, usa a posição do emboque)
  function keyOf(h) {
    if (h.id) return `${h.plano}|${h.id}`;
    const p = h.collar || (h.planned && h.planned[0]) || (h.real && h.real[0]);
    return p ? `${h.plano}|@${p.x},${p.y},${p.z}` : null;
  }
  const hiddenKeys = new Set();
  let drawnHoles = [];
  let menuHoleIdx = null;

  const UP = new THREE.Vector3(0, 1, 0);
  let renderer, scene, camera, controls, home = null;
  let current = [];
  let radius = 1;
  let anchors = [];
  let collarMeshes = {};
  const layerGroups = {};
  const pickEntries = [];
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

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

  const dom = renderer.domElement;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(COLORS.background, 1);
  root.appendChild(dom);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100000);
  scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  const sun = new THREE.DirectionalLight(0xffffff, 0.9);
  sun.position.set(1, 2, 1.5);
  scene.add(sun);
  LAYER_KEYS.forEach((key) => {
    layerGroups[key] = new THREE.Group();
    scene.add(layerGroups[key]);
  });

  // Marcador do furo selecionado (sempre por cima, não entra na lista de camadas)
  const highlight = new THREE.Mesh(
    new THREE.SphereGeometry(1, 16, 12),
    new THREE.MeshBasicMaterial({ color: COLORS.selected, transparent: true, opacity: 0.9, depthTest: false }),
  );
  highlight.renderOrder = 10;
  highlight.visible = false;
  scene.add(highlight);

  controls = new OrbitControls(camera, dom);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.rotateSpeed = SPEED.rotate;
  controls.zoomSpeed = SPEED.zoom;
  controls.panSpeed = SPEED.pan;
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.PAN,
    RIGHT: THREE.MOUSE.ROTATE,
  };
  // Botão do meio não deve disparar rolagem automática nem colar no navegador
  dom.addEventListener("auxclick", (e) => e.preventDefault());
  dom.addEventListener("mousedown", (e) => { if (e.button === 1) e.preventDefault(); });

  // Rótulos de ID: elementos de texto sobre a cena (fonte simples, preta)
  const labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.className = "map3d-labels";
  root.appendChild(labelRenderer.domElement);

  const resize = () => {
    const w = root.clientWidth || 1;
    const h = root.clientHeight || 1;
    renderer.setSize(w, h, false);
    labelRenderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  if ("ResizeObserver" in window) new ResizeObserver(resize).observe(root);
  else window.addEventListener("resize", resize);
  resize();

  const layerChecked = (key) => layerInputs.find((input) => input.dataset.map3dLayer === key)?.checked ?? true;

  // Quando planejado e executado estão ocultos, cada emboque vira um círculo pequeno
  const applyLayerVisibility = () => {
    layerInputs.forEach((input) => {
      const group = layerGroups[input.dataset.map3dLayer];
      if (!group) return;
      group.visible = input.checked;
      // CSS2DRenderer só oculta rótulos cujo próprio flag visible está desligado
      if (group === layerGroups.labels) group.children.forEach((label) => { label.visible = input.checked; });
    });
    const holesHidden = !layerChecked("planned") && !layerChecked("real");
    if (collarMeshes.sphere) collarMeshes.sphere.visible = !holesHidden;
    if (collarMeshes.disc) collarMeshes.disc.visible = holesHidden;
    if (hideBtn) {
      hideBtn.setAttribute("aria-pressed", String(holesHidden));
      hideBtn.textContent = holesHidden ? "Mostrar furos" : "Ocultar furos";
    }
  };

  // ---------- Vista: perspectiva ou planta (de cima) ----------
  let viewMode = "persp";
  const setViewButtons = () => {
    viewBtns.forEach((btn) => btn.setAttribute("aria-pressed", String(btn.dataset.map3dView === viewMode)));
  };
  const applyView = () => {
    if (!home) return;
    if (viewMode === "top") {
      // Trava a elevação em 90° (vista de cima); o giro horizontal continua livre
      controls.minPolarAngle = 0;
      controls.maxPolarAngle = 0;
      const R = home.R;
      camera.position.set(home.target.x, home.target.y + R * 2.4, home.target.z + 0.0001);
      controls.target.copy(home.target);
      controls.update();
    } else {
      controls.minPolarAngle = 0;
      controls.maxPolarAngle = Math.PI;
      resetView();
    }
    setViewButtons();
  };
  viewBtns.forEach((btn) => btn.addEventListener("click", () => {
    viewMode = btn.dataset.map3dView;
    applyView();
  }));
  hideBtn?.addEventListener("click", () => {
    const hide = !(!layerChecked("planned") && !layerChecked("real"));
    layerInputs.forEach((input) => {
      if (input.dataset.map3dLayer === "planned" || input.dataset.map3dLayer === "real") input.checked = !hide;
    });
    applyLayerVisibility();
  });

  const clearGroups = () => {
    LAYER_KEYS.forEach((key) => {
      const group = layerGroups[key];
      while (group.children.length) {
        const obj = group.children.pop();
        obj.traverse((node) => {
          node.geometry?.dispose();
          node.material?.dispose();
          if (node.isCSS2DObject) node.element.remove();
        });
      }
    });
    pickEntries.length = 0;
    collarMeshes = {};
  };

  const resetView = () => {
    if (!home) return;
    if (viewMode === "top") {
      camera.position.set(home.target.x, home.target.y + home.R * 2.4, home.target.z + 0.0001);
    } else {
      camera.position.copy(home.position);
    }
    controls.target.copy(home.target);
    controls.update();
  };

  // ---------- Painel de detalhes do furo ----------
  const fmt = (v, unit) => {
    if (v == null || !Number.isFinite(v)) return "—";
    const txt = v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return unit ? `${txt} ${unit}` : txt;
  };

  const closeInfo = () => {
    highlight.visible = false;
    if (infoEl) {
      infoEl.hidden = true;
      infoEl.replaceChildren();
    }
  };

  const showInfo = (hole) => {
    if (!infoEl) return;
    const info = hole.info || {};
    const rows = [
      ["Plano", hole.plano || "—"],
      ["Ângulo frontal", fmt(info.angle, "°")],
      ["Azimute planejado", fmt(info.azPlan, "°")],
      ["Azimute executado", fmt(info.azExec, "°")],
      ["Δ azimute", fmt(info.azDelta, "°")],
      ["Profundidade planejada", fmt(info.depthPlan, "m")],
      ["Profundidade executada", fmt(info.depthExec, "m")],
      ["Δ profundidade", fmt(info.depthDelta, "m")],
    ];
    const head = document.createElement("div");
    head.className = "map3d-info__head";
    const title = document.createElement("strong");
    title.textContent = `Furo ${hole.id || "s/ ID"}`;
    const close = document.createElement("button");
    close.type = "button";
    close.className = "map3d-info__close";
    close.setAttribute("aria-label", "Fechar detalhes");
    close.textContent = "×";
    close.addEventListener("click", closeInfo);
    head.append(title, close);

    const dl = document.createElement("dl");
    dl.className = "map3d-info__list";
    rows.forEach(([label, value]) => {
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = value;
      dl.append(dt, dd);
    });
    infoEl.replaceChildren(head, dl);
    infoEl.hidden = false;
  };

  function selectHole(hi) {
    const hole = drawnHoles[hi];
    if (!hole) return;
    const anchor = anchors[hi];
    if (anchor) {
      highlight.position.copy(anchor);
      highlight.scale.setScalar(radius * 2.2);
      highlight.visible = true;
    }
    showInfo(hole);
  }

  // Clique (sem arrastar): esquerdo mostra detalhes; direito abre o menu do furo
  let downAt = null;
  // Toque longo (celular/tablet, sem botão direito) abre o mesmo menu do furo
  let pressTimer = null;
  const cancelPress = () => { clearTimeout(pressTimer); pressTimer = null; };
  dom.addEventListener("pointerdown", (e) => {
    downAt = e.button === 0 || e.button === 2 ? { button: e.button, x: e.clientX, y: e.clientY } : null;
    cancelPress();
    if (e.pointerType === "touch" && e.isPrimary && downAt) {
      const x = e.clientX, y = e.clientY;
      pressTimer = setTimeout(() => {
        pressTimer = null;
        downAt = null;
        openMenu({ clientX: x, clientY: y });
      }, 500);
    }
  });
  dom.addEventListener("pointermove", (e) => {
    if (pressTimer && downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 8) cancelPress();
  });
  dom.addEventListener("pointercancel", cancelPress);
  dom.addEventListener("pointerup", (e) => {
    cancelPress();
    if (!downAt) return;
    const { button, x, y } = downAt;
    downAt = null;
    if (Math.hypot(e.clientX - x, e.clientY - y) > 4) return;
    if (button === 0) {
      closeMenu();
      pick(e);
    } else {
      openMenu(e);
    }
  });

  // ---------- Menu do botão direito ----------
  function closeMenu() {
    if (!menuEl) return;
    menuEl.hidden = true;
    menuEl.replaceChildren();
    menuHoleIdx = null;
  }

  function openMenu(e) {
    const hi = hitHole(e);
    if (hi == null) {
      closeMenu();
      return;
    }
    menuHoleIdx = hi;
    const hole = drawnHoles[hi];
    const head = document.createElement("div");
    head.className = "map3d-menu__head";
    head.textContent = `Furo ${hole.id || "s/ ID"} · ${hole.plano || ""}`;
    const hideOne = document.createElement("button");
    hideOne.type = "button";
    hideOne.setAttribute("role", "menuitem");
    hideOne.textContent = "Ocultar este furo";
    hideOne.addEventListener("click", () => {
      const k = keyOf(hole);
      if (k) hiddenKeys.add(k);
      closeMenu();
      build(current, { keepView: true });
    });
    const items = [head, hideOne];
    if (hiddenKeys.size) {
      const showAll = document.createElement("button");
      showAll.type = "button";
      showAll.setAttribute("role", "menuitem");
      showAll.textContent = `Mostrar furos ocultos (${hiddenKeys.size})`;
      showAll.addEventListener("click", () => {
        hiddenKeys.clear();
        closeMenu();
        build(current, { keepView: true });
      });
      items.push(showAll);
    }
    menuEl.replaceChildren(...items);
    menuEl.hidden = false;

    // Posiciona o menu no ponto do clique, dentro do cartão 3D
    const box = menuEl.parentElement.getBoundingClientRect();
    const mw = menuEl.offsetWidth, mh = menuEl.offsetHeight;
    const left = Math.min(e.clientX - box.left, box.width - mw - 8);
    const top = Math.min(e.clientY - box.top, box.height - mh - 8);
    menuEl.style.left = `${Math.max(8, left)}px`;
    menuEl.style.top = `${Math.max(8, top)}px`;
  }

  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });
  document.addEventListener("pointerdown", (e) => {
    if (menuEl && !menuEl.hidden && !menuEl.contains(e.target)) closeMenu();
  });

  // Índice do furo (em drawnHoles) sob o ponteiro, ou null
  function hitHole(e) {
    const rect = dom.getBoundingClientRect();
    pointer.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    // Só entram meshes visíveis: camada ligada e, nos emboques, a variante ativa
    const candidates = [];
    pickEntries.forEach((en) => {
      if (!layerGroups[en.key].visible) return;
      [en.mesh, en.alt].forEach((mesh) => {
        if (mesh && mesh.visible) candidates.push({ mesh, holeOf: en.holeOf });
      });
    });
    const hits = raycaster.intersectObjects(candidates.map((c) => c.mesh), false);
    if (!hits.length) return null;
    const hit = hits[0];
    const entry = candidates.find((c) => c.mesh === hit.object);
    return entry?.holeOf[hit.instanceId] ?? null;
  }

  function pick(e) {
    const hi = hitHole(e);
    if (hi == null) {
      closeInfo();
      return;
    }
    selectHole(hi);
  }

  // ---------- Exportação DXF ----------
  // Mesmas camadas que o mapa 2D lê dos DXFs: HOLE (emboque), THEORETICAL HOLE
  // (planejado), REAL HOLE (executado) e NUMBER (ID). Coordenadas originais.
  function buildDxf(holes) {
    const out = [];
    const g = (code, value) => out.push(String(code), String(value));
    const num = (v) => (Number.isFinite(v) ? v : 0).toFixed(4);
    const pt = (code, p) => { g(10, num(p.x)); g(20, num(p.y)); g(30, num(p.z)); };
    const layers = ["HOLE", "THEORETICAL HOLE", "REAL HOLE", "NUMBER"];

    // Altura do texto proporcional ao tamanho do conjunto
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    holes.forEach((h) => [h.collar, ...(h.planned || []), ...(h.real || [])].forEach((p) => {
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }));
    const textH = Math.max(0.5, (Math.max(maxX - minX, maxY - minY, 1)) * 0.008);

    g(0, "SECTION"); g(2, "HEADER"); g(9, "$ACADVER"); g(1, "AC1009"); g(0, "ENDSEC");
    g(0, "SECTION"); g(2, "TABLES");
    g(0, "TABLE"); g(2, "LAYER"); g(70, layers.length);
    layers.forEach((name) => { g(0, "LAYER"); g(2, name); g(70, 0); g(62, 7); g(6, "CONTINUOUS"); });
    g(0, "ENDTAB");
    g(0, "ENDSEC");
    g(0, "SECTION"); g(2, "ENTITIES");

    holes.forEach((h) => {
      const collar = h.collar || (h.planned && h.planned[0]) || (h.real && h.real[0]);
      if (collar && Number.isFinite(collar.x)) {
        g(0, "POINT"); g(8, "HOLE"); pt(10, collar);
      }
      if (h.planned && h.planned.length >= 2) {
        g(0, "LINE"); g(8, "THEORETICAL HOLE");
        pt(10, h.planned[0]);
        g(11, num(h.planned[1].x)); g(21, num(h.planned[1].y)); g(31, num(h.planned[1].z));
      }
      if (h.real && h.real.length >= 2) {
        g(0, "POLYLINE"); g(8, "REAL HOLE"); g(66, 1); g(10, 0); g(20, 0); g(30, 0);
        h.real.forEach((p) => { g(0, "VERTEX"); g(8, "REAL HOLE"); pt(10, p); });
        g(0, "SEQEND"); g(8, "REAL HOLE");
      }
      if (collar && h.id && Number.isFinite(collar.x)) {
        g(0, "TEXT"); g(8, "NUMBER"); pt(10, collar); g(40, num(textH)); g(1, h.id);
      }
    });

    g(0, "ENDSEC");
    g(0, "EOF");
    return out.join("\r\n") + "\r\n";
  }

  function exportDxf() {
    if (!drawnHoles.length) return;
    const blob = new Blob([buildDxf(drawnHoles)], { type: "application/dxf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `furos-3d-${new Date().toISOString().slice(0, 10)}.dxf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Mediana da distância, em planta, entre cada emboque e o mais próximo dele
  function medianCollarSpacing(holes) {
    const pts = [];
    holes.forEach((h) => {
      const c = h.collar || (h.planned && h.planned[0]) || (h.real && h.real[0]);
      if (c && Number.isFinite(c.x) && Number.isFinite(c.y)) pts.push(c);
    });
    if (pts.length < 2) return Infinity;
    const nearest = pts.map((p, i) => {
      let best = Infinity;
      for (let j = 0; j < pts.length; j++) {
        if (j === i) continue;
        const d = Math.hypot(p.x - pts[j].x, p.y - pts[j].y);
        if (d < best) best = d;
      }
      return best;
    }).filter(Number.isFinite).sort((a, b) => a - b);
    return nearest[Math.floor(nearest.length / 2)] || Infinity;
  }

  // ---------- Construção da cena ----------
  function build(all, { keepView = false } = {}) {
    clearGroups();
    closeInfo();
    closeMenu();
    current = all;
    // Furos ocultos individualmente pelo menu do botão direito saem da cena
    const holes = all.filter((h) => {
      const k = keyOf(h);
      return !(k && hiddenKeys.has(k));
    });
    drawnHoles = holes;
    if (dxfBtn) dxfBtn.disabled = !holes.length;
    if (showAllBtn) showAllBtn.disabled = !hiddenKeys.size;
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
      anchors = [];
      return;
    }
    setStatus("");

    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
    const extent = Math.max(maxX - minX, maxY - minY, 1);
    // Espessura pelo espaçamento real entre emboques (não pela extensão total),
    // para que furos vizinhos não se sobreponham por causa da grossura
    const spacing = medianCollarSpacing(holes);
    const rad = Math.max(Math.min(extent * 0.0022, spacing * 0.25), 0.04);
    radius = rad;
    // Planta (x, y) vira o plano XZ da cena; Y da cena é a cota (z) com exagero.
    const toWorld = (p) => new THREE.Vector3(p.x - cx, (p.z - cz) * exag, -(p.y - cy));

    const plannedSegs = [];
    const realSegs = [];
    const collars = [];
    anchors = new Array(holes.length);
    holes.forEach((h, hi) => {
      let anchor = null;
      if (h.planned && h.planned.length >= 2 && h.planned.slice(0, 2).every((p) => Number.isFinite(p.x))) {
        const a = toWorld(h.planned[0]), b = toWorld(h.planned[1]);
        plannedSegs.push({ a, b, hi });
        anchor = a;
      }
      if (h.real && h.real.length >= 2) {
        for (let i = 0; i < h.real.length - 1; i++) {
          realSegs.push({ a: toWorld(h.real[i]), b: toWorld(h.real[i + 1]), hi });
        }
        anchor = anchor || toWorld(h.real[0]);
      }
      const c = h.collar || (h.planned && h.planned[0]) || (h.real && h.real[0]);
      if (c && Number.isFinite(c.x)) {
        const p = toWorld(c);
        collars.push({ p, hi });
        anchor = p;
      }
      anchors[hi] = anchor;
    });

    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    const mid = new THREE.Vector3(), dir = new THREE.Vector3(), sc = new THREE.Vector3();
    // Monta um InstancedMesh de cilindros (segmentos) e registra qual furo é cada instância
    const tubeMesh = (segs, geom, mat, key, radialScale) => {
      const mesh = new THREE.InstancedMesh(geom, mat, segs.length);
      const holeOf = [];
      let n = 0;
      segs.forEach(({ a, b, hi }) => {
        dir.subVectors(b, a);
        const len = dir.length();
        if (len < 1e-6) return;
        mid.addVectors(a, b).multiplyScalar(0.5);
        q.setFromUnitVectors(UP, dir.normalize());
        sc.set(radialScale, len, radialScale);
        m.compose(mid, q, sc);
        mesh.setMatrixAt(n, m);
        holeOf[n] = hi;
        n++;
      });
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      layerGroups[key].add(mesh);
      pickEntries.push({ key, mesh, holeOf });
    };

    // Planejado: tubos semitransparentes de cada furo teórico
    if (plannedSegs.length) {
      const geom = new THREE.CylinderGeometry(1, 1, 1, 12, 1, false);
      const mat = new THREE.MeshStandardMaterial({
        color: COLORS.planned,
        roughness: 0.5,
        transparent: true,
        opacity: PLANNED_OPACITY,
        depthWrite: false,
      });
      tubeMesh(plannedSegs, geom, mat, "planned", rad);
    }

    // Executado: segmentos vermelhos (cilindros finos para ficar visível em 3D)
    if (realSegs.length) {
      const geom = new THREE.CylinderGeometry(1, 1, 1, 6, 1, false);
      const mat = new THREE.MeshStandardMaterial({ color: COLORS.real, roughness: 0.4 });
      tubeMesh(realSegs, geom, mat, "real", rad * 0.45);
    }

    // IDs dos furos: rótulo pequeno logo acima de cada emboque (camada "IDs")
    holes.forEach((h, hi) => {
      const c = h.collar || (h.planned && h.planned[0]) || (h.real && h.real[0]);
      if (!h.id || !c || !Number.isFinite(c.x)) return;
      const p = toWorld(c);
      const el = document.createElement("div");
      el.className = "map3d-id";
      el.textContent = h.id;
      const label = new CSS2DObject(el);
      label.position.set(p.x, p.y + rad * 2.2, p.z);
      layerGroups.labels.add(label);
    });

    // Emboques: esferas azuis (ou, com furos ocultos, círculos achatados no chão)
    collarMeshes = {};
    if (collars.length) {
      const holeOf = [];
      const sphereMesh = new THREE.InstancedMesh(
        new THREE.SphereGeometry(rad * 1.3, 10, 8),
        new THREE.MeshStandardMaterial({ color: COLORS.collar, roughness: 0.4 }),
        collars.length,
      );
      const discMesh = new THREE.InstancedMesh(
        new THREE.CircleGeometry(rad * 1.1, 14).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: COLORS.collar, side: THREE.DoubleSide }),
        collars.length,
      );
      collars.forEach(({ p, hi }, i) => {
        m.makeTranslation(p.x, p.y, p.z);
        sphereMesh.setMatrixAt(i, m);
        discMesh.setMatrixAt(i, m);
        holeOf[i] = hi;
      });
      sphereMesh.instanceMatrix.needsUpdate = true;
      discMesh.instanceMatrix.needsUpdate = true;
      layerGroups.collar.add(sphereMesh, discMesh);
      collarMeshes = { sphere: sphereMesh, disc: discMesh };
      pickEntries.push({ key: "collar", mesh: sphereMesh, holeOf, alt: discMesh });
    }

    // Caixa envolvente em coordenadas da cena
    const box = new THREE.Box3();
    plannedSegs.forEach(({ a, b }) => { box.expandByPoint(a); box.expandByPoint(b); });
    realSegs.forEach(({ a, b }) => { box.expandByPoint(a); box.expandByPoint(b); });
    collars.forEach(({ p }) => box.expandByPoint(p));

    // Chão de referência logo abaixo dos furos
    const size = new THREE.Vector3();
    box.getSize(size);
    const gridSize = Math.max(size.x, size.z, 1) * 1.4;
    const grid = new THREE.GridHelper(gridSize, 20, COLORS.gridMain, COLORS.gridSub);
    grid.position.y = box.min.y - rad * 2;
    layerGroups.grid.add(grid);

    // Enquadramento inicial e limites de zoom
    const target = box.getCenter(new THREE.Vector3());
    const R = Math.max(size.length() / 2, 1);
    const position = target.clone().add(new THREE.Vector3(R * 1.3, R * 1.0, R * 1.9));
    home = { target, position, R };
    camera.near = R / 1000;
    camera.far = R * 100;
    camera.updateProjectionMatrix();
    controls.minDistance = R * 0.1;
    controls.maxDistance = R * 8;
    applyLayerVisibility();
    if (keepView) setViewButtons();
    else applyView();
  }

  const animate = () => {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  };
  animate();

  resetBtn?.addEventListener("click", resetView);
  dxfBtn?.addEventListener("click", exportDxf);
  // Restaura todos os furos ocultos individualmente
  showAllBtn?.addEventListener("click", () => {
    hiddenKeys.clear();
    closeMenu();
    build(current, { keepView: true });
  });
  exagSel?.addEventListener("change", () => build(current));
  layerInputs.forEach((input) => input.addEventListener("change", applyLayerVisibility));
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
