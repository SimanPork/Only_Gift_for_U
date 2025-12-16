import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
// @ts-ignore
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer';
// @ts-ignore
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass';
// @ts-ignore
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass';
// @ts-ignore
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { CONFIG } from '../constants';
import { AppState, Particle, ParticleType } from '../types';

interface SceneLogicProps {
  onLoadComplete: () => void;
  onDebugUpdate: (info: string) => void;
  uploadedFiles: File[];
  isCameraVisible: boolean;
}

// Special Effect State
type EffectPhase = 'IDLE' | 'RISING' | 'EXPLODED';

// Structure for a single firework streamer (Head + Tail)
interface ExplosionStreamer {
  head: THREE.Mesh;
  trails: THREE.Mesh[];
  velocity: THREE.Vector3;
  positionHistory: THREE.Vector3[]; // Stores past positions for trails to follow
  life: number;
}

const SceneLogic: React.FC<SceneLogicProps> = ({ onLoadComplete, onDebugUpdate, uploadedFiles, isCameraVisible }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const requestRef = useRef<number>(0);
  
  // Logic Refs
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const composerRef = useRef<EffectComposer | null>(null);
  const mainGroupRef = useRef<THREE.Group | null>(null);
  const photoMeshGroupRef = useRef<THREE.Group | null>(null);
  const particleSystemRef = useRef<Particle[]>([]);
  
  // Snow Refs
  const snowSystemRef = useRef<THREE.Points | null>(null);
  const snowMaterialRef = useRef<THREE.PointsMaterial | null>(null);
  // Ground Snow Refs
  const groundSnowSystemRef = useRef<THREE.Points | null>(null);
  const groundSnowCountRef = useRef<number>(0);
  const MAX_GROUND_SNOW = 5000;
  
  // Special Effects Refs
  const meteorGroupRef = useRef<THREE.Group | null>(null);
  const spiralGroupRef = useRef<THREE.Group | null>(null);
  const explosionGroupRef = useRef<THREE.Group | null>(null);
  
  // Effect State
  const effectStateRef = useRef({
    phase: 'IDLE' as EffectPhase,
    spiralHeight: -CONFIG.particles.treeHeight / 2, // Start at bottom
    snowColorLerp: 0, // 0 = white, 1 = pink
  });
  // State tracking for mode changes
  const prevModeRef = useRef<string>('TREE');

  // Spiral particles data
  const spiralParticlesData = useRef<{
    mesh: THREE.Mesh, 
    lagIndex: number, 
    offsetR: number, 
    offsetY: number, 
    offsetAngle: number
  }[]>([]);
  
  // Explosion Streamers Data
  const explosionStreamersRef = useRef<ExplosionStreamer[]>([]);
  
  // Meteor particles data
  const meteorsData = useRef<{
      group: THREE.Group, 
      head: THREE.Mesh, 
      tailMat: THREE.MeshBasicMaterial, 
      speed: number,
      active: boolean
  }[]>([]);

  const clockRef = useRef(new THREE.Clock());
  const handLandmarkerRef = useRef<HandLandmarker | null>(null);

  const stateRef = useRef<AppState>({
    mode: 'TREE',
    focusIndex: -1,
    focusTarget: null,
    hand: { detected: false, x: 0, y: 0 },
    rotation: { x: 0, y: 0 }
  });

  // --- Handlers ---
  const handleResize = () => {
    if (!cameraRef.current || !rendererRef.current || !composerRef.current) return;
    const width = window.innerWidth;
    const height = window.innerHeight;
    
    cameraRef.current.aspect = width / height;
    cameraRef.current.updateProjectionMatrix();
    rendererRef.current.setSize(width, height);
    composerRef.current.setSize(width, height);
  };

  // --- 3D Initialization ---
  const initThree = () => {
    if (!containerRef.current) return;
    
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(CONFIG.colors.bg);
    scene.fog = new THREE.FogExp2(CONFIG.colors.fog, 0.015);

    const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 2, CONFIG.camera.z);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ReinhardToneMapping;
    renderer.toneMappingExposure = 2.2;
    containerRef.current.appendChild(renderer.domElement);

    const mainGroup = new THREE.Group();
    scene.add(mainGroup);
    const photoMeshGroup = new THREE.Group();
    mainGroup.add(photoMeshGroup);

    // Special Effect Groups
    const meteorGroup = new THREE.Group();
    scene.add(meteorGroup); // Add directly to scene
    meteorGroupRef.current = meteorGroup;

    const spiralGroup = new THREE.Group();
    mainGroup.add(spiralGroup);
    spiralGroupRef.current = spiralGroup;

    const explosionGroup = new THREE.Group();
    scene.add(explosionGroup);
    explosionGroupRef.current = explosionGroup;

    // Environment & Lights
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;

    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambient);
    const innerLight = new THREE.PointLight(0xffaa00, 2, 20);
    innerLight.position.set(0, 5, 0);
    mainGroup.add(innerLight);
    const spotGold = new THREE.SpotLight(0xffcc66, 1200);
    spotGold.position.set(30, 40, 40);
    spotGold.angle = 0.5;
    spotGold.penumbra = 0.5;
    scene.add(spotGold);
    const spotBlue = new THREE.SpotLight(0x6688ff, 800);
    spotBlue.position.set(-30, 20, -30);
    scene.add(spotBlue);
    const fill = new THREE.DirectionalLight(0xffeebb, 0.8);
    fill.position.set(0, 0, 50);
    scene.add(fill);

    // Post Processing
    const renderScene = new RenderPass(scene, camera);
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
    bloomPass.threshold = 0.65;
    bloomPass.strength = 1.0; 
    bloomPass.radius = 0.4;
    const composer = new EffectComposer(renderer);
    composer.addPass(renderScene);
    composer.addPass(bloomPass);

    // Refs
    sceneRef.current = scene;
    cameraRef.current = camera;
    rendererRef.current = renderer;
    composerRef.current = composer;
    mainGroupRef.current = mainGroup;
    photoMeshGroupRef.current = photoMeshGroup;

    initMeteors();
    initSpiral();
    initExplosionPool();
  };

  const createTextures = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if(ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0,0,128,128);
        ctx.fillStyle = '#880000'; 
        ctx.beginPath();
        for(let i=-128; i<256; i+=32) {
            ctx.moveTo(i, 0); ctx.lineTo(i+32, 128); ctx.lineTo(i+16, 128); ctx.lineTo(i-16, 0);
        }
        ctx.fill();
    }
    const caneTexture = new THREE.CanvasTexture(canvas);
    caneTexture.wrapS = THREE.RepeatWrapping;
    caneTexture.wrapT = THREE.RepeatWrapping;
    caneTexture.repeat.set(3, 3);
    return caneTexture;
  };

  // --- Helper: Create Spiral Texture (Pink Gradient) ---
  // White Center -> Pink -> Transparent
  const createSpiralTexture = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 32; canvas.height = 32;
      const ctx = canvas.getContext('2d');
      if(ctx) {
          const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
          // Center white, edge pinkish
          grad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
          grad.addColorStop(0.3, 'rgba(255, 182, 193, 0.8)'); // LightPink
          grad.addColorStop(0.6, 'rgba(255, 105, 180, 0.3)'); // HotPink
          grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
          ctx.fillStyle = grad;
          ctx.fillRect(0,0,32,32);
      }
      return new THREE.CanvasTexture(canvas);
  };

  // --- Special Effects Initialization ---

  const initMeteors = () => {
      if (!meteorGroupRef.current) return;
      
      const headGeo = new THREE.SphereGeometry(0.3, 8, 8);
      const headMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

      const tailHeight = 35;
      const tailGeo = new THREE.CylinderGeometry(0.4, 0, tailHeight, 8, 2, true);
      tailGeo.translate(0, -tailHeight/2, 0);

      const vx = -1.2;
      const vy = -0.8;
      const angle = Math.atan2(vy, vx); 
      const rotationZ = angle - Math.PI / 2;

      for(let i=0; i<12; i++) {
          const group = new THREE.Group();
          const head = new THREE.Mesh(headGeo, headMat);
          const tailMat = new THREE.MeshBasicMaterial({ 
              color: 0x88ccff, 
              transparent: true, 
              opacity: 0.0, 
              blending: THREE.AdditiveBlending,
              depthWrite: false
          });
          const tail = new THREE.Mesh(tailGeo, tailMat);
          group.add(head);
          group.add(tail);
          group.rotation.z = rotationZ;
          meteorGroupRef.current.add(group);
          meteorsData.current.push({ group, head, tailMat, speed: 0, active: false });
      }
  };

  const initSpiral = () => {
      if (!spiralGroupRef.current) return;
      
      // Use the Pink Gradient texture for the spiral
      const pinkTexture = createSpiralTexture(); 

      const mat = new THREE.MeshBasicMaterial({ 
          map: pinkTexture,
          color: 0xffffff, 
          transparent: true,
          opacity: 0.9, 
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide
      });

      const particleCount = 450; 
      const geo = new THREE.PlaneGeometry(0.6, 0.6); 

      for(let i=0; i<particleCount; i++) {
          const mesh = new THREE.Mesh(geo, mat);
          mesh.visible = false;
          spiralGroupRef.current.add(mesh);
          
          const rOff = (Math.random() - 0.5) * 1.8; 
          const yOff = (Math.random() - 0.5) * 1.2;
          const aOff = (Math.random() - 0.5) * 0.2;

          spiralParticlesData.current.push({ 
              mesh, 
              lagIndex: i, 
              offsetR: rOff,
              offsetY: yOff,
              offsetAngle: aOff
          });
      }
  };

  const initExplosionPool = () => {
      if (!explosionGroupRef.current) return;
      
      // Use SAME texture as Spiral to match appearance
      const pinkTexture = createSpiralTexture(); 

      const streamerCount = 300; // Increased count to dense match spiral
      const trailLength = 5;     // Short trails to keep performance up with high count

      const geo = new THREE.PlaneGeometry(0.6, 0.6); 

      // Single material for all particles (matching spiral)
      const mat = new THREE.MeshBasicMaterial({
          map: pinkTexture,
          color: 0xffffff, // Pure white to let pink texture show
          transparent: true,
          opacity: 1.0, 
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide
      });

      for(let i=0; i<streamerCount; i++) {
          const head = new THREE.Mesh(geo, mat);
          head.visible = false;
          explosionGroupRef.current.add(head);

          const trails: THREE.Mesh[] = [];
          for(let j=0; j<trailLength; j++) {
             const tMesh = new THREE.Mesh(geo, mat);
             tMesh.visible = false;
             tMesh.scale.setScalar(0.9 - (j/trailLength)*0.7); 
             explosionGroupRef.current.add(tMesh);
             trails.push(tMesh);
          }

          explosionStreamersRef.current.push({
              head,
              trails,
              velocity: new THREE.Vector3(),
              positionHistory: [],
              life: 0
          });
      }
  };

  // --- Effects Update Logic ---

  const triggerExplosion = () => {
      if (!explosionGroupRef.current) return;
      const topPos = new THREE.Vector3(0, CONFIG.particles.treeHeight/2 + 2, 0);
      
      const count = explosionStreamersRef.current.length;

      explosionStreamersRef.current.forEach((streamer, i) => {
          // Reset
          streamer.head.position.copy(topPos);
          streamer.head.visible = true;
          // Initial size matches spiral particles
          streamer.head.scale.set(1.2, 1.2, 1.2); 
          
          streamer.trails.forEach(t => {
              t.position.copy(topPos); 
              t.visible = false; 
          });
          streamer.positionHistory = []; 

          // --- HEART SHAPE MATH ---
          // Heart Equations:
          // x = 16 sin^3 t
          // y = 13 cos t - 5 cos 2t - 2 cos 3t - cos 4t
          // Range Y is approx [-17, 13]
          // Range X is approx [-16, 16]
          
          let vx, vy, vz;
          
          // Randomize speed slightly for natural look
          // Lower speed multiplier means shape stays tighter, higher means bigger burst
          // To reach middle of tree (y=0) from top (y=12), we need a drop of ~12 units.
          // The bottom of heart is -17 units in eq.
          // Scale factor approx 0.8
          const speedScale = 0.8 + Math.random() * 0.4; 

          if (i < count * 0.9) { 
              // 90% form the Heart Shape
              const t = (i / (count * 0.9)) * Math.PI * 2;
              
              // Raw Parametric Coords
              const rawX = 16 * Math.pow(Math.sin(t), 3);
              const rawY = 13 * Math.cos(t) - 5 * Math.cos(2*t) - 2 * Math.cos(3*t) - Math.cos(4*t);
              
              // We map these coords directly to velocity
              // We also shift Y up slightly so the "center" of the burst isn't too low immediately
              
              vx = rawX * speedScale;
              vy = (rawY + 5) * speedScale; // +5 to center the heart vertically around origin before velocity takes over
              
              // Add Z depth for 3D volume
              vz = (Math.random() - 0.5) * 8.0;

          } else {
              // 10% Random Fill inside
              const theta = Math.random() * Math.PI * 2;
              const phi = Math.random() * Math.PI;
              const r = Math.random() * 10; 
              
              vx = r * Math.sin(phi) * Math.cos(theta);
              vy = r * Math.sin(phi) * Math.sin(theta);
              vz = r * Math.cos(phi);
          }

          streamer.velocity.set(vx, vy, vz);
          
          streamer.life = 3.5; // Longer life for slow fall
      });
  };

  const updateSpecialEffects = (dt: number, mode: string, elapsedTime: number) => {
      const cameraPos = cameraRef.current?.position || new THREE.Vector3(0,0,50);

      // 1. Meteors
      if (mode === 'TREE') {
          meteorsData.current.forEach((data, i) => {
              if (data.active) {
                  const vx = -1.2;
                  const vy = -0.8;
                  data.group.position.x += vx * data.speed * dt;
                  data.group.position.y += vy * data.speed * dt;
                  const flicker = 0.3 + Math.abs(Math.sin(elapsedTime * 30 + i * 10)) * 0.5;
                  data.tailMat.opacity = flicker;
                  if (data.group.position.y < -60 || data.group.position.x < -100) {
                      data.active = false;
                      data.group.visible = false;
                  }
              } else {
                  if (Math.random() < 0.02) {
                      data.active = true;
                      data.group.visible = true;
                      const startX = 30 + Math.random() * 50;
                      const startY = 40 + Math.random() * 40;
                      const startZ = -40 - Math.random() * 60;
                      data.group.position.set(startX, startY, startZ);
                      data.speed = 35 + Math.random() * 20; 
                      data.tailMat.opacity = 0; 
                  }
              }
          });
      } else {
          meteorsData.current.forEach(d => { d.active = false; d.group.visible = false; });
      }

      // 2. Spiral Beam
      if (mode === 'TREE') {
          if (effectStateRef.current.phase === 'IDLE') {
              effectStateRef.current.phase = 'RISING';
              effectStateRef.current.spiralHeight = -CONFIG.particles.treeHeight/2;
          }

          if (effectStateRef.current.phase === 'RISING') {
              effectStateRef.current.spiralHeight += 8.0 * dt; 
              
              const currentHeadY = effectStateRef.current.spiralHeight;
              const maxH = CONFIG.particles.treeHeight/2 + 2;
              const totalParticles = spiralParticlesData.current.length;
              
              const spinRate = 2.0; 
              const baseHeadAngle = currentHeadY * spinRate + elapsedTime * 2;
              
              spiralParticlesData.current.forEach((p) => {
                   const trailRatio = p.lagIndex / totalParticles;
                   const lagDistance = trailRatio * 20.0; 
                   const myBaseY = currentHeadY - (lagDistance * 0.6); 
                   const myBaseAngle = baseHeadAngle - (lagDistance * 0.5); 

                   if (myBaseY > -CONFIG.particles.treeHeight/2 && myBaseY < maxH) {
                       p.mesh.visible = true;
                       const progress = (myBaseY + CONFIG.particles.treeHeight/2) / CONFIG.particles.treeHeight;
                       const baseRadius = 9.0 * (1.0 - progress * 0.85); 
                       
                       const r = baseRadius + p.offsetR; 
                       const y = myBaseY + p.offsetY;     
                       const angle = myBaseAngle + p.offsetAngle;

                       p.mesh.position.set(Math.cos(angle) * r, y, Math.sin(angle) * r);
                       p.mesh.lookAt(cameraPos);

                       const sparkle = 1.0 + Math.sin(elapsedTime * 10 + p.lagIndex) * 0.3;
                       const sizeFade = Math.max(0, 1.0 - trailRatio); 
                       const s = sizeFade * 2.0 * sparkle; 
                       p.mesh.scale.set(s, s, s);
                   } else {
                       p.mesh.visible = false;
                   }
              });

              if (currentHeadY > maxH) {
                  effectStateRef.current.phase = 'EXPLODED';
                  triggerExplosion();
                  spiralParticlesData.current.forEach(p => p.mesh.visible = false);
              }
          }
      } else {
          effectStateRef.current.phase = 'IDLE';
          effectStateRef.current.snowColorLerp = 0; 
          spiralParticlesData.current.forEach(p => p.mesh.visible = false);
          
          // Hide Explosion
          explosionStreamersRef.current.forEach(s => {
              s.head.visible = false;
              s.trails.forEach(t => t.visible = false);
          });
      }

      // 3. Explosion Animation (Heart Firework Style)
      if (effectStateRef.current.phase === 'EXPLODED') {
          // Keep pinkish ambience
          effectStateRef.current.snowColorLerp = THREE.MathUtils.lerp(effectStateRef.current.snowColorLerp, 1, dt * 2);

          const gravity = new THREE.Vector3(0, -5, 0); // Moderate gravity
          const drag = 0.98; // Low drag for expansion

          explosionStreamersRef.current.forEach(streamer => {
              if (streamer.life > 0) {
                  // Update Head Physics
                  streamer.velocity.addScaledVector(gravity, dt);
                  streamer.velocity.multiplyScalar(drag); 
                  
                  streamer.head.position.addScaledVector(streamer.velocity, dt);
                  streamer.head.lookAt(cameraPos);
                  
                  // Record history for trails
                  streamer.positionHistory.unshift(streamer.head.position.clone());
                  if (streamer.positionHistory.length > streamer.trails.length + 2) {
                      streamer.positionHistory.pop();
                  }

                  // Update Trails
                  streamer.trails.forEach((t, index) => {
                      const histIndex = index; 
                      if (streamer.positionHistory[histIndex]) {
                          t.visible = true;
                          t.position.copy(streamer.positionHistory[histIndex]);
                          t.lookAt(cameraPos);
                          
                          // Fade tail based on life
                          const lifeRatio = streamer.life / 3.5; 
                          const trailFade = 1.0 - (index / streamer.trails.length);
                          
                          const s = 1.2 * lifeRatio * trailFade;
                          t.scale.set(s, s, s);

                          // Keep opacity high enough to see trails clearly
                          (t.material as THREE.MeshBasicMaterial).opacity = lifeRatio * trailFade;
                      }
                  });

                  // Head Scale
                  const headScale = 1.5 * (streamer.life / 3.5);
                  streamer.head.scale.set(headScale, headScale, headScale);
                  (streamer.head.material as THREE.MeshBasicMaterial).opacity = streamer.life / 3.5;

                  streamer.life -= dt;
                  if (streamer.life <= 0) {
                      streamer.head.visible = false;
                      streamer.trails.forEach(t => t.visible = false);
                  }
              }
          });
      } else {
          if (mode !== 'TREE') effectStateRef.current.snowColorLerp = 0;
      }
  };

  // --- Main Scene Logic ---

  const updatePhotoLayout = () => {
    const photos = particleSystemRef.current.filter(p => p.type === 'PHOTO');
    const count = photos.length;
    if (count === 0) return;

    const h = CONFIG.particles.treeHeight * 0.9;
    const bottomY = -h/2;
    const stepY = h / count;
    const loops = 3;

    photos.forEach((p, i) => {
        const y = bottomY + stepY * i + stepY/2;
        const fullH = CONFIG.particles.treeHeight;
        const normalizedH = (y + fullH/2) / fullH; 

        let rMax = CONFIG.particles.treeRadius * (1.0 - normalizedH);
        if (rMax < 1.0) rMax = 1.0;
        
        const r = rMax + 3.0; 
        const angle = normalizedH * Math.PI * 2 * loops + (Math.PI/4); 

        p.posTree.set(Math.cos(angle) * r, y, Math.sin(angle) * r);
    });
  };

  const addPhotoToScene = (texture: THREE.Texture) => {
    if (!photoMeshGroupRef.current) return;
    
    const frameGeo = new THREE.BoxGeometry(1.4, 1.4, 0.05);
    const frameMat = new THREE.MeshStandardMaterial({ color: CONFIG.colors.champagneGold, metalness: 1.0, roughness: 0.1 });
    const frame = new THREE.Mesh(frameGeo, frameMat);

    let width = 1.2;
    let height = 1.2;
    
    if (texture.image) {
        const aspect = texture.image.width / texture.image.height;
        if (aspect > 1) {
            height = width / aspect;
        } else {
            width = height * aspect;
        }
    }

    const photoGeo = new THREE.PlaneGeometry(width, height);
    const photoMat = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
    const photo = new THREE.Mesh(photoGeo, photoMat);
    photo.position.z = 0.04;

    const group = new THREE.Group();
    group.add(frame);
    group.add(photo);
    
    frame.scale.set(width/1.2, height/1.2, 1);
    const s = 0.8;
    group.scale.set(s,s,s);
    
    photoMeshGroupRef.current.add(group);

    // Initial positioning for photos
    const p = new Particle(group, 'PHOTO', false);
    p.posScatter.set(
        THREE.MathUtils.randFloatSpread(50),
        THREE.MathUtils.randFloatSpread(40),
        THREE.MathUtils.randFloatSpread(50)
    );
    particleSystemRef.current.push(p);

    updatePhotoLayout();
  };

  const createParticles = (caneTexture: THREE.CanvasTexture) => {
    if (!mainGroupRef.current) return;
    
    const sphereGeo = new THREE.SphereGeometry(0.5, 32, 32);
    const boxGeo = new THREE.BoxGeometry(0.55, 0.55, 0.55);
    const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, -0.5, 0), new THREE.Vector3(0, 0.3, 0),
        new THREE.Vector3(0.1, 0.5, 0), new THREE.Vector3(0.3, 0.4, 0)
    ]);
    const candyGeo = new THREE.TubeGeometry(curve, 16, 0.08, 8, false);

    const goldMat = new THREE.MeshStandardMaterial({
        color: CONFIG.colors.champagneGold,
        metalness: 1.0, roughness: 0.1,
        envMapIntensity: 2.0, 
        emissive: 0x443300,   
        emissiveIntensity: 0.3
    });

    const greenMat = new THREE.MeshStandardMaterial({
        color: CONFIG.colors.deepGreen,
        metalness: 0.2, roughness: 0.8,
        emissive: 0x002200,
        emissiveIntensity: 0.2 
    });

    const redMat = new THREE.MeshPhysicalMaterial({
        color: CONFIG.colors.accentRed,
        metalness: 0.3, roughness: 0.2, clearcoat: 1.0,
        emissive: 0x330000
    });
    
    const candyMat = new THREE.MeshStandardMaterial({ map: caneTexture, roughness: 0.4 });

    for (let i = 0; i < CONFIG.particles.count; i++) {
        const rand = Math.random();
        let mesh: THREE.Mesh;
        let type: ParticleType;
        
        if (rand < 0.40) {
            mesh = new THREE.Mesh(boxGeo, greenMat);
            type = 'BOX';
        } else if (rand < 0.70) {
            mesh = new THREE.Mesh(boxGeo, goldMat);
            type = 'GOLD_BOX';
        } else if (rand < 0.92) {
            mesh = new THREE.Mesh(sphereGeo, goldMat);
            type = 'GOLD_SPHERE';
        } else if (rand < 0.97) {
            mesh = new THREE.Mesh(sphereGeo, redMat);
            type = 'RED';
        } else {
            mesh = new THREE.Mesh(candyGeo, candyMat);
            type = 'CANE';
        }

        const s = 0.4 + Math.random() * 0.5;
        mesh.scale.set(s,s,s);
        mesh.rotation.set(Math.random()*6, Math.random()*6, Math.random()*6);
        
        mainGroupRef.current.add(mesh);
        
        const p = new Particle(mesh, type, false);

        // Scatter Logic
        p.posScatter.set(
            THREE.MathUtils.randFloatSpread(60),
            THREE.MathUtils.randFloatSpread(60),
            THREE.MathUtils.randFloatSpread(60)
        );

        // Tree Logic (Cone Distribution)
        const h = CONFIG.particles.treeHeight;
        const rBase = CONFIG.particles.treeRadius;
        const yNorm = Math.random();
        const y = (yNorm - 0.5) * h;
        const rAtHeight = (1.0 - yNorm) * rBase;
        const r = rAtHeight * (0.8 + Math.random() * 0.4); 
        const angle = Math.random() * Math.PI * 2;

        p.posTree.set(
            Math.cos(angle) * r,
            y,
            Math.sin(angle) * r
        );

        // Set initial position
        p.mesh.position.copy(p.posTree);

        particleSystemRef.current.push(p);
    }
    
    // Star
    const starShape = new THREE.Shape();
    const points = 5;
    const outerRadius = 1.5;
    const innerRadius = 0.7; 
    
    for (let i = 0; i < points * 2; i++) {
        const angle = (i * Math.PI) / points + Math.PI / 2;
        const r = (i % 2 === 0) ? outerRadius : innerRadius;
        const x = Math.cos(angle) * r;
        const y = Math.sin(angle) * r;
        if (i === 0) starShape.moveTo(x, y);
        else starShape.lineTo(x, y);
    }
    starShape.closePath();

    const starGeo = new THREE.ExtrudeGeometry(starShape, {
        depth: 0.4,
        bevelEnabled: true,
        bevelThickness: 0.1,
        bevelSize: 0.1,
        bevelSegments: 2
    });
    starGeo.center(); 

    const starMat = new THREE.MeshStandardMaterial({
        color: 0xffdd88, emissive: 0xffaa00, emissiveIntensity: 1.0,
        metalness: 1.0, roughness: 0
    });
    const star = new THREE.Mesh(starGeo, starMat);
    star.position.set(0, CONFIG.particles.treeHeight/2 + 1.2, 0);
    mainGroupRef.current.add(star);

    // Dust
    const dustGeo = new THREE.TetrahedronGeometry(0.08, 0);
    const dustMat = new THREE.MeshBasicMaterial({ color: 0xffeebb, transparent: true, opacity: 0.8 });
    
    for(let i=0; i<CONFIG.particles.dustCount; i++) {
            const mesh = new THREE.Mesh(dustGeo, dustMat);
            const s = 0.5 + Math.random();
            mesh.scale.set(s,s,s);
            mainGroupRef.current.add(mesh);
            
            const p = new Particle(mesh, 'DUST', true);
            
            p.posScatter.set(
                THREE.MathUtils.randFloatSpread(50),
                THREE.MathUtils.randFloatSpread(50),
                THREE.MathUtils.randFloatSpread(50)
            );

            // Dust around tree
            const h = CONFIG.particles.treeHeight * 1.2;
            const rBase = CONFIG.particles.treeRadius * 1.5;
            const yNorm = Math.random();
            const y = (yNorm - 0.5) * h;
            const rAtHeight = (1.0 - yNorm) * rBase;
            const r = rAtHeight * Math.random(); 
            const angle = Math.random() * Math.PI * 2;

            p.posTree.set(
                Math.cos(angle) * r,
                y,
                Math.sin(angle) * r
            );
            p.mesh.position.copy(p.posTree);

            particleSystemRef.current.push(p);
    }

    // Snow
    const snowGeo = new THREE.BufferGeometry();
    const vertices: number[] = [];
    const velocities: number[] = [];
    
    const snowCanvas = document.createElement('canvas');
    snowCanvas.width = 32; snowCanvas.height = 32;
    const sCtx = snowCanvas.getContext('2d');
    if(sCtx) {
        sCtx.fillStyle = 'white';
        sCtx.shadowBlur = 10;
        sCtx.shadowColor = 'white';
        sCtx.beginPath();
        sCtx.arc(16, 16, 10, 0, Math.PI * 2);
        sCtx.fill();
    }
    const snowTexture = new THREE.CanvasTexture(snowCanvas);

    for (let i = 0; i < CONFIG.particles.snowCount; i++) {
        const x = THREE.MathUtils.randFloatSpread(100);
        const y = THREE.MathUtils.randFloatSpread(60);
        const z = THREE.MathUtils.randFloatSpread(60);
        vertices.push(x, y, z);
        velocities.push(Math.random() * 0.2 + 0.1, Math.random() * 0.05);
    }

    snowGeo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    snowGeo.setAttribute('userData', new THREE.Float32BufferAttribute(velocities, 2));

    const snowMat = new THREE.PointsMaterial({
        color: 0xffffff,
        size: 0.5,
        map: snowTexture,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true
    });

    const snow = new THREE.Points(snowGeo, snowMat);
    if(sceneRef.current) sceneRef.current.add(snow);
    snowSystemRef.current = snow;
    snowMaterialRef.current = snowMat;

    // --- Ground Snow Init ---
    const groundSnowGeo = new THREE.BufferGeometry();
    const groundVertices: number[] = [];
    // Initialize max ground snow particles off-screen
    for(let i=0; i<MAX_GROUND_SNOW; i++) {
        groundVertices.push(0, -1000, 0);
    }
    groundSnowGeo.setAttribute('position', new THREE.Float32BufferAttribute(groundVertices, 3));
    
    const groundSnow = new THREE.Points(groundSnowGeo, snowMat); // Use same material
    if(sceneRef.current) sceneRef.current.add(groundSnow);
    groundSnowSystemRef.current = groundSnow;
  };

  const loadPredefinedImages = () => {
    const loader = new THREE.TextureLoader();
    CONFIG.preload.images.forEach(url => {
        loader.load(url, 
            (t) => { t.colorSpace = THREE.SRGBColorSpace; addPhotoToScene(t); },
            undefined,
            (e) => { console.log(`Skipped: ${url}`); }
        );
    });
  };

  const updateSnow = (elapsedTime: number, mode: string) => {
    if (!snowSystemRef.current || !snowMaterialRef.current) return;
    
    const positions = snowSystemRef.current.geometry.attributes.position.array as Float32Array;
    const userData = snowSystemRef.current.geometry.attributes.userData.array as Float32Array;

    // 1. Dynamic Color Changing (White <-> Pink)
    const pink = new THREE.Color(0xffb7c5); // Pastel pink
    const white = new THREE.Color(0xffffff);
    snowMaterialRef.current.color.copy(white).lerp(pink, effectStateRef.current.snowColorLerp);

    // 2. Stable Snow (No flickering)
    snowMaterialRef.current.opacity = 0.8;
    snowMaterialRef.current.size = 0.5;

    // Ground Snow Accumulation Logic
    const bottomThreshold = -30;
    
    for (let i = 0; i < CONFIG.particles.snowCount; i++) {
        // Y fall
        const fallSpeed = userData[i * 2];
        positions[i * 3 + 1] -= fallSpeed;

        // X sway
        const swaySpeed = userData[i * 2 + 1];
        positions[i * 3] += Math.sin(elapsedTime * 2 + i) * swaySpeed * 0.1;

        // Reset & Accumulate
        if (positions[i * 3 + 1] < bottomThreshold) {
            
            // If in TREE mode, try to add to pile
            if (mode === 'TREE' && groundSnowSystemRef.current && groundSnowCountRef.current < MAX_GROUND_SNOW) {
                 const currentCount = groundSnowCountRef.current;
                 const groundPositions = groundSnowSystemRef.current.geometry.attributes.position.array as Float32Array;
                 
                 // Get current x, z of falling flake (and clamp to pile width)
                 // Or generate random spread for better visuals
                 const width = 80;
                 const x = THREE.MathUtils.randFloatSpread(width);
                 const z = THREE.MathUtils.randFloatSpread(50);
                 
                 // Pile Height Calculation:
                 // 1. Random base variation
                 // 2. Grow based on total count
                 // 3. Taller in center (using Cosine or Parabola)
                 const normX = x / (width/2); // -1 to 1
                 const shapeFactor = Math.max(0, Math.cos(normX * Math.PI / 1.5)); // 1 at center, 0 at edges
                 const pileHeight = shapeFactor * 5 + Math.random() * 2;
                 const growFactor = (currentCount / MAX_GROUND_SNOW) * 3; // Grows up to 3 units

                 const y = bottomThreshold + 2 + pileHeight * 0.5 + growFactor;

                 groundPositions[currentCount * 3] = x;
                 groundPositions[currentCount * 3 + 1] = y;
                 groundPositions[currentCount * 3 + 2] = z;

                 groundSnowCountRef.current++;
                 groundSnowSystemRef.current.geometry.attributes.position.needsUpdate = true;
            }

            // Respawn Falling Flake at top
            positions[i * 3 + 1] = 30;
            positions[i * 3] = THREE.MathUtils.randFloatSpread(100);
            positions[i * 3 + 2] = THREE.MathUtils.randFloatSpread(60);
        }
    }
    snowSystemRef.current.geometry.attributes.position.needsUpdate = true;
  };

  // --- Hand Tracking ---
  const processGestures = (result: any) => {
    if (result.landmarks && result.landmarks.length > 0) {
        stateRef.current.hand.detected = true;
        const lm = result.landmarks[0];
        // Flip x for mirror effect
        stateRef.current.hand.x = (lm[9].x - 0.5) * 2; 
        stateRef.current.hand.y = (lm[9].y - 0.5) * 2;

        const thumb = lm[4]; 
        const index = lm[8]; 
        const wrist = lm[0];
        const middleMCP = lm[9]; 

        const handSize = Math.hypot(middleMCP.x - wrist.x, middleMCP.y - wrist.y);
        if (handSize < 0.02) return;

        const tips = [lm[8], lm[12], lm[16], lm[20]];
        let avgTipDist = 0;
        tips.forEach(t => avgTipDist += Math.hypot(t.x - wrist.x, t.y - wrist.y));
        avgTipDist /= 4;

        const pinchDist = Math.hypot(thumb.x - index.x, thumb.y - index.y);
        const extensionRatio = avgTipDist / handSize;
        const pinchRatio = pinchDist / handSize;

        onDebugUpdate(`Size: ${handSize.toFixed(2)} | Ext: ${extensionRatio.toFixed(2)} | Pinch: ${pinchRatio.toFixed(2)} | Mode: ${stateRef.current.mode}`);

        if (extensionRatio < 1.5) {
            stateRef.current.mode = 'TREE';
            stateRef.current.focusTarget = null;
        } else if (pinchRatio < 0.35) {
            if (stateRef.current.mode !== 'FOCUS') {
                stateRef.current.mode = 'FOCUS';
                const photos = particleSystemRef.current.filter(p => p.type === 'PHOTO');
                if (photos.length) stateRef.current.focusTarget = photos[Math.floor(Math.random()*photos.length)].mesh;
            }
        } else if (extensionRatio > 1.7) {
            stateRef.current.mode = 'SCATTER';
            stateRef.current.focusTarget = null;
        }
    } else {
        stateRef.current.hand.detected = false;
        onDebugUpdate("No hand detected");
    }
  };

  // --- Initialize Everything ---
  useEffect(() => {
    initThree();
    const caneTexture = createTextures();
    createParticles(caneTexture);
    loadPredefinedImages();
    window.addEventListener('resize', handleResize);
    
    // Animation Loop
    const animate = () => {
        requestRef.current = requestAnimationFrame(animate);
        const dt = clockRef.current.getDelta();
        const elapsedTime = clockRef.current.elapsedTime;
        const state = stateRef.current;

        // Reset Ground Snow Check
        if (state.mode === 'TREE' && prevModeRef.current !== 'TREE') {
            // Reset pile
            groundSnowCountRef.current = 0;
            if (groundSnowSystemRef.current) {
                const positions = groundSnowSystemRef.current.geometry.attributes.position.array as Float32Array;
                for(let i=0; i<MAX_GROUND_SNOW; i++) {
                    positions[i*3+1] = -1000; // Hide below screen
                }
                groundSnowSystemRef.current.geometry.attributes.position.needsUpdate = true;
            }
        }
        prevModeRef.current = state.mode;

        // Rotation Logic
        if (state.mode === 'SCATTER' && state.hand.detected) {
            const targetRotY = state.hand.x * Math.PI * 0.9; 
            const targetRotX = state.hand.y * Math.PI * 0.25;
            state.rotation.y += (targetRotY - state.rotation.y) * 3.0 * dt;
            state.rotation.x += (targetRotX - state.rotation.x) * 3.0 * dt;
        } else {
            if(state.mode === 'TREE') {
                state.rotation.y += 0.3 * dt;
                state.rotation.x += (0 - state.rotation.x) * 2.0 * dt;
            } else {
                  state.rotation.y += 0.1 * dt; 
            }
        }

        if(mainGroupRef.current) {
            mainGroupRef.current.rotation.y = state.rotation.y;
            mainGroupRef.current.rotation.x = state.rotation.x;
            
            mainGroupRef.current.updateMatrixWorld();
            const worldMat = mainGroupRef.current.matrixWorld;
            const camPos = cameraRef.current?.position || new THREE.Vector3(0,0,50);

            particleSystemRef.current.forEach(p => p.update(dt, state.mode, state.focusTarget, worldMat, camPos, elapsedTime));
        }

        updateSpecialEffects(dt, state.mode, elapsedTime);
        updateSnow(elapsedTime, state.mode);
        if(composerRef.current) composerRef.current.render();
    };

    // Initialize MediaPipe
    const initVision = async () => {
        try {
             const vision = await FilesetResolver.forVisionTasks(
                "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
            );
            handLandmarkerRef.current = await HandLandmarker.createFromOptions(vision, {
                baseOptions: {
                    modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
                    delegate: "GPU"
                },
                runningMode: "VIDEO",
                numHands: 1
            });
            
            // Start Video - ANDROID FIX: REMOVED IDEAL WIDTH/HEIGHT
            if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia && videoRef.current) {
                 try {
                     const stream = await navigator.mediaDevices.getUserMedia({
                         video: { 
                             facingMode: 'user'
                         }
                     });
                     videoRef.current.srcObject = stream;
                     
                     // ANDROID FIX: EXPLICIT PLAY
                     videoRef.current.onloadedmetadata = () => {
                        videoRef.current?.play();
                     };

                     videoRef.current.addEventListener('loadeddata', () => {
                         const predict = () => {
                             if(videoRef.current && videoRef.current.readyState >= 2 && handLandmarkerRef.current) {
                                 const results = handLandmarkerRef.current.detectForVideo(videoRef.current, performance.now());
                                 processGestures(results);
                             }
                             requestAnimationFrame(predict);
                         };
                         predict();
                         onLoadComplete();
                     });
                 } catch (err: any) {
                     console.error("Camera access error:", err);
                     onDebugUpdate(`Cam Error: ${err.name} - ${err.message}`);
                     onLoadComplete(); // Still load scene
                 }
            } else {
                onLoadComplete();
            }
        } catch (e) {
            console.error("Vision Init Error", e);
            onDebugUpdate("Vision Init Failed");
            onLoadComplete();
        }
    };
    initVision();
    animate();

    return () => {
        cancelAnimationFrame(requestRef.current);
        window.removeEventListener('resize', handleResize);
        if (rendererRef.current) {
            rendererRef.current.dispose();
            containerRef.current?.removeChild(rendererRef.current.domElement);
        }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run once

  // Handle new file uploads
  useEffect(() => {
    if(uploadedFiles.length > 0) {
        uploadedFiles.forEach(f => {
             const reader = new FileReader();
                reader.onload = (ev) => {
                    if (ev.target?.result) {
                        new THREE.TextureLoader().load(ev.target.result as string, (t) => {
                            t.colorSpace = THREE.SRGBColorSpace;
                            addPhotoToScene(t);
                        });
                    }
                }
                reader.readAsDataURL(f);
        });
    }
  }, [uploadedFiles]);

  return (
    <>
      <div ref={containerRef} className="absolute top-0 left-0 w-full h-full z-[1]" />
      <div className={`absolute bottom-5 left-5 z-[50] pointer-events-none transition-opacity duration-300 ${isCameraVisible ? 'opacity-100' : 'opacity-0'}`}>
         <video ref={videoRef} autoPlay playsInline muted className="w-[150px] h-[112px] transform scale-x-[-1] border border-yellow-500/50 rounded shadow-lg" />
      </div>
    </>
  );
};

export default SceneLogic;