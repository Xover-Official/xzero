// Import Three.js and Dat.GUI
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GUI } from 'dat.gui';

// Scene setup
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb); // Sky blue

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 5, 10);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Limit pixel ratio for performance
document.body.appendChild(renderer.domElement);

// Add orbit controls for easier testing
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(10, 20, 10);
scene.add(directionalLight);

// Ground plane
const groundGeometry = new THREE.PlaneGeometry(200, 200);
const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x228b22 }); // Forest green
const ground = new THREE.Mesh(groundGeometry, groundMaterial);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.1;
scene.add(ground);

// Grid helper for reference
const gridHelper = new THREE.GridHelper(200, 20, 0x888888, 0x444444);
scene.add(gridHelper);

// Rendering AI System
class RenderingAI {
  constructor(scene, camera, options = {}) {
    this.scene = scene;
    this.camera = camera;
    
    // Configuration
    this.options = {
      loadRadius: options.loadRadius || 50,      // Load objects within this radius
      unloadRadius: options.unloadRadius || 70,  // Unload objects beyond this radius
      gridSize: options.gridSize || 20,          // Size of the grid (objects per side)
      objectSpacing: options.objectSpacing || 10, // Distance between objects
      maxObjects: options.maxObjects || 400,     // Maximum number of objects to manage
      ...options
    };
    
    // Object management
    this.objects = new Map(); // Map of objectId to { mesh, position, loaded }
    this.nextObjectId = 0;
    
    // Performance tracking
    this.stats = {
      loaded: 0,
      total: 0,
      drawCalls: 0,
      triangles: 0,
      fps: 0,
      memory: 0,
      lastTime: Date.now(),
      frameCount: 0
    };
    
    // Frustum for culling
    this.frustum = new THREE.Frustum();
    
    // Initialize object pool
    this.initObjectPool();
  }
  
  initObjectPool() {
    // Create a grid of potential object positions
    const halfGrid = Math.floor(this.options.gridSize / 2);
    const startX = -halfGrid * this.options.objectSpacing;
    const startZ = -halfGrid * this.options.objectSpacing;
    
    for (let x = 0; x < this.options.gridSize; x++) {
      for (let z = 0; z < this.options.gridSize; z++) {
        const posX = startX + x * this.options.objectSpacing;
        const posZ = startZ + z * this.options.objectSpacing;
        
        // Random height variation for terrain feel
        const posY = Math.sin(posX * 0.1) * Math.cos(posZ * 0.1) * 2;
        
        this.createObjectAtPosition(posX, posY, posZ);
      }
    }
    
    this.stats.total = this.objects.size;
  }
  
  createObjectAtPosition(x, y, z) {
    const objectId = this.nextObjectId++;
    
    // Create a simple geometric object (box, sphere, or cylinder)
    const geometryType = Math.floor(Math.random() * 3);
    let geometry;
    
    switch (geometryType) {
      case 0: // Box
        const size = 1 + Math.random() * 1.5;
        geometry = new THREE.BoxGeometry(size, size, size);
        break;
      case 1: // Sphere
        const radius = 0.5 + Math.random() * 1;
        const widthSegments = Math.max(8, Math.floor(16 * (0.5 + Math.random() * 0.5)));
        const heightSegments = Math.max(8, Math.floor(16 * (0.5 + Math.random() * 0.5)));
        geometry = new THREE.SphereGeometry(radius, widthSegments, heightSegments);
        break;
      case 2: // Cylinder
        const radiusTop = 0.3 + Math.random() * 0.7;
        const radiusBottom = radiusTop;
        const height = 1 + Math.random() * 2;
        const radialSegments = Math.max(8, Math.floor(16 * (0.5 + Math.random() * 0.5)));
        geometry = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radialSegments);
        break;
    }
    
    // Material with some variation
    const colors = [0xff6b6b, 0x4ecdc4, 0x45b7d1, 0xf9ca24, 0xf0932b, 0xeb4d4b];
    const color = colors[Math.floor(Math.random() * colors.length)];
    const material = new THREE.MeshStandardMaterial({ 
      color: color,
      metalness: Math.random() * 0.5,
      roughness: 0.3 + Math.random() * 0.7
    });
    
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    
    // Store object info
    this.objects.set(objectId, {
      mesh: mesh,
      position: new THREE.Vector3(x, y, z),
      loaded: false
    });
    
    return objectId;
  }
  
  update() {
    // Update frustum from camera
    this.updateFrustum();
    
    // Update object visibility based on distance and frustum
    this.updateObjectVisibility();
    
    // Update stats
    this.updateStats();
  }
  
  updateFrustum() {
    // Update the frustum from the camera's projection matrix
    const camera = this.camera;
    camera.updateMatrixWorld(); // Ensure matrix is updated
    
    // Extract frustum planes from camera
    const projectionMatrix = camera.projectionMatrix;
    const modelViewMatrix = camera.matrixWorldInverse;
    const clipSpaceMatrix = new THREE.Matrix4().multiplyMatrices(projectionMatrix, modelViewMatrix);
    
    // Extract the planes
    this.frustum.setFromMatrix(clipSpaceMatrix);
  }
  
  updateObjectVisibility() {
    const cameraPos = this.camera.position;
    let loadedCount = 0;
    
    this.objects.forEach((objData, objectId) => {
      const distance = objData.position.distanceTo(cameraPos);
      const shouldLoad = distance < this.options.loadRadius;
      const shouldUnload = distance > this.options.unloadRadius;
      
      // If object should be loaded and isn't yet
      if (shouldLoad && !objData.loaded) {
        this.loadObject(objData);
        loadedCount++;
      }
      // If object should be unloaded and is currently loaded
      else if (shouldUnload && objData.loaded) {
        this.unloadObject(objData);
      }
      
      // Update loaded count
      if (objData.loaded) loadedCount++;
    });
    
    this.stats.loaded = loadedCount;
  }
  
  loadObject(objData) {
    // Add mesh to scene
    this.scene.add(objData.mesh);
    objData.loaded = true;
  }
  
  unloadObject(objData) {
    // Remove mesh from scene
    this.scene.remove(objData.mesh);
    objData.loaded = false;
  }
  
  updateStats() {
    // Calculate FPS
    const now = Date.now();
    this.stats.frameCount++;
    
    if (now - this.stats.lastTime >= 1000) {
      this.stats.fps = this.stats.frameCount;
      this.stats.frameCount = 0;
      this.stats.lastTime = now;
    }
    
    // Estimate draw calls and triangles (simplified)
    this.stats.drawCalls = this.stats.loaded; // Each object is one draw call
    this.stats.triangles = this.stats.loaded * 20; // Rough estimate
    
    // Memory usage approximation (very rough)
    this.stats.memory = (this.stats.loaded * 50) / 1024; // MB
  }
  
  getStats() {
    return { ...this.stats };
  }
}

