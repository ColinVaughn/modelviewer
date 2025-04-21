// script.js
import * as THREE from 'three';
import { OrbitControls } from 'three/controls/OrbitControls.js';
import { TransformControls } from 'three/controls/TransformControls.js';
import { OBJLoader } from 'three/loaders/OBJLoader.js';

let scene, camera, renderer;
let orbitControls;
let tcTranslate, tcRotate, tcScale;
let model = null;
const hitboxes = [];
let selectedHitbox = null;
let previousSelected = null;

init();
animate();

function init() {
    // — Scene, Camera, Renderer —
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(
        70,
        window.innerWidth / window.innerHeight,
        0.1,
        1000
    );
    camera.position.set(0, 2, 5);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    // — OrbitControls —
    orbitControls = new OrbitControls(camera, renderer.domElement);

    // — Create the three TransformControls —
    tcTranslate = makeControl('translate', 0.1, null);
    tcRotate    = makeControl('rotate',    null, THREE.MathUtils.degToRad(15));
    tcScale     = makeControl('scale',     0.1, null);
    scene.add(tcTranslate, tcRotate, tcScale);

    // — Lighting —
    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.5);
    dirLight.position.set(5, 5, 5);
    scene.add(dirLight);

    // — GUI Bindings —
    document.getElementById('modelInput')
        .addEventListener('change', handleModelLoad);
    document.getElementById('addHitboxBtn')
        .addEventListener('click', addHitbox);
    document.getElementById('renameBtn')
        .addEventListener('click', renameHitbox);
    document.getElementById('exportBtn')
        .addEventListener('click', exportJSON);

    document.getElementById('translateBtn')
        .addEventListener('click', () => showOnly(tcTranslate));
    document.getElementById('rotateBtn')
        .addEventListener('click', () => showOnly(tcRotate));
    document.getElementById('scaleBtn')
        .addEventListener('click', () => showOnly(tcScale));

    ['posX','posY','posZ','rotX','rotY','rotZ','scaleX','scaleY','scaleZ']
        .forEach(id => {
            document.getElementById(id)
                .addEventListener('input', syncHitboxToInputs);
        });

    window.addEventListener('resize', onWindowResize);
}
// after your other GUI bindings in init():
document.getElementById('autoBtn')
    .addEventListener('click', () => {
        const q = parseInt(document.getElementById('autoQuality').value, 10);
        autoGenerateHitboxes(q);
    });

/**
 * Auto-generate hitboxes by voxelizing the model bounding box.
 * @param {number} quality — number of voxels per axis (e.g. 5 = 5×5×5 grid)
 */
/**
 * Returns true if `point` lies inside `model`, by raycasting along
 * the six cardinal directions and checking for an odd hit‑count.
 */
function isInside(point, raycaster, model) {
    const dirs = [
        new THREE.Vector3( 1,  0,  0),
        new THREE.Vector3(-1,  0,  0),
        new THREE.Vector3( 0,  1,  0),
        new THREE.Vector3( 0, -1,  0),
        new THREE.Vector3( 0,  0,  1),
        new THREE.Vector3( 0,  0, -1),
    ];

    for (let dir of dirs) {
        raycaster.set(point, dir);
        const hits = raycaster.intersectObject(model, true);
        if (hits.length % 2 === 1) {
            return true;
        }
    }
    return false;
}


function autoGenerateHitboxes(quality) {
    if (!model) {
        alert('Please load a model first.');
        return;
    }

    // 1) clear existing hitboxes
    hitboxes.forEach(hb => scene.remove(hb));
    hitboxes.length = 0;
    selectedHitbox = previousSelected = null;
    updateHitboxList();

    // 2) bounding‐box & step
    const bbox = new THREE.Box3().setFromObject(model);
    const min = bbox.min, max = bbox.max;
    const size = new THREE.Vector3().subVectors(max, min);
    const step = size.clone().divideScalar(quality);

    // 3) raycaster
    const raycaster = new THREE.Raycaster();

    // 4) grid sampling
    for (let i = 0; i < quality; i++) {
        for (let j = 0; j < quality; j++) {
            for (let k = 0; k < quality; k++) {
                // sample at cell center
                const sample = new THREE.Vector3(
                    min.x + (i + 0.5) * step.x,
                    min.y + (j + 0.5) * step.y,
                    min.z + (k + 0.5) * step.z
                );

                // test inclusion
                if (!isInside(sample, raycaster, model)) continue;

                // create a wireframe box at that position
                const geo = new THREE.BoxGeometry(step.x, step.y, step.z);
                const mat = new THREE.MeshBasicMaterial({
                    color: 0xff0000,
                    wireframe: true
                });
                const box = new THREE.Mesh(geo, mat);
                box.position.copy(sample);
                box.userData.name = `auto_${hitboxes.length}`;

                // attach label
                const label = makeLabel(box.userData.name);
                label.position.set(0, step.y/2 + 0.1, 0);
                box.add(label);
                box.userData.label = label;

                scene.add(box);
                hitboxes.push(box);
            }
        }
    }

    // 5) select first if any
    if (hitboxes.length) {
        selectHitbox(hitboxes[0]);
    }
}


// Helper to build a TransformControls with optional snapping:
function makeControl(mode, translateSnap, rotateSnap) {
    const tc = new TransformControls(camera, renderer.domElement);
    tc.setMode(mode);
    if (translateSnap !== null) tc.setTranslationSnap(translateSnap);
    if (rotateSnap    !== null) tc.setRotationSnap(rotateSnap);
    if (mode === 'scale' && translateSnap !== null) tc.setScaleSnap(translateSnap);

    tc.addEventListener('dragging-changed', e => {
        orbitControls.enabled = !e.value;
    });
    tc.addEventListener('objectChange', () => {
        syncInputsToHitbox();
        updateHitboxList();
    });
    tc.visible = false; // hidden until a hitbox is selected
    return tc;
}

