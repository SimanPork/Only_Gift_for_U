import * as THREE from 'three';

export interface AppConfig {
  colors: {
    bg: number;
    fog: number;
    champagneGold: number;
    deepGreen: number;
    accentRed: number;
  };
  particles: {
    count: number;
    dustCount: number;
    snowCount: number;
    treeHeight: number;
    treeRadius: number;
  };
  camera: { z: number };
}

export interface AppState {
  mode: 'TREE' | 'SCATTER' | 'FOCUS';
  focusIndex: number;
  focusTarget: THREE.Object3D | null;
  hand: {
    detected: boolean;
    x: number;
    y: number;
  };
  rotation: {
    x: number;
    y: number;
  };
}

export type ParticleType = 'BOX' | 'GOLD_BOX' | 'GOLD_SPHERE' | 'RED' | 'CANE' | 'DUST' | 'PHOTO';

export class Particle {
  mesh: THREE.Object3D;
  type: ParticleType;
  isDust: boolean;
  posTree: THREE.Vector3 = new THREE.Vector3();
  posScatter: THREE.Vector3 = new THREE.Vector3();
  baseScale: number;
  spinSpeed: THREE.Vector3;

  constructor(mesh: THREE.Object3D, type: ParticleType, isDust: boolean = false) {
    this.mesh = mesh;
    this.type = type;
    this.isDust = isDust;
    this.baseScale = mesh.scale.x;

    const speedMult = (type === 'PHOTO') ? 0.3 : 2.0;
    this.spinSpeed = new THREE.Vector3(
      (Math.random() - 0.5) * speedMult,
      (Math.random() - 0.5) * speedMult,
      (Math.random() - 0.5) * speedMult
    );
  }

  update(dt: number, mode: string, focusTargetMesh: THREE.Object3D | null, mainGroupWorldMatrix: THREE.Matrix4, cameraPos: THREE.Vector3, elapsedTime: number) {
    let target = this.posTree;

    if (mode === 'SCATTER') target = this.posScatter;
    else if (mode === 'FOCUS') {
      if (this.mesh === focusTargetMesh) {
        const desiredWorldPos = new THREE.Vector3(0, 2, 35);
        const invMatrix = new THREE.Matrix4().copy(mainGroupWorldMatrix).invert();
        target = desiredWorldPos.applyMatrix4(invMatrix);
      } else {
        target = this.posScatter;
      }
    }

    const lerpSpeed = (mode === 'FOCUS' && this.mesh === focusTargetMesh) ? 5.0 : 2.0;
    this.mesh.position.lerp(target, lerpSpeed * dt);

    if (mode === 'SCATTER') {
      this.mesh.rotation.x += this.spinSpeed.x * dt;
      this.mesh.rotation.y += this.spinSpeed.y * dt;
      this.mesh.rotation.z += this.spinSpeed.z * dt;
    } else if (mode === 'TREE') {
      if (this.type === 'PHOTO') {
        this.mesh.lookAt(0, this.mesh.position.y, 0);
        this.mesh.rotateY(Math.PI);
      } else {
        this.mesh.rotation.x = THREE.MathUtils.lerp(this.mesh.rotation.x, 0, dt);
        this.mesh.rotation.z = THREE.MathUtils.lerp(this.mesh.rotation.z, 0, dt);
        this.mesh.rotation.y += 0.5 * dt;
      }
    }

    if (mode === 'FOCUS' && this.mesh === focusTargetMesh) {
      this.mesh.lookAt(cameraPos);
    }

    let s = this.baseScale;
    if (this.isDust) {
      s = this.baseScale * (0.8 + 0.4 * Math.sin(elapsedTime * 4 + this.mesh.id));
      if (mode === 'TREE') s = 0;
    } else if (mode === 'SCATTER' && this.type === 'PHOTO') {
      s = this.baseScale * 2.5;
    } else if (mode === 'FOCUS') {
      if (this.mesh === focusTargetMesh) s = 4.5;
      else s = this.baseScale * 0.8;
    }

    this.mesh.scale.lerp(new THREE.Vector3(s, s, s), 4 * dt);
  }
}