// Initialize Rendering AI
const renderingAI = new RenderingAI(scene, camera, {
  loadRadius: 30,
  unloadRadius: 45,
  gridSize: 15,
  objectSpacing: 8
});

// GUI for debugging
const gui = new GUI({ width: 300 });
const guiParams = {
  loadDistance: renderingAI.options.loadRadius,
  unloadDistance: renderingAI.options.unloadRadius,
  gridSize: renderingAI.options.gridSize,
  objectSpacing: renderingAI.options.objectSpacing,
  reset: function() {
    location.reload();
  }
};

gui.add(guiParams, 'loadDistance', 10, 100, 1).onChange(value => {
  renderingAI.options.loadRadius = value;
}).name('Load Distance');

gui.add(guiParams, 'unloadDistance', 10, 150, 1).onChange(value => {
  renderingAI.options.unloadRadius = value;
}).name('Unload Distance');

gui.add(guiParams, 'gridSize', 5, 30, 1).onChange(value => {
  renderingAI.options.gridSize = value;
}).name('Grid Size');

gui.add(guiParams, 'objectSpacing', 5, 20, 0.5).onChange(value => {
  renderingAI.options.objectSpacing = value;
}).name('Object Spacing');

gui.add(guiParams, 'reset').name('Reset Scene');

// Handle window resize
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Animation loop
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  
  const delta = clock.getDelta();
  
  // Update controls
  controls.update(delta);
  
  // Update Rendering AI
  renderingAI.update();
  
  // Render
  renderer.render(scene, camera);
  
  // Update UI
  updateUI();
}

function updateUI() {
  const stats = renderingAI.getStats();
  
  document.getElementById('loadedCount').textContent = stats.loaded;
  document.getElementById('totalCount').textContent = stats.total;
  document.getElementById('fps').textContent = stats.fps;
  document.getElementById('memory').textContent = stats.memory.toFixed(1);
  document.getElementById('drawCalls').textContent = stats.drawCalls;
  document.getElementById('triangles').textContent = stats.triangles;
  
  // Update GUI values if they've changed
  if (Math.abs(guiParams.loadDistance - renderingAI.options.loadRadius) > 0.1) {
    guiParams.loadDistance = renderingAI.options.loadRadius;
  }
  if (Math.abs(guiParams.unloadDistance - renderingAI.options.unloadRadius) > 0.1) {
    guiParams.unloadDistance = renderingAI.options.unloadRadius;
  }
}

// Start animation
animate();

// Add some basic keyboard controls for movement
const keys = {};
window.addEventListener('keydown', (e) => { keys[e.code] = true; });
window.addEventListener('keyup', (e) => { keys[e.code] = false; });

function handleMovement(delta) {
  const speed = 5 * delta; // 5 units per second
  
  if (keys['KeyW']) {
    // Move forward
    const dir = new THREE.Vector3(0, 0, -1);
    dir.applyQuaternion(camera.quaternion);
    camera.position.addScaledVector(dir, speed);
  }
  if (keys['KeyS']) {
    // Move backward
    const dir = new THREE.Vector3(0, 0, 1);
    dir.applyQuaternion(camera.quaternion);
    camera.position.addScaledVector(dir, speed);
  }
  if (keys['KeyA']) {
    // Move left
    const dir = new THREE.Vector3(-1, 0, 0);
    dir.applyQuaternion(camera.quaternion);
    camera.position.addScaledVector(dir, speed);
  }
  if (keys['KeyD']) {
    // Move right
    const dir = new THREE.Vector3(1, 0, 0);
    dir.applyQuaternion(camera.quaternion);
    camera.position.addScaledVector(dir, speed);
  }
  if (keys['Space']) {
    // Jump
    camera.position.y += 2 * delta;
  }
  if (keys['ShiftLeft']) {
    // Crouch/go down
    camera.position.y -= 2 * delta;
  }
}

// Replace the controls.update in animate loop with our custom movement
function animateWithMovement() {
  requestAnimationFrame(animateWithMovement);
  
  const delta = clock.getDelta();
  
  // Handle keyboard movement
  handleMovement(delta);
  
  // Update camera look direction with mouse (basic implementation)
  // In a full implementation, you'd use pointerlock API
  
  // Update Rendering AI
  renderingAI.update();
  
  // Render
  renderer.render(scene, camera);
  
  // Update UI
  updateUI();
}

// Uncomment to use custom movement instead of orbit controls
// animateWithMovement();