// Create a text sprite for the label:
function makeLabel(text) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.font = '48px Arial';
    ctx.fillStyle = 'black';
    ctx.textAlign = 'center';
    ctx.fillText(text, canvas.width/2, 48);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;

    const mat = new THREE.SpriteMaterial({ map: texture, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(1.5, 0.375, 1);
    return sprite;
}

function handleModelLoad(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
        const loader = new OBJLoader();
        if (model) scene.remove(model);
        model = loader.parse(ev.target.result);
        scene.add(model);
    };
    reader.readAsText(file);
}

function addHitbox() {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({
        color: 0xff0000,
        wireframe: true
    });
    const box = new THREE.Mesh(geo, mat);
    box.position.set(0, 0.5, 0);
    box.userData.name = `hitbox_${hitboxes.length}`;

    // attach label
    const label = makeLabel(box.userData.name);
    label.position.set(0, 1.2, 0);
    box.add(label);
    box.userData.label = label;

    scene.add(box);
    hitboxes.push(box);
    selectHitbox(box);
    updateHitboxList();
}

function renameHitbox() {
    const name = document.getElementById('renameHitbox').value.trim();
    if (
        selectedHitbox &&
        name &&
        !hitboxes.some(h => h.userData.name === name)
    ) {
        // update data
        selectedHitbox.userData.name = name;

        // recreate label
        selectedHitbox.remove(selectedHitbox.userData.label);
        const newLabel = makeLabel(name);
        newLabel.position.set(0, 1.2, 0);
        selectedHitbox.add(newLabel);
        selectedHitbox.userData.label = newLabel;

        updateHitboxList();
    } else {
        alert('Invalid or duplicate name.');
    }
}

function selectHitbox(box) {
    // revert previous color
    if (previousSelected) {
        previousSelected.material.color.set(0xff0000);
    }

    selectedHitbox = box;
    previousSelected = box;

    // highlight new selection
    box.material.color.set(0xffffff);

    // attach all gizmos
    tcTranslate.attach(box);
    tcRotate.attach(box);
    tcScale.attach(box);

    // show translate by default
    showOnly(tcTranslate);

    syncInputsToHitbox();
    updateHitboxList();
}

function showOnly(controlToShow) {
    [tcTranslate, tcRotate, tcScale].forEach(tc => {
        tc.visible = (tc === controlToShow);
    });
}

function updateHitboxList() {
    const ul = document.getElementById('hitboxList');
    ul.innerHTML = '';
    hitboxes.forEach(box => {
        const li = document.createElement('li');
        li.textContent = box.userData.name;
        if (box === selectedHitbox) li.classList.add('selected');
        li.onclick = () => selectHitbox(box);
        ul.appendChild(li);
    });
}

function syncInputsToHitbox() {
    if (!selectedHitbox) return;
    const p = selectedHitbox.position;
    const r = selectedHitbox.rotation;
    const s = selectedHitbox.scale;

    document.getElementById('posX').value = p.x.toFixed(2);
    document.getElementById('posY').value = p.y.toFixed(2);
    document.getElementById('posZ').value = p.z.toFixed(2);

    document.getElementById('rotX').value = THREE.MathUtils
        .radToDeg(r.x)
        .toFixed(1);
    document.getElementById('rotY').value = THREE.MathUtils
        .radToDeg(r.y)
        .toFixed(1);
    document.getElementById('rotZ').value = THREE.MathUtils
        .radToDeg(r.z)
        .toFixed(1);

    document.getElementById('scaleX').value = s.x.toFixed(2);
    document.getElementById('scaleY').value = s.y.toFixed(2);
    document.getElementById('scaleZ').value = s.z.toFixed(2);
}

function syncHitboxToInputs() {
    if (!selectedHitbox) return;
    const p = selectedHitbox.position;
    const r = selectedHitbox.rotation;
    const s = selectedHitbox.scale;

    p.x = parseFloat(document.getElementById('posX').value) || p.x;
    p.y = parseFloat(document.getElementById('posY').value) || p.y;
    p.z = parseFloat(document.getElementById('posZ').value) || p.z;

    r.x = THREE.MathUtils.degToRad(
        parseFloat(document.getElementById('rotX').value) ||
        THREE.MathUtils.radToDeg(r.x)
    );
    r.y = THREE.MathUtils.degToRad(
        parseFloat(document.getElementById('rotY').value) ||
        THREE.MathUtils.radToDeg(r.y)
    );
    r.z = THREE.MathUtils.degToRad(
        parseFloat(document.getElementById('rotZ').value) ||
        THREE.MathUtils.radToDeg(r.z)
    );

    s.x = parseFloat(document.getElementById('scaleX').value) || s.x;
    s.y = parseFloat(document.getElementById('scaleY').value) || s.y;
    s.z = parseFloat(document.getElementById('scaleZ').value) || s.z;
}

function exportJSON() {
    const data = {
        hitboxes: hitboxes.map(box => {
            box.geometry.computeBoundingBox();
            const size = new THREE.Vector3();
            box.geometry.boundingBox.getSize(size);
            return {
                name: box.userData.name,
                size: [size.x, size.y, size.z],
                rel_pos: [box.position.x, box.position.y, box.position.z]
            };
        })
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'hitboxes.json';
    a.click();
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
}
