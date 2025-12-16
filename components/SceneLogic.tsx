import React, { useEffect, useRef, useState } from 'react';
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
  isCameraVisible: boolean; // Received from App
}

const SceneLogic: React.FC<SceneLogicProps> = ({ onLoadComplete, onDebugUpdate, uploadedFiles, isCameraVisible }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const requestRef = useRef<number>(0);
  
  // Logic Refs (to persist across renders without causing re-renders)
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const composerRef = useRef<EffectComposer | null>(null);
  const mainGroupRef = useRef<THREE.Group | null>(null);
  const photoMeshGroupRef = useRef<THREE.Group | null>(null);
  const particleSystemRef = useRef<Particle[]>([]);
  const snowSystemRef = useRef<THREE.Points | null>(null);
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
    bloomPass.strength = 0.5;
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
        const r = rAtHeight * (0.8 + Math.random() * 0.4); // Add some noise to radius
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
        sCtx.beginPath();
        sCtx.arc(16, 16, 16, 0, Math.PI * 2);
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
        size: 0.4,
        map: snowTexture,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });

    const snow = new THREE.Points(snowGeo, snowMat);
    if(sceneRef.current) sceneRef.current.add(snow);
    snowSystemRef.current = snow;
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

  const updateSnow = (elapsedTime: number) => {
    if (!snowSystemRef.current) return;
    
    const positions = snowSystemRef.current.geometry.attributes.position.array as Float32Array;
    const userData = snowSystemRef.current.geometry.attributes.userData.array as Float32Array;

    for (let i = 0; i < CONFIG.particles.snowCount; i++) {
        // Y fall
        const fallSpeed = userData[i * 2];
        positions[i * 3 + 1] -= fallSpeed;

        // X sway
        const swaySpeed = userData[i * 2 + 1];
        positions[i * 3] += Math.sin(elapsedTime * 2 + i) * swaySpeed * 0.1;

        // Reset
        if (positions[i * 3 + 1] < -30) {
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
            
            // Pass world matrix and camera pos for focus calc
            mainGroupRef.current.updateMatrixWorld();
            const worldMat = mainGroupRef.current.matrixWorld;
            const camPos = cameraRef.current?.position || new THREE.Vector3(0,0,50);

            particleSystemRef.current.forEach(p => p.update(dt, state.mode, state.focusTarget, worldMat, camPos, elapsedTime));
        }

        updateSnow(elapsedTime);
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