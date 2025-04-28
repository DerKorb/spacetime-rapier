import * as THREE from 'three';
import { SpacetimeDBClient } from '@clockworklabs/spacetimedb-sdk';

// Initialize SpacetimeDB client
const client = new SpacetimeDBClient('ws://localhost:3000');

// Three.js setup
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Lighting
const light = new THREE.DirectionalLight(0xffffff, 1);
light.position.set(1, 1, 1);
scene.add(light);
scene.add(new THREE.AmbientLight(0x404040));

// Ground
const groundGeometry = new THREE.PlaneGeometry(200, 200);
const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x808080 });
const ground = new THREE.Mesh(groundGeometry, groundMaterial);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

// Store entity meshes
const entityMeshes = new Map();

// Handle entity updates
client.on('update', (table, row) => {
    if (table === 'Entity') {
        const id = row.get('id');
        const x = row.get('x');
        const y = row.get('y');
        const z = row.get('z');

        let mesh = entityMeshes.get(id);
        if (!mesh) {
            const geometry = new THREE.SphereGeometry(1);
            const material = new THREE.MeshStandardMaterial({ color: 0xff0000 });
            mesh = new THREE.Mesh(geometry, material);
            scene.add(mesh);
            entityMeshes.set(id, mesh);
        }

        mesh.position.set(x, y, z);
    }
});

// Camera position
camera.position.set(0, 5, 10);
camera.lookAt(0, 0, 0);

// Animation loop
function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
}

// Start animation
animate();

// Handle window resